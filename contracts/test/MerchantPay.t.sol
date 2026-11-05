// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC3009} from "@openzeppelin/contracts/interfaces/draft-IERC3009.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MerchantPay} from "../src/MerchantPay.sol";
import {ICapitalMarket} from "../src/interfaces/ICapitalMarket.sol";

/// @notice Fork tests M1–M3 on Whitechain Sepolia 1874 against the real prize USDT
///         (SRS FR-PAY-1/2/3/5/6/8, FR-REL-4/7/9, NFR-1/2, CON-2/4). Signatures are built from the documented
///         nonce formula, exactly as the web and relayer lanes will, so a payment only succeeds if the contract agrees.
contract MerchantPayForkTest is Test {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    /// Large USDT holder that funds the test wallets (research_notes/build_prep/contracts_prep.md §5).
    address constant HOLDER = 0xFfD76ff981cc7EA15EE2F67680815763C4C7683E;
    /// Pinned: deterministic gas and cached RPC responses (Ankr serves historical state).
    uint256 constant FORK_BLOCK = 12_303_386;
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint8 constant KIND_INVOICE = 1;
    uint8 constant KIND_SALE = 2;
    uint256 constant SALE = 25e6; // AT-1: a 25 USDT shop sale
    uint256 constant FEE = 100_000; // 0.10 USDT

    struct Sig {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    MerchantPay mp;
    bytes32 domainSeparator;
    address merchant = makeAddr("merchant");
    address feeRecipient = makeAddr("feeRecipient");
    address anyone = makeAddr("anyone"); // the submitter: pay functions are permissionless (FR-REL-7)
    address payer;
    uint256 payerKey;
    uint256 validBefore;

    function setUp() public {
        vm.createSelectFork("whitechain", FORK_BLOCK);
        (payer, payerKey) = makeAddrAndKey("payer");
        mp = new MerchantPay(USDT, feeRecipient);
        domainSeparator = IERC20Permit(address(USDT)).DOMAIN_SEPARATOR();
        validBefore = block.timestamp + 15 minutes;
        vm.prank(HOLDER);
        USDT.transfer(payer, 100e6);
    }

    // ---------- helpers (no external calls, so expectRevert/expectEmit see the right call) ----------

    function _nonce(uint8 kind, uint256 ref, bytes32 orderRef, uint256 amount, bytes32 salt)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(uint256(1874), address(mp), kind, ref, orderRef, amount, salt));
    }

    function _saleNonce(address m, bytes32 orderRef, uint256 amount, bytes32 salt) internal view returns (bytes32) {
        return _nonce(KIND_SALE, uint256(uint160(m)), orderRef, amount, salt);
    }

    function _invoiceNonce(uint256 id, uint256 amount, bytes32 salt) internal view returns (bytes32) {
        return _nonce(KIND_INVOICE, id, bytes32(0), amount, salt);
    }

    function _sign(uint256 key, uint256 amount, bytes32 nonce) internal view returns (Sig memory sig) {
        bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, payer, address(mp), amount, 0, validBefore, nonce));
        (sig.v, sig.r, sig.s) = vm.sign(key, MessageHashUtils.toTypedDataHash(domainSeparator, structHash));
    }

    function _submitSale(address m, bytes32 orderRef, uint256 amount, bytes32 salt, Sig memory sig)
        internal
        returns (uint256)
    {
        vm.prank(anyone);
        return mp.paySale(m, orderRef, payer, amount, 0, validBefore, salt, sig.v, sig.r, sig.s);
    }

    function _submitInvoice(uint256 id, uint256 amount, bytes32 salt, Sig memory sig) internal returns (uint256) {
        vm.prank(anyone);
        return mp.payInvoice(id, payer, amount, 0, validBefore, salt, sig.v, sig.r, sig.s);
    }

    function _paySale(bytes32 orderRef, uint256 amount, bytes32 salt) internal returns (uint256) {
        return _submitSale(
            merchant, orderRef, amount, salt, _sign(payerKey, amount, _saleNonce(merchant, orderRef, amount, salt))
        );
    }

    function _payInvoice(uint256 id, uint256 amount, bytes32 salt) internal returns (uint256) {
        return _submitInvoice(id, amount, salt, _sign(payerKey, amount + FEE, _invoiceNonce(id, amount, salt)));
    }

    function _newInvoice(uint128 amount) internal returns (uint256 id) {
        vm.prank(merchant);
        id = mp.createInvoice(makeAddr("customer"), amount, uint64(block.timestamp + 30 days), keccak256("INV-001"));
    }

    function _bal(address a) internal view returns (uint256) {
        return USDT.balanceOf(a);
    }

    // ---------- setup and shared encoding (review F5) ----------

    function test_Constructor_SetsFeeRecipientAndOwner() public view {
        assertEq(mp.relayFee(), FEE);
        assertEq(mp.feeRecipient(), feeRecipient);
        assertEq(mp.owner(), address(this));
        assertEq(address(mp.usdt()), address(USDT));
    }

    function test_RevertWhen_ConstructedWithZeroAddress() public {
        vm.expectRevert(MerchantPay.ZeroAddress.selector);
        new MerchantPay(IERC20(address(0)), feeRecipient);
        vm.expectRevert(MerchantPay.ZeroAddress.selector);
        new MerchantPay(USDT, address(0));
    }

    function test_UsdtDomainMatchesTheFieldsOtherLanesHardCode() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Tether USD"),
                keccak256("1"),
                uint256(1874),
                address(USDT)
            )
        );
        assertEq(domainSeparator, expected);
    }

    function test_NonceViewsMatchTheDocumentedEncoding() public view {
        assertEq(mp.saleNonce(merchant, keccak256("o"), 5e6, "s1"), _saleNonce(merchant, keccak256("o"), 5e6, "s1"));
        assertEq(mp.invoiceNonce(7, 5e6, "s1"), _invoiceNonce(7, 5e6, "s1"));
        assertEq(mp.KIND_INVOICE(), KIND_INVOICE);
        assertEq(mp.KIND_SALE(), KIND_SALE);
    }

    // ---------- invoices: FR-PAY-1, FR-PAY-2 ----------

    function test_CreateInvoice_StoresAndEmits() public {
        uint64 due = uint64(block.timestamp + 30 days);
        address customer = makeAddr("customer");
        vm.expectEmit(true, true, true, true, address(mp));
        emit MerchantPay.InvoiceCreated(1, merchant, customer, 1000e6, due, keccak256("INV-001"));
        vm.prank(merchant);
        uint256 id = mp.createInvoice(customer, 1000e6, due, keccak256("INV-001"));

        assertEq(id, 1);
        (address m, uint64 d, MerchantPay.InvoiceStatus st, address c, uint128 amount, uint128 paid) = mp.invoices(id);
        assertEq(m, merchant);
        assertEq(d, due);
        assertEq(uint8(st), uint8(MerchantPay.InvoiceStatus.Open));
        assertEq(c, customer);
        assertEq(amount, 1000e6);
        assertEq(paid, 0);
    }

    function test_RevertWhen_InvoiceBelowMinimum() public {
        vm.expectRevert(MerchantPay.WrongAmount.selector);
        vm.prank(merchant);
        mp.createInvoice(address(0), 999_999, uint64(block.timestamp + 1 days), bytes32(0));
    }

    function test_RevertWhen_InvoiceDueDateNotInFuture() public {
        vm.expectRevert(MerchantPay.InvalidDueDate.selector);
        vm.prank(merchant);
        mp.createInvoice(address(0), 5e6, uint64(block.timestamp), bytes32(0));
    }

    function test_CancelInvoice_ByItsMerchantOnly() public {
        uint256 id = _newInvoice(5e6);
        vm.expectRevert(MerchantPay.NotMerchant.selector);
        vm.prank(anyone);
        mp.cancelInvoice(id);

        vm.expectEmit(true, false, false, false, address(mp));
        emit MerchantPay.InvoiceCancelled(id);
        vm.prank(merchant);
        mp.cancelInvoice(id);
        (,, MerchantPay.InvoiceStatus st,,,) = mp.invoices(id);
        assertEq(uint8(st), uint8(MerchantPay.InvoiceStatus.Cancelled));
    }

    function test_RevertWhen_CancellingPaidInvoice() public {
        uint256 id = _newInvoice(5e6);
        _payInvoice(id, 5e6, "s1");
        vm.expectRevert(MerchantPay.InvoiceNotOpen.selector);
        vm.prank(merchant);
        mp.cancelInvoice(id);
    }

    // ---------- M1: pay an invoice (FR-PAY-3, FR-PAY-6, FR-REL-4, FR-REL-7, CON-4) ----------

    function test_PayInvoice_SplitsFeeAndMerchant_PayerNeedsNoGas() public {
        uint256 id = _newInvoice(uint128(SALE));
        Sig memory sig = _sign(payerKey, SALE + FEE, _invoiceNonce(id, SALE, "s1"));
        uint256 payerBefore = _bal(payer);
        assertEq(payer.balance, 0, "payer holds no WBT");

        vm.expectEmit(true, true, true, true, address(mp));
        emit MerchantPay.Paid(1, merchant, payer, id, bytes32(0), SALE + FEE, FEE, 0, SALE);
        uint256 paymentId = _submitInvoice(id, SALE, "s1", sig);

        assertEq(paymentId, 1);
        assertEq(_bal(merchant), SALE, "merchant gets the full invoice amount (fee on top)");
        assertEq(_bal(feeRecipient), FEE, "relay fee");
        assertEq(_bal(payer), payerBefore - SALE - FEE, "payer paid amount + fee");
        assertEq(_bal(address(mp)), 0, "MerchantPay keeps nothing");
        assertEq(payer.balance, 0, "payer still holds no WBT");
        (,, MerchantPay.InvoiceStatus st,,, uint128 paid) = mp.invoices(id);
        assertEq(uint8(st), uint8(MerchantPay.InvoiceStatus.Paid));
        assertEq(paid, SALE);
        (address m, uint96 gross, address p, uint96 refunded) = mp.payments(paymentId);
        assertEq(m, merchant);
        assertEq(gross, SALE + FEE);
        assertEq(p, payer);
        assertEq(refunded, 0);
    }

    function test_RevertWhen_InvoiceSignatureUsedForAnotherInvoice() public {
        uint256 a = _newInvoice(5e6);
        uint256 b = _newInvoice(5e6);
        Sig memory sig = _sign(payerKey, 5e6 + FEE, _invoiceNonce(a, 5e6, "s1"));
        vm.expectRevert(bytes("TetherToken: invalid signature"));
        _submitInvoice(b, 5e6, "s1", sig);
    }

    function test_RevertWhen_InvoicePaidTwice() public {
        uint256 id = _newInvoice(5e6);
        Sig memory sig = _sign(payerKey, 5e6 + FEE, _invoiceNonce(id, 5e6, "s1"));
        _submitInvoice(id, 5e6, "s1", sig);
        vm.expectRevert(MerchantPay.InvoiceNotOpen.selector);
        _submitInvoice(id, 5e6, "s1", sig);
    }

    function test_RevertWhen_PayingCancelledOrUnknownInvoice() public {
        uint256 id = _newInvoice(5e6);
        vm.prank(merchant);
        mp.cancelInvoice(id);
        Sig memory sig = _sign(payerKey, 5e6 + FEE, _invoiceNonce(id, 5e6, "s1"));
        vm.expectRevert(MerchantPay.InvoiceNotOpen.selector);
        _submitInvoice(id, 5e6, "s1", sig);

        Sig memory unknown = _sign(payerKey, 5e6 + FEE, _invoiceNonce(99, 5e6, "s1"));
        vm.expectRevert(MerchantPay.InvoiceNotOpen.selector);
        _submitInvoice(99, 5e6, "s1", unknown);
    }

    /// FR-INV-4: partial payments are allowed (at least 1 USDT, or exactly what is still owed); overpaying reverts.
    function test_PayInvoice_PartialThenRest_OverpaymentReverts() public {
        uint256 id = _newInvoice(5e6);
        Sig memory over = _sign(payerKey, 6e6 + FEE, _invoiceNonce(id, 6e6, "s1"));
        vm.expectRevert(MerchantPay.WrongAmount.selector);
        _submitInvoice(id, 6e6, "s1", over);

        Sig memory dust = _sign(payerKey, 500_000 + FEE, _invoiceNonce(id, 500_000, "s1"));
        vm.expectRevert(MerchantPay.WrongAmount.selector);
        _submitInvoice(id, 500_000, "s1", dust);

        _payInvoice(id, 4e6, "s1");
        (,, MerchantPay.InvoiceStatus st,,, uint128 paid) = mp.invoices(id);
        assertEq(uint8(st), uint8(MerchantPay.InvoiceStatus.Open), "still open after a partial payment");
        assertEq(paid, 4e6);

        _payInvoice(id, 1e6, "s2"); // the exact remainder
        (,, st,,, paid) = mp.invoices(id);
        assertEq(uint8(st), uint8(MerchantPay.InvoiceStatus.Paid));
        assertEq(paid, 5e6);
        assertEq(_bal(merchant), 5e6, "merchant credited both parts in full");
    }

    /// A copied signature can't be redeemed on the token by anyone but MerchantPay (front-run safety, DEP-1).
    function test_RevertWhen_ThirdPartyRedeemsAuthorizationOnToken() public {
        uint256 id = _newInvoice(5e6);
        bytes32 nonce = _invoiceNonce(id, 5e6, "s1");
        Sig memory sig = _sign(payerKey, 5e6, nonce);
        vm.expectRevert(bytes("TetherToken: to != msg.sender"));
        vm.prank(anyone);
        IERC3009(address(USDT))
            .receiveWithAuthorization(payer, address(mp), 5e6, 0, validBefore, nonce, sig.v, sig.r, sig.s);
    }

    // ---------- M2: pay a checkout sale (FR-PAY-5, FR-PAY-6, FR-REL-4, FR-REL-9) ----------

    function test_PaySale_SplitsFeeAndMerchant_PayerNeedsNoGas() public {
        bytes32 orderRef = keccak256("order-1");
        Sig memory sig = _sign(payerKey, SALE, _saleNonce(merchant, orderRef, SALE, "s1"));
        uint256 payerBefore = _bal(payer);

        vm.expectEmit(true, true, true, true, address(mp));
        emit MerchantPay.Paid(1, merchant, payer, 0, orderRef, SALE, FEE, 0, SALE - FEE);
        uint256 paymentId = _submitSale(merchant, orderRef, SALE, "s1", sig);

        assertEq(paymentId, 1);
        assertEq(mp.saleOf(merchant, orderRef), 1);
        assertEq(_bal(merchant), SALE - FEE);
        assertEq(_bal(feeRecipient), FEE);
        assertEq(_bal(payer), payerBefore - SALE);
        assertEq(_bal(address(mp)), 0);
        assertEq(payer.balance, 0);
    }

    function test_RevertWhen_SaleBelowMinimum() public {
        bytes32 orderRef = keccak256("order-1");
        Sig memory sig = _sign(payerKey, 999_999, _saleNonce(merchant, orderRef, 999_999, "s1"));
        vm.expectRevert(MerchantPay.WrongAmount.selector);
        _submitSale(merchant, orderRef, 999_999, "s1", sig);
    }

    function test_RevertWhen_SaleSignatureReusedForAnotherPayment() public {
        bytes32 orderRef = keccak256("order-1");
        address otherMerchant = makeAddr("otherMerchant");
        Sig memory sig = _sign(payerKey, 5e6, _saleNonce(merchant, orderRef, 5e6, "s1"));

        vm.expectRevert(bytes("TetherToken: invalid signature"));
        _submitSale(otherMerchant, orderRef, 5e6, "s1", sig);
        vm.expectRevert(bytes("TetherToken: invalid signature"));
        _submitSale(merchant, keccak256("order-2"), 5e6, "s1", sig);
        vm.expectRevert(bytes("TetherToken: invalid signature"));
        _submitSale(merchant, orderRef, 6e6, "s1", sig);
        vm.expectRevert(bytes("TetherToken: invalid signature"));
        _submitSale(merchant, orderRef, 5e6, "s2", sig);
    }

    function test_RevertWhen_OrderPaidTwice() public {
        bytes32 orderRef = keccak256("order-1");
        _paySale(orderRef, 5e6, "s1");
        Sig memory again = _sign(payerKey, 5e6, _saleNonce(merchant, orderRef, 5e6, "s2"));
        vm.expectRevert(MerchantPay.OrderPaid.selector);
        _submitSale(merchant, orderRef, 5e6, "s2", again);
    }

    function test_RevertWhen_SaleHasNoMerchantOrOrderRef() public {
        Sig memory noMerchant = _sign(payerKey, 5e6, _saleNonce(address(0), keccak256("o"), 5e6, "s1"));
        vm.expectRevert(MerchantPay.InvalidOrder.selector);
        _submitSale(address(0), keccak256("o"), 5e6, "s1", noMerchant);

        Sig memory noOrder = _sign(payerKey, 5e6, _saleNonce(merchant, bytes32(0), 5e6, "s1"));
        vm.expectRevert(MerchantPay.InvalidOrder.selector);
        _submitSale(merchant, bytes32(0), 5e6, "s1", noOrder);
    }

    function test_SetRelayFee_OwnerOnlyAndCapped() public {
        address stranger = makeAddr("stranger");
        address newRecipient = makeAddr("newRecipient");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        mp.setRelayFee(200_000, stranger);

        vm.expectRevert(MerchantPay.FeeTooHigh.selector);
        mp.setRelayFee(250_001, feeRecipient);

        vm.expectRevert(MerchantPay.ZeroAddress.selector);
        mp.setRelayFee(200_000, address(0));

        vm.expectEmit(false, false, false, true, address(mp));
        emit MerchantPay.RelayFeeSet(250_000, newRecipient);
        mp.setRelayFee(250_000, newRecipient);

        _paySale(keccak256("order-1"), 5e6, "s1");
        assertEq(_bal(newRecipient), 250_000);
        assertEq(_bal(merchant), 5e6 - 250_000);
    }

    function test_Pause_StopsPaymentsUntilUnpaused() public {
        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        mp.pause();

        mp.pause();
        bytes32 orderRef = keccak256("order-1");
        Sig memory sig = _sign(payerKey, 5e6, _saleNonce(merchant, orderRef, 5e6, "s1"));
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _submitSale(merchant, orderRef, 5e6, "s1", sig);

        uint256 id = _newInvoice(5e6); // invoice admin still works while paused
        Sig memory isig = _sign(payerKey, 5e6 + FEE, _invoiceNonce(id, 5e6, "s1"));
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _submitInvoice(id, 5e6, "s1", isig);

        mp.unpause();
        _submitSale(merchant, orderRef, 5e6, "s1", sig);
        assertEq(_bal(merchant), 5e6 - FEE);
    }

    // ---------- M3: refunds (FR-PAY-8) ----------

    function test_Refund_PartialThenFull_FromMerchantWallet() public {
        uint256 paymentId = _paySale(keccak256("order-1"), SALE, "s1");
        uint256 payerBefore = _bal(payer);
        vm.prank(merchant);
        USDT.approve(address(mp), type(uint256).max);

        vm.expectEmit(true, false, false, true, address(mp));
        emit MerchantPay.Refunded(paymentId, 10e6, 10e6);
        vm.prank(merchant);
        mp.refund(paymentId, 10e6);
        assertEq(_bal(payer), payerBefore + 10e6);

        vm.prank(HOLDER);
        USDT.transfer(merchant, FEE); // a full refund returns the gross; the 0.10 fee is the merchant's cost
        vm.prank(merchant);
        mp.refund(paymentId, SALE - 10e6);
        assertEq(_bal(payer), payerBefore + SALE);
        (,,, uint96 refunded) = mp.payments(paymentId);
        assertEq(refunded, SALE);
        assertEq(_bal(address(mp)), 0);
        assertEq(_bal(feeRecipient), FEE, "fee recipient untouched");

        vm.expectRevert(MerchantPay.RefundTooLarge.selector);
        vm.prank(merchant);
        mp.refund(paymentId, 1);
    }

    function test_RevertWhen_RefundByAnyoneButThatMerchant() public {
        uint256 paymentId = _paySale(keccak256("order-1"), SALE, "s1");
        address[3] memory others = [payer, anyone, address(this)];
        for (uint256 i; i < others.length; ++i) {
            vm.expectRevert(MerchantPay.NotMerchant.selector);
            vm.prank(others[i]);
            mp.refund(paymentId, 1e6);
        }
        vm.expectRevert(MerchantPay.NotMerchant.selector);
        vm.prank(merchant);
        mp.refund(999, 1e6);
    }

    function test_RevertWhen_RefundIsZero() public {
        uint256 paymentId = _paySale(keccak256("order-1"), SALE, "s1");
        vm.expectRevert(MerchantPay.WrongAmount.selector);
        vm.prank(merchant);
        mp.refund(paymentId, 0);
    }

    function test_Refund_WorksWhilePaused_ForInvoicePayments() public {
        uint256 paymentId = _payInvoice(_newInvoice(5e6), 5e6, "s1");
        mp.pause();
        uint256 payerBefore = _bal(payer);
        vm.startPrank(merchant);
        USDT.approve(address(mp), 4e6);
        mp.refund(paymentId, 4e6);
        vm.stopPrank();
        assertEq(_bal(payer), payerBefore + 4e6);
        assertEq(_bal(merchant), 5e6 - 4e6, "invoice credited in full, then 4 refunded");
    }

    // ---------- F1 (Phase 2 part): every unit of the gross is accounted for, nothing stays (NFR-2) ----------

    function testFuzz_SplitAddsUpAndNothingStays(uint256 amount, uint256 fee, uint256 refundSeed) public {
        amount = bound(amount, 1e6, 100e6);
        fee = bound(fee, 0, 250_000);
        mp.setRelayFee(fee, feeRecipient);

        uint256 paymentId = _paySale(keccak256(abi.encode(amount, fee)), amount, "s1");
        assertEq(_bal(merchant) + _bal(feeRecipient), amount, "fee + toMerchant == gross");
        assertEq(_bal(feeRecipient), fee);
        assertEq(_bal(address(mp)), 0);

        uint256 refundAmount = bound(refundSeed, 1, amount - fee);
        uint256 payerBefore = _bal(payer);
        vm.startPrank(merchant);
        USDT.approve(address(mp), refundAmount);
        mp.refund(paymentId, refundAmount);
        vm.stopPrank();
        assertEq(_bal(payer), payerBefore + refundAmount);
        assertEq(_bal(address(mp)), 0);
    }

    // ---------- v2 guards and owner tools (human 23:40; batch 002 review findings) ----------

    function test_RevertWhen_SaleMerchantIsMerchantPayItself() public {
        Sig memory sig = _sign(payerKey, 5e6, _saleNonce(address(mp), keccak256("o"), 5e6, "s1"));
        vm.expectRevert(MerchantPay.InvalidOrder.selector);
        _submitSale(address(mp), keccak256("o"), 5e6, "s1", sig);
    }

    function test_RevertWhen_FeeRecipientIsMerchantPayItself() public {
        vm.expectRevert(MerchantPay.ZeroAddress.selector);
        mp.setRelayFee(FEE, address(mp));
    }

    function test_RevertWhen_InvoiceAmountAboveUint96() public {
        vm.expectRevert(MerchantPay.WrongAmount.selector);
        vm.prank(merchant);
        mp.createInvoice(
            address(0), uint128(type(uint96).max - 250_000) + 1, uint64(block.timestamp + 1 days), bytes32(0)
        ); // amount + max fee must fit uint96
    }

    function test_RevertWhen_CancellingPartPaidInvoice() public {
        uint256 id = _newInvoice(5e6);
        _payInvoice(id, 2e6, "s1");
        vm.expectRevert(MerchantPay.InvoiceNotOpen.selector);
        vm.prank(merchant);
        mp.cancelInvoice(id);
    }

    function test_SetMarket_OwnerOnlyAndOnce() public {
        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        mp.setMarket(ICapitalMarket(makeAddr("market")));

        vm.expectRevert(MerchantPay.ZeroAddress.selector);
        mp.setMarket(ICapitalMarket(address(0)));

        vm.expectEmit(false, false, false, true, address(mp));
        emit MerchantPay.MarketSet(makeAddr("market"));
        mp.setMarket(ICapitalMarket(makeAddr("market")));

        vm.expectRevert(MerchantPay.MarketAlreadySet.selector);
        mp.setMarket(ICapitalMarket(makeAddr("market2")));
    }

    function test_Sweep_OwnerRecoversStrayUsdt() public {
        vm.prank(HOLDER);
        USDT.transfer(address(mp), 3e6); // a plain transfer, not a payment
        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        mp.sweep(stranger);

        vm.expectRevert(MerchantPay.ZeroAddress.selector);
        mp.sweep(address(0));

        address treasury = makeAddr("treasury");
        vm.expectEmit(true, false, false, true, address(mp));
        emit MerchantPay.Swept(treasury, 3e6);
        mp.sweep(treasury);
        assertEq(_bal(treasury), 3e6);
        assertEq(_bal(address(mp)), 0);
    }

    function test_Ownership_TransfersInTwoSteps() public {
        address newOwner = makeAddr("newOwner");
        mp.transferOwnership(newOwner);
        assertEq(mp.owner(), address(this), "not yet");
        vm.prank(newOwner);
        mp.acceptOwnership();
        assertEq(mp.owner(), newOwner);
    }
}
