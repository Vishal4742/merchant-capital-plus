// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC3009} from "@openzeppelin/contracts/interfaces/draft-IERC3009.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ICapitalMarket} from "./interfaces/ICapitalMarket.sol";

/// @title MerchantPay: gasless USDT invoices and checkout sales, repaying advances and financed invoices
/// @notice The payer signs one EIP-3009 ReceiveWithAuthorization naming this contract; anyone (normally our relayer)
///         submits it and pays the gas. The nonce is recomputed here from the invoice or order, so a signature can
///         only pay the payment it was made for. Sales: the 0.10 USDT relay fee comes out of the price. Invoices: the
///         payer pays the credited amount plus the fee, so financed invoices repay their holders in full. If the
///         merchant has claims on this payment, the rest goes through CapitalMarket (holders first); otherwise to the
///         merchant. MerchantPay keeps nothing. Refunds come from the merchant's own wallet.
///         (SRS FR-PAY-1/2/3/5/6/8, FR-REL-4/7/9, FR-ADV-4, FR-INV-4)
contract MerchantPay is Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint8 public constant KIND_INVOICE = 1;
    uint8 public constant KIND_SALE = 2;
    uint256 public constant MIN_PAYMENT = 1_000_000; // 1 USDT
    uint256 public constant MAX_FEE = 250_000; // 0.25 USDT

    enum InvoiceStatus {
        None,
        Open,
        Paid,
        Cancelled
    }

    struct Invoice {
        address merchant;
        uint64 dueDate;
        InvoiceStatus status;
        address customer; // informational: the payer is often a fresh guest wallet, so anyone may pay
        uint128 amount;
        uint128 paid;
    }

    struct Payment {
        address merchant;
        uint96 gross;
        address payer;
        uint96 refunded;
    }

    IERC20 public immutable usdt;
    ICapitalMarket public market;
    uint256 public relayFee = 100_000; // 0.10 USDT
    address public feeRecipient;
    uint256 public invoiceCount;
    uint256 public paymentCount;
    mapping(uint256 id => Invoice) public invoices;
    mapping(uint256 paymentId => Payment) public payments;
    mapping(address merchant => mapping(bytes32 orderRef => uint256 paymentId)) public saleOf;

    event InvoiceCreated(
        uint256 indexed id,
        address indexed merchant,
        address indexed customer,
        uint256 amount,
        uint64 dueDate,
        bytes32 refHash
    );
    event InvoiceCancelled(uint256 indexed id);
    event Paid(
        uint256 indexed paymentId,
        address indexed merchant,
        address indexed payer,
        uint256 invoiceId,
        bytes32 orderRef,
        uint256 gross,
        uint256 fee,
        uint256 toInvestors,
        uint256 toMerchant
    );
    event Refunded(uint256 indexed paymentId, uint256 amount, uint256 totalRefunded);
    event RelayFeeSet(uint256 fee, address recipient);
    event MarketSet(address market);
    event Swept(address indexed to, uint256 amount);

    error ZeroAddress();
    error WrongAmount();
    error InvalidDueDate();
    error InvoiceNotOpen();
    error NotMerchant();
    error InvalidOrder();
    error OrderPaid();
    error FeeTooHigh();
    error RefundTooLarge();
    error MarketAlreadySet();
    error InvoiceFinanced();

    constructor(IERC20 usdt_, address feeRecipient_) Ownable(msg.sender) {
        if (address(usdt_) == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        usdt = usdt_;
        feeRecipient = feeRecipient_;
        emit RelayFeeSet(relayFee, feeRecipient_);
    }

    // ---------- invoices (FR-PAY-1, FR-PAY-2) ----------

    function createInvoice(address customer, uint128 amount, uint64 dueDate, bytes32 refHash)
        external
        returns (uint256 id)
    {
        if (amount < MIN_PAYMENT || amount > type(uint96).max) revert WrongAmount();
        if (dueDate <= block.timestamp) revert InvalidDueDate();
        id = ++invoiceCount;
        invoices[id] = Invoice(msg.sender, dueDate, InvoiceStatus.Open, customer, amount, 0);
        emit InvoiceCreated(id, msg.sender, customer, amount, dueDate, refHash);
    }

    /// @notice Only an untouched invoice: not financed and nothing paid yet.
    function cancelInvoice(uint256 id) external {
        Invoice storage invoice = invoices[id];
        if (invoice.merchant != msg.sender) revert NotMerchant();
        if (invoice.status != InvoiceStatus.Open || invoice.paid != 0) revert InvoiceNotOpen();
        if (address(market) != address(0) && market.isFinanced(id)) revert InvoiceFinanced();
        invoice.status = InvoiceStatus.Cancelled;
        emit InvoiceCancelled(id);
    }

    // ---------- payments (FR-PAY-3, FR-PAY-5, FR-PAY-6, FR-REL-4, FR-REL-7) ----------

    /// @notice Credits `amount` to invoice `id`. The payer's signed value is `amount + relayFee` (fee on top), with
    ///         nonce `invoiceNonce(id, amount, salt)`. Partial payments: at least 1 USDT, or exactly what is still owed.
    function payInvoice(
        uint256 id,
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused returns (uint256 paymentId) {
        Invoice storage invoice = invoices[id];
        if (invoice.status != InvoiceStatus.Open) revert InvoiceNotOpen();
        uint256 owedOnInvoice = invoice.amount - invoice.paid;
        if (amount == 0 || amount > owedOnInvoice || (amount < MIN_PAYMENT && amount != owedOnInvoice)) {
            revert WrongAmount();
        }
        invoice.paid += SafeCast.toUint128(amount);
        if (invoice.paid == invoice.amount) invoice.status = InvoiceStatus.Paid;
        uint256 fee = relayFee;
        address merchant = invoice.merchant;
        paymentId = _record(merchant, from, amount + fee);
        _pull(from, amount + fee, validAfter, validBefore, invoiceNonce(id, amount, salt), v, r, s);
        _settle(paymentId, merchant, from, id, bytes32(0), amount + fee, fee, amount);
    }

    /// @notice Pays checkout order `orderRef` of `merchant`; the 0.10 fee comes out of `amount`. Each order is paid
    ///         once, so `orderRef` must be unguessable (random per checkout session).
    function paySale(
        address merchant,
        bytes32 orderRef,
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused returns (uint256 paymentId) {
        if (merchant == address(0) || merchant == address(this) || orderRef == bytes32(0)) {
            revert InvalidOrder();
        }
        if (amount < MIN_PAYMENT) revert WrongAmount();
        if (saleOf[merchant][orderRef] != 0) revert OrderPaid();
        uint256 fee = relayFee;
        paymentId = _record(merchant, from, amount);
        saleOf[merchant][orderRef] = paymentId;
        _pull(from, amount, validAfter, validBefore, saleNonce(merchant, orderRef, amount, salt), v, r, s);
        _settle(paymentId, merchant, from, 0, orderRef, amount, fee, amount - fee);
    }

    // ---------- refunds (FR-PAY-8) ----------

    /// @notice The payment's merchant returns `amount` to the payer from its own wallet (approve this contract once).
    ///         Allowed while paused. Investors are never touched: the money moves merchant → payer only.
    function refund(uint256 paymentId, uint256 amount) external nonReentrant {
        Payment storage payment = payments[paymentId];
        if (payment.merchant != msg.sender) revert NotMerchant();
        if (amount == 0) revert WrongAmount();
        uint256 total = payment.refunded + amount;
        if (total > payment.gross) revert RefundTooLarge();
        payment.refunded = SafeCast.toUint96(total);
        emit Refunded(paymentId, amount, total);
        usdt.safeTransferFrom(msg.sender, payment.payer, amount);
    }

    // ---------- owner (FR-REL-4 fee, FR-REL-9 pause, wiring, sweep) ----------

    function setRelayFee(uint256 fee, address recipient) external onlyOwner {
        if (fee > MAX_FEE) revert FeeTooHigh();
        if (recipient == address(0) || recipient == address(this)) revert ZeroAddress();
        relayFee = fee;
        feeRecipient = recipient;
        emit RelayFeeSet(fee, recipient);
    }

    /// @notice One-time wiring to CapitalMarket (deploy order: MerchantPay → CapitalMarket → setMarket).
    function setMarket(ICapitalMarket market_) external onlyOwner {
        if (address(market_) == address(0)) revert ZeroAddress();
        if (address(market) != address(0)) revert MarketAlreadySet();
        market = market_;
        emit MarketSet(address(market_));
    }

    /// @notice Recovers USDT sent here by a plain transfer (human 23:40). Payments never leave a balance between
    ///         transactions, so this can't touch anyone's payment.
    function sweep(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = usdt.balanceOf(address(this));
        emit Swept(to, balance);
        usdt.safeTransfer(to, balance);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------- nonces (FR-PAY-6): servers call these to check their own encoding ----------

    function saleNonce(address merchant, bytes32 orderRef, uint256 amount, bytes32 salt) public view returns (bytes32) {
        return keccak256(
            abi.encode(block.chainid, address(this), KIND_SALE, uint256(uint160(merchant)), orderRef, amount, salt)
        );
    }

    function invoiceNonce(uint256 id, uint256 amount, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), KIND_INVOICE, id, bytes32(0), amount, salt));
    }

    // ---------- internals ----------

    function _record(address merchant, address payer, uint256 gross) private returns (uint256 paymentId) {
        paymentId = ++paymentCount;
        payments[paymentId] = Payment(merchant, SafeCast.toUint96(gross), payer, 0);
    }

    function _pull(
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        IERC3009(address(usdt))
            .receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s);
    }

    /// @dev Pays the fee, then `net` either through the market (claims on this payment) or to the merchant.
    ///      gross >= MIN_PAYMENT > MAX_FEE >= fee for sales; invoices add the fee on top, so net is never negative.
    function _settle(
        uint256 paymentId,
        address merchant,
        address payer,
        uint256 invoiceId,
        bytes32 orderRef,
        uint256 gross,
        uint256 fee,
        uint256 net
    ) private {
        if (fee != 0) usdt.safeTransfer(feeRecipient, fee);
        uint256 toInvestors = 0;
        ICapitalMarket market_ = market;
        if (address(market_) != address(0) && market_.hasClaimsOn(merchant, invoiceId)) {
            usdt.safeTransfer(address(market_), net);
            // Holdback base (FR-ADV-4: share of the gross sale): the sale price, or an invoice's credited amount.
            toInvestors = market_.onPayment(merchant, invoiceId, invoiceId == 0 ? gross : net, net, paymentId);
        } else {
            usdt.safeTransfer(merchant, net);
        }
        // forge-lint: disable-next-line(reentrancy-events) every entry point is nonReentrant, the market is set once by the owner, and the log reverts with the payment
        emit Paid(paymentId, merchant, payer, invoiceId, orderRef, gross, fee, toInvestors, net - toInvestors);
    }
}
