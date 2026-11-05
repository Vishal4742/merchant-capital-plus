// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// RED skeleton: the interface of batch 002-P2-merchantpay with no behaviour yet.
contract MerchantPay is Ownable, Pausable, ReentrancyGuardTransient {
    uint8 public constant KIND_INVOICE = 1;
    uint8 public constant KIND_SALE = 2;
    uint256 public constant MIN_PAYMENT = 1_000_000;
    uint256 public constant MAX_FEE = 250_000;

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
        address customer;
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
    uint256 public relayFee = 100_000;
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
        usdt = usdt_;
        feeRecipient = feeRecipient_;
    }

    function createInvoice(address, uint128, uint64, bytes32) external returns (uint256) {}

    function cancelInvoice(uint256) external {}

    function payInvoice(uint256, address, uint256, uint256, uint256, bytes32, uint8, bytes32, bytes32)
        external
        returns (uint256)
    {}

    function paySale(address, bytes32, address, uint256, uint256, uint256, bytes32, uint8, bytes32, bytes32)
        external
        returns (uint256)
    {}

    function refund(uint256, uint256) external {}

    function setRelayFee(uint256, address) external {}

    function pause() external {}

    function unpause() external {}

    function saleNonce(address, bytes32, uint256, bytes32) public view returns (bytes32) {}

    function invoiceNonce(uint256, uint256, bytes32) public view returns (bytes32) {}
}
