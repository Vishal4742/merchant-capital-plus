// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC3009} from "@openzeppelin/contracts/interfaces/draft-IERC3009.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ICapitalMarket} from "./interfaces/ICapitalMarket.sol";
import {IClaimToken} from "./interfaces/IClaimToken.sol";

/// @dev The part of MerchantPay that the market reads.
interface IMerchantPayInvoices {
    function invoices(uint256 id)
        external
        view
        returns (address merchant, uint64 dueDate, uint8 status, address customer, uint128 amount, uint128 paid);
}

/// @title CapitalMarket: revenue advances and invoice financing, repaid from MerchantPay payments
/// @notice A merchant lists an advance (principal now, repaid by a share of every later sale up to a cap) or an
///         unpaid invoice (sold below face). Investors fund it in one transaction: their USDT goes to the merchant
///         and claim units are minted to them (1 unit = 0.000001 USDT owed). Every later payment to the merchant
///         pays the financed invoice's holders first, then the advance lien, pro-rata, burning the units it covers.
///         (SRS FR-ADV-1–6, FR-INV-1/3/4/5, NFR-1/2)
/// @dev ponytail: one active lien per merchant (the advance); recourse liens, default and repay are Phase 5.
contract CapitalMarket is ICapitalMarket, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint8 public constant OFFER_INVOICE = 1;
    uint8 public constant OFFER_ADVANCE = 2;
    uint16 public constant MAX_HOLDBACK_BPS = 3000; // 30% (FR-ADV-1)
    uint16 constant BPS = 10_000;
    uint8 constant INVOICE_OPEN = 1; // MerchantPay.InvoiceStatus.Open

    struct Offer {
        uint8 kind;
        address merchant;
        uint64 offerDeadline;
        uint16 bps; // advance: holdback on gross; invoice: recourse (stored for Phase 5)
        bool cancelled;
        bool settled;
        uint256 invoiceId;
        uint128 face; // units the claim repays in total: invoice amount or advance cap
        uint128 price; // what investors pay for all face units: invoice price or advance principal
        uint64 maturity; // invoice due date; advance: listing time + term
        uint128 sold; // units minted so far
    }

    IMerchantPayInvoices public immutable merchantPay;
    IClaimToken public immutable claimToken;
    IERC20 public immutable usdt;

    uint256 public offerCount;
    mapping(uint256 claimId => Offer) public offers;
    mapping(uint256 invoiceId => uint256 claimId) public claimOfInvoice;
    mapping(address merchant => uint256 claimId) public advanceOf; // listed or running advance; 0 = none
    mapping(address holder => uint256 amount) public owed; // pushes that failed (USDT blocklist), pulled later
    uint256 public totalOwed;

    event OfferListed(
        uint256 indexed claimId,
        address indexed merchant,
        uint8 kind,
        uint256 invoiceId,
        uint256 face,
        uint256 price,
        uint16 bps,
        uint64 offerDeadline,
        uint64 maturity
    );
    event OfferCancelled(uint256 indexed claimId);
    event Funded(uint256 indexed claimId, address indexed investor, uint256 units, uint256 cost);
    event Distributed(uint256 indexed claimId, uint256 indexed paymentId, uint256 amount, uint256 outstanding);
    event LienAdded(address indexed merchant, uint256 indexed claimId, uint16 bps);
    event Settled(uint256 indexed claimId);
    event PushFailed(uint256 indexed claimId, address indexed holder, uint256 amount);
    event OwedWithdrawn(address indexed holder, uint256 amount);

    error NotMerchantPay();
    error NotMerchant();
    error BadTerms();
    error AdvanceActive();
    error InvoiceNotListable();
    error OfferClosed();
    error AlreadyFunded();
    error WrongUnits();
    error NothingOwed();

    constructor(address merchantPay_, IClaimToken claimToken_, IERC20 usdt_) {
        if (merchantPay_ == address(0) || address(claimToken_) == address(0) || address(usdt_) == address(0)) {
            revert BadTerms();
        }
        merchantPay = IMerchantPayInvoices(merchantPay_);
        claimToken = claimToken_;
        usdt = usdt_;
    }

    // ---------- listing (FR-ADV-1/2, FR-INV-1) ----------

    function listAdvance(uint128 principal, uint128 cap, uint16 holdbackBps, uint64 term, uint64 offerDeadline)
        external
        returns (uint256 claimId)
    {
        if (
            principal == 0 || cap < principal || holdbackBps == 0 || holdbackBps > MAX_HOLDBACK_BPS || term == 0
                || offerDeadline <= block.timestamp
        ) {
            revert BadTerms();
        }
        if (advanceOf[msg.sender] != 0) revert AdvanceActive();
        uint64 maturity = SafeCast.toUint64(block.timestamp + term);
        claimId = ++offerCount;
        offers[claimId] =
            Offer(OFFER_ADVANCE, msg.sender, offerDeadline, holdbackBps, false, false, 0, cap, principal, maturity, 0);
        advanceOf[msg.sender] = claimId;
        emit OfferListed(claimId, msg.sender, OFFER_ADVANCE, 0, cap, principal, holdbackBps, offerDeadline, maturity);
    }

    function listInvoice(uint256 invoiceId, uint128 price, uint64 offerDeadline, uint16 recourseBps)
        external
        returns (uint256 claimId)
    {
        (
            address merchant,
            uint64 dueDate,
            uint8 status,,
            uint128 amount,
            uint128 paid
            // forge-lint: disable-next-line(unused-return) the customer field is informational and not needed here
        ) = merchantPay.invoices(invoiceId);
        if (merchant != msg.sender) revert NotMerchant();
        if (status != INVOICE_OPEN || paid != 0 || claimOfInvoice[invoiceId] != 0) revert InvoiceNotListable();
        uint64 lockWindow = claimToken.LOCK_WINDOW();
        if (
            price == 0 || price >= amount || recourseBps > BPS || offerDeadline <= block.timestamp
                || dueDate < lockWindow || offerDeadline > dueDate - lockWindow
        ) {
            revert BadTerms();
        }
        claimId = ++offerCount;
        offers[claimId] = Offer(
            OFFER_INVOICE, msg.sender, offerDeadline, recourseBps, false, false, invoiceId, amount, price, dueDate, 0
        );
        claimOfInvoice[invoiceId] = claimId;
        emit OfferListed(
            claimId, msg.sender, OFFER_INVOICE, invoiceId, amount, price, recourseBps, offerDeadline, dueDate
        );
    }

    /// @notice The merchant withdraws an offer nobody has funded yet.
    function cancelOffer(uint256 claimId) external {
        Offer storage offer = offers[claimId];
        if (offer.merchant != msg.sender) revert NotMerchant();
        if (offer.cancelled || offer.settled) revert OfferClosed();
        if (offer.sold != 0) revert AlreadyFunded();
        offer.cancelled = true;
        if (offer.kind == OFFER_ADVANCE) advanceOf[msg.sender] = 0;
        else claimOfInvoice[offer.invoiceId] = 0;
        emit OfferCancelled(claimId);
    }

    // ---------- funding: delivery versus payment (FR-ADV-3, FR-INV-3) ----------

    /// @notice Investor-submitted funding (approve the market first). Investors normally use fundWithAuthorization.
    function fund(uint256 claimId, uint256 units) external nonReentrant {
        (address merchant, uint256 cost) = _prepareFunding(claimId, msg.sender, units);
        usdt.safeTransferFrom(msg.sender, merchant, cost);
        claimToken.mint(msg.sender, claimId, units);
    }

    /// @notice Gasless funding: `investor` signs a ReceiveWithAuthorization for `quote(claimId, units)` to this
    ///         contract with nonce `fundingNonce(claimId, investor, units, salt)`; anyone submits it.
    function fundWithAuthorization(
        uint256 claimId,
        address investor,
        uint256 units,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        (address merchant, uint256 cost) = _prepareFunding(claimId, investor, units);
        IERC3009(address(usdt))
            .receiveWithAuthorization(
                investor,
                address(this),
                cost,
                validAfter,
                validBefore,
                fundingNonce(claimId, investor, units, salt),
                v,
                r,
                s
            );
        usdt.safeTransfer(merchant, cost);
        claimToken.mint(investor, claimId, units);
    }

    // ---------- repayment from MerchantPay (FR-ADV-4/5, FR-INV-4) ----------

    /// @inheritdoc ICapitalMarket
    function onPayment(address merchant, uint256 invoiceId, uint256 gross, uint256 net, uint256 paymentId)
        external
        nonReentrant
        returns (uint256 toInvestors)
    {
        if (msg.sender != address(merchantPay)) revert NotMerchantPay();
        uint256 remaining = net;
        if (invoiceId != 0) {
            uint256 invoiceClaim = claimOfInvoice[invoiceId];
            uint256 owedOnInvoice = invoiceClaim == 0 ? 0 : claimToken.totalSupply(invoiceClaim);
            if (owedOnInvoice != 0) {
                uint256 take = Math.min(remaining, owedOnInvoice);
                _distribute(invoiceClaim, take, paymentId);
                remaining -= take;
            }
        }
        uint256 advance = advanceOf[merchant];
        uint256 owedOnAdvance = advance == 0 ? 0 : claimToken.totalSupply(advance);
        if (owedOnAdvance != 0 && remaining != 0) {
            uint256 take = Math.min(Math.min(gross * offers[advance].bps / BPS, owedOnAdvance), remaining);
            if (take != 0) {
                _distribute(advance, take, paymentId);
                remaining -= take;
            }
        }
        toInvestors = net - remaining;
        if (remaining != 0) usdt.safeTransfer(merchant, remaining);
    }

    /// @notice Pull fallback for a holder whose push failed (for example a USDT-blocklisted address).
    function withdrawOwed() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        totalOwed -= amount;
        emit OwedWithdrawn(msg.sender, amount);
        usdt.safeTransfer(msg.sender, amount);
    }

    // ---------- views ----------

    /// @notice USDT an investor pays for `units` (rounded up, at most 0.000001 USDT in the merchant's favour).
    function quote(uint256 claimId, uint256 units) public view returns (uint256) {
        Offer storage offer = offers[claimId];
        if (offer.face == 0) return 0;
        return Math.mulDiv(units, offer.price, offer.face, Math.Rounding.Ceil);
    }

    function fundingNonce(uint256 claimId, address investor, uint256 units, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), claimId, investor, units, salt));
    }

    function outstanding(uint256 claimId) external view returns (uint256) {
        return claimToken.totalSupply(claimId);
    }

    /// @notice Claims repaid from `merchant`'s sales (Phase 3: at most the running advance).
    function liensOf(address merchant) external view returns (uint256[] memory liens) {
        uint256 advance = advanceOf[merchant];
        if (advance == 0 || claimToken.totalSupply(advance) == 0) return new uint256[](0);
        liens = new uint256[](1);
        liens[0] = advance;
    }

    /// @inheritdoc ICapitalMarket
    function hasClaimsOn(address merchant, uint256 invoiceId) external view returns (bool) {
        uint256 invoiceClaim = invoiceId == 0 ? 0 : claimOfInvoice[invoiceId];
        if (invoiceClaim != 0 && claimToken.totalSupply(invoiceClaim) != 0) return true;
        uint256 advance = advanceOf[merchant];
        return advance != 0 && claimToken.totalSupply(advance) != 0;
    }

    /// @inheritdoc ICapitalMarket
    function isFinanced(uint256 invoiceId) external view returns (bool) {
        uint256 claimId = claimOfInvoice[invoiceId];
        return claimId != 0 && offers[claimId].sold != 0;
    }

    // ---------- internals ----------

    // forge-lint: disable-next-item(reentrancy-events, reentrancy-no-eth, calls-loop) every call here goes to the
    // immutable ClaimToken, MerchantPay or USDT, every entry point is nonReentrant, and loops are capped at 8 holders
    /// @dev Checks and effects of a funding; returns who gets the USDT and how much.
    function _prepareFunding(uint256 claimId, address investor, uint256 units)
        private
        returns (address merchant, uint256 cost)
    {
        Offer storage offer = offers[claimId];
        if (offer.kind == 0 || offer.cancelled || offer.settled || block.timestamp > offer.offerDeadline) {
            revert OfferClosed();
        }
        if (units == 0 || uint256(offer.sold) + units > offer.face) revert WrongUnits();
        merchant = offer.merchant;
        if (offer.kind == OFFER_INVOICE) {
            // forge-lint: disable-next-line(unused-return) only the status and paid fields matter here
            (,, uint8 status,,, uint128 paid) = merchantPay.invoices(offer.invoiceId);
            if (status != INVOICE_OPEN || paid != 0) revert OfferClosed();
        }
        cost = quote(claimId, units);
        bool first = offer.sold == 0;
        offer.sold += SafeCast.toUint128(units);
        emit Funded(claimId, investor, units, cost);
        if (!first) return (merchant, cost);
        if (offer.kind == OFFER_INVOICE) {
            claimToken.setClaimState(claimId, offer.maturity - claimToken.LOCK_WINDOW(), false);
        } else {
            emit LienAdded(merchant, claimId, offer.bps);
        }
    }

    // forge-lint: disable-next-item(reentrancy-events, reentrancy-no-eth, calls-loop) every call here goes to the
    // immutable ClaimToken, MerchantPay or USDT, every entry point is nonReentrant, and loops are capped at 8 holders
    /// @dev Pays `amount` of a claim to its holders pro-rata and burns the units covered. Shares round down; the
    ///      leftover (< number of holders) goes one unit at a time to holders with spare balance, so no holder is
    ///      ever paid more than it is owed and no dust stays here. Burns first, then pushes; a failed push becomes a
    ///      pull balance. At most 8 holders (ClaimToken cap).
    function _distribute(uint256 claimId, uint256 amount, uint256 paymentId) private {
        address[] memory holders = claimToken.holdersOf(claimId);
        uint256 supply = claimToken.totalSupply(claimId);
        uint256 n = holders.length;
        uint256[] memory shares = new uint256[](n);
        uint256[] memory balances = new uint256[](n);
        uint256 assigned = 0;
        for (uint256 i = 0; i < n; ++i) {
            balances[i] = claimToken.balanceOf(holders[i], claimId);
            shares[i] = balances[i] * amount / supply;
            assigned += shares[i];
        }
        for (uint256 i = 0; assigned < amount; i = (i + 1) % n) {
            if (shares[i] < balances[i]) {
                ++shares[i];
                ++assigned;
            }
        }
        uint256 left = supply - amount; // the burns below remove exactly `amount` units
        emit Distributed(claimId, paymentId, amount, left);
        if (left == 0) _settle(claimId);
        for (uint256 i = 0; i < n; ++i) {
            if (shares[i] != 0) claimToken.burn(holders[i], claimId, shares[i]);
        }
        for (uint256 i = 0; i < n; ++i) {
            if (shares[i] != 0 && !usdt.trySafeTransfer(holders[i], shares[i])) {
                owed[holders[i]] += shares[i];
                totalOwed += shares[i];
                emit PushFailed(claimId, holders[i], shares[i]);
            }
        }
    }

    // forge-lint: disable-next-item(reentrancy-events, reentrancy-no-eth, calls-loop) every call here goes to the
    // immutable ClaimToken, MerchantPay or USDT, every entry point is nonReentrant, and loops are capped at 8 holders
    function _settle(uint256 claimId) private {
        Offer storage offer = offers[claimId];
        offer.settled = true;
        if (offer.kind == OFFER_ADVANCE && advanceOf[offer.merchant] == claimId) advanceOf[offer.merchant] = 0;
        emit Settled(claimId);
    }
}
