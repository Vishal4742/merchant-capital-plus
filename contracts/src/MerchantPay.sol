// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC3009} from "@openzeppelin/contracts/interfaces/draft-IERC3009.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title MerchantPay: gasless USDT invoices and checkout sales with one-click refunds
/// @notice The payer signs one EIP-3009 ReceiveWithAuthorization naming this contract; anyone (normally our relayer)
///         submits it and pays the gas. The nonce is recomputed here from the invoice or order, so a signature can
///         only pay the payment it was made for. The relay fee comes out of the gross in the same transaction and
///         MerchantPay keeps nothing. Refunds come from the merchant's own wallet. (SRS FR-PAY-1/2/3/5/6/8, FR-REL-4/7/9)
/// @dev ponytail: no CapitalMarket routing yet (toInvestors is 0); Phase 3 adds setMarket/onPayment and redeploys
///      before the G3 ABI freeze. Invoices are paid in full; partial payments arrive with FR-INV-4 (Phase 4).
contract MerchantPay is Ownable, Pausable, ReentrancyGuardTransient {
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

    error ZeroAddress();
    error WrongAmount();
    error InvalidDueDate();
    error InvoiceNotOpen();
    error NotMerchant();
    error InvalidOrder();
    error OrderPaid();
    error FeeTooHigh();
    error RefundTooLarge();

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
        if (amount < MIN_PAYMENT) revert WrongAmount();
        // forge-lint: disable-next-line(block-timestamp) due dates are days away; seconds of drift don't matter
        if (dueDate <= block.timestamp) revert InvalidDueDate();
        id = ++invoiceCount;
        invoices[id] = Invoice(msg.sender, dueDate, InvoiceStatus.Open, customer, amount, 0);
        emit InvoiceCreated(id, msg.sender, customer, amount, dueDate, refHash);
    }

    function cancelInvoice(uint256 id) external {
        Invoice storage invoice = invoices[id];
        if (invoice.merchant != msg.sender) revert NotMerchant();
        if (invoice.status != InvoiceStatus.Open) revert InvoiceNotOpen();
        invoice.status = InvoiceStatus.Cancelled;
        emit InvoiceCancelled(id);
    }

    // ---------- payments (FR-PAY-3, FR-PAY-5, FR-PAY-6, FR-REL-4, FR-REL-7) ----------

    /// @notice Pays invoice `id` in full with `from`'s signed ReceiveWithAuthorization (to = this contract).
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
        if (amount != invoice.amount - invoice.paid) revert WrongAmount();
        invoice.paid = invoice.amount;
        invoice.status = InvoiceStatus.Paid;
        address merchant = invoice.merchant;
        paymentId = _record(merchant, from, id, bytes32(0), amount);
        _collect(merchant, from, amount, validAfter, validBefore, invoiceNonce(id, amount, salt), v, r, s);
    }

    /// @notice Pays checkout order `orderRef` of `merchant` with `from`'s signed ReceiveWithAuthorization.
    ///         Each order can be paid once, so `orderRef` must be unguessable (random per checkout session).
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
        if (merchant == address(0) || orderRef == bytes32(0)) revert InvalidOrder();
        if (amount < MIN_PAYMENT) revert WrongAmount();
        if (saleOf[merchant][orderRef] != 0) revert OrderPaid();
        paymentId = _record(merchant, from, 0, orderRef, amount);
        saleOf[merchant][orderRef] = paymentId;
        _collect(merchant, from, amount, validAfter, validBefore, saleNonce(merchant, orderRef, amount, salt), v, r, s);
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

    // ---------- owner (FR-REL-4 fee, FR-REL-9 pause) ----------

    function setRelayFee(uint256 fee, address recipient) external onlyOwner {
        if (fee > MAX_FEE) revert FeeTooHigh();
        if (recipient == address(0)) revert ZeroAddress();
        relayFee = fee;
        feeRecipient = recipient;
        emit RelayFeeSet(fee, recipient);
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

    /// @dev Effects of a payment: store it and emit Paid before any token call (checks-effects-interactions;
    ///      if the pull or a transfer fails, the whole payment reverts, the log included).
    function _record(address merchant, address payer, uint256 invoiceId, bytes32 orderRef, uint256 gross)
        private
        returns (uint256 paymentId)
    {
        paymentId = ++paymentCount;
        payments[paymentId] = Payment(merchant, SafeCast.toUint96(gross), payer, 0);
        uint256 fee = relayFee;
        emit Paid(paymentId, merchant, payer, invoiceId, orderRef, gross, fee, 0, gross - fee);
    }

    /// @dev Interactions: pull the gross with the payer's authorization, then pay the fee and the merchant.
    ///      gross >= MIN_PAYMENT > MAX_FEE >= relayFee, so the merchant's share is positive.
    ///      ponytail: no sweep; USDT sent here by a plain transfer is stuck (payments never hold a balance).
    function _collect(
        address merchant,
        address from,
        uint256 gross,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        IERC3009(address(usdt))
            .receiveWithAuthorization(from, address(this), gross, validAfter, validBefore, nonce, v, r, s);
        uint256 fee = relayFee;
        if (fee != 0) usdt.safeTransfer(feeRecipient, fee);
        usdt.safeTransfer(merchant, gross - fee);
    }
}
