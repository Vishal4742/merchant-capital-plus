// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC3009} from "@openzeppelin/contracts/interfaces/draft-IERC3009.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerchantPay} from "../src/MerchantPay.sol";
import {CapitalMarket} from "../src/CapitalMarket.sol";
import {ClaimToken} from "../src/ClaimToken.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {IInvestorRegistry} from "../src/interfaces/IInvestorRegistry.sol";
import {ICapitalMarket} from "../src/interfaces/ICapitalMarket.sol";

/// @notice Tester probes for batch 005 (round 1): edge cases the builder's suite didn't pin down.
///         Many holders with odd balances, an invoice paid while the merchant also has an advance, funding after a
///         partial payment, a 9th holder, two failed pushes, and a reverting market. Fork of chain 1874, real USDT.
///         (SRS FR-ADV-4/5, FR-INV-3/4, FR-TOK-3/7, NFR-1, NFR-2)
contract CapitalMarketProbeForkTest is Test {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    address constant HOLDER = 0xFfD76ff981cc7EA15EE2F67680815763C4C7683E;
    uint256 constant FORK_BLOCK = 12_303_386;
    uint64 constant LOCK_WINDOW = 60;
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint256 constant FEE = 100_000;
    uint128 constant PRINCIPAL = 10e6;
    uint128 constant CAP = 11e6;
    uint16 constant HOLDBACK = 2000;
    uint128 constant FACE = 100e6;
    uint128 constant PRICE = 98_065_556;
    uint256 constant N = 9; // one more investor than the holder cap

    InvestorRegistry registry;
    ClaimToken claims;
    MerchantPay mp;
    CapitalMarket market;
    bytes32 domainSeparator;
    uint256 validBefore;
    address merchant = makeAddr("merchant");
    address feeRecipient = makeAddr("feeRecipient");
    address anyone = makeAddr("anyone");
    address[N] inv;
    uint256[N] invKey;
    address customer;
    uint256 customerKey;

    function setUp() public {
        vm.createSelectFork("whitechain", FORK_BLOCK);
        (customer, customerKey) = makeAddrAndKey("customer");
        registry = new InvestorRegistry(address(this));
        claims = new ClaimToken(IInvestorRegistry(address(registry)), address(this), LOCK_WINDOW);
        mp = new MerchantPay(USDT, feeRecipient);
        market = new CapitalMarket(address(mp), claims, USDT);
        claims.setMarket(address(market));
        mp.setMarket(ICapitalMarket(address(market)));
        domainSeparator = IERC20Permit(address(USDT)).DOMAIN_SEPARATOR();
        validBefore = block.timestamp + 15 minutes;
        vm.startPrank(HOLDER);
        USDT.transfer(customer, 1000e6);
        for (uint256 i; i < N; ++i) {
            (inv[i], invKey[i]) = makeAddrAndKey(string.concat("inv", vm.toString(i)));
            USDT.transfer(inv[i], 200e6);
        }
        vm.stopPrank();
        for (uint256 i; i < N; ++i) {
            registry.setEligible(inv[i], type(uint64).max);
        }
    }

    // ---------- helpers ----------

    function _sig(uint256 key, address from, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, from, to, value, 0, validBefore, nonce));
        return vm.sign(key, MessageHashUtils.toTypedDataHash(domainSeparator, structHash));
    }

    function _fund(uint256 i, uint256 claimId, uint256 units) internal {
        uint256 cost = market.quote(claimId, units);
        bytes32 nonce = market.fundingNonce(claimId, inv[i], units, "f");
        (uint8 v, bytes32 r, bytes32 s) = _sig(invKey[i], inv[i], address(market), cost, nonce);
        vm.prank(anyone);
        market.fundWithAuthorization(claimId, inv[i], units, 0, validBefore, "f", v, r, s);
    }

    function _sale(uint256 amount, bytes32 orderRef) internal returns (uint256) {
        bytes32 nonce = mp.saleNonce(merchant, orderRef, amount, "s");
        (uint8 v, bytes32 r, bytes32 s) = _sig(customerKey, customer, address(mp), amount, nonce);
        vm.prank(anyone);
        return mp.paySale(merchant, orderRef, customer, amount, 0, validBefore, "s", v, r, s);
    }

    function _payInvoice(uint256 id, uint256 amount, bytes32 salt) internal {
        bytes32 nonce = mp.invoiceNonce(id, amount, salt);
        (uint8 v, bytes32 r, bytes32 s) = _sig(customerKey, customer, address(mp), amount + FEE, nonce);
        vm.prank(anyone);
        mp.payInvoice(id, customer, amount, 0, validBefore, salt, v, r, s);
    }

    function _listAdvance() internal returns (uint256 claimId) {
        vm.prank(merchant);
        claimId = market.listAdvance(PRINCIPAL, CAP, HOLDBACK, 30 days, uint64(block.timestamp + 1 days));
    }

    function _listInvoice(uint128 face, uint128 price) internal returns (uint256 invoiceId, uint256 claimId) {
        vm.startPrank(merchant);
        invoiceId = mp.createInvoice(customer, face, uint64(block.timestamp + 60 days), keccak256("inv"));
        claimId = market.listInvoice(invoiceId, price, uint64(block.timestamp + 1 days), 0);
        vm.stopPrank();
    }

    function _bal(address a) internal view returns (uint256) {
        return USDT.balanceOf(a);
    }

    /// @dev Pays `payment` on the invoice and checks, per holder, USDT received == units burned <= balance held,
    ///      the holders get exactly `payment`, and the market keeps nothing.
    function _payAndCheckProRata(uint256 invoiceId, uint256 claimId, uint256 n, uint256 payment, bytes32 salt)
        internal
    {
        uint256[] memory usdtBefore = new uint256[](n);
        uint256[] memory unitsBefore = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            usdtBefore[i] = _bal(inv[i]);
            unitsBefore[i] = claims.balanceOf(inv[i], claimId);
        }
        uint256 supplyBefore = market.outstanding(claimId);
        _payInvoice(invoiceId, payment, salt);
        uint256 paidTotal;
        for (uint256 i; i < n; ++i) {
            uint256 got = _bal(inv[i]) - usdtBefore[i];
            uint256 burned = unitsBefore[i] - claims.balanceOf(inv[i], claimId);
            assertEq(got, burned, "each holder: USDT received == units burned");
            assertLe(got, unitsBefore[i], "never more than the holder was owed");
            // pro-rata: within one unit of the exact share
            uint256 exact = unitsBefore[i] * payment / supplyBefore;
            assertGe(got, exact, "at least the rounded-down share");
            assertLe(got, exact + 1, "at most one unit of leftover");
            paidTotal += got;
        }
        assertEq(paidTotal, payment, "holders get exactly the payment");
        assertEq(market.outstanding(claimId), supplyBefore - payment);
        assertEq(_bal(address(market)), 0, "no dust in the market");
        assertEq(_bal(address(mp)), 0, "nothing in MerchantPay");
    }

    // ---------- 1. three holders with odd balances through _distribute (C3, FR-INV-4) ----------

    function test_ThreeHoldersOddBalances_ExactPayoutsNoDust_ThenSettled() public {
        (uint256 invoiceId, uint256 claimId) = _listInvoice(FACE, PRICE);
        _fund(0, claimId, 33_333_333);
        _fund(1, claimId, 33_333_333);
        _fund(2, claimId, 33_333_334);

        _payAndCheckProRata(invoiceId, claimId, 3, 1_000_001, "p1"); // leftover of 2 units after rounding down
        _payAndCheckProRata(invoiceId, claimId, 3, 7_777_777, "p2");

        uint256 rest = market.outstanding(claimId);
        vm.expectEmit(true, false, false, false, address(market));
        emit CapitalMarket.Settled(claimId);
        _payAndCheckProRata(invoiceId, claimId, 3, rest, "p3");
        assertEq(claims.holdersOf(claimId).length, 0, "every holder burned to zero");
        (,,,,, bool settled,,,,,) = market.offers(claimId);
        assertTrue(settled);
    }

    /// forge-config: default.fuzz.runs = 64
    function testFuzz_ThreeToEightHoldersOddSplits(uint256 n, uint256 seed, uint256 payment) public {
        n = bound(n, 3, 8);
        payment = bound(payment, 1e6, FACE - 1);
        (uint256 invoiceId, uint256 claimId) = _listInvoice(FACE, PRICE);
        uint256 left = FACE;
        for (uint256 i; i < n - 1; ++i) {
            uint256 units = bound(uint256(keccak256(abi.encode(seed, i))), 1, FACE / n);
            _fund(i, claimId, units);
            left -= units;
        }
        _fund(n - 1, claimId, left);

        _payAndCheckProRata(invoiceId, claimId, n, payment, "p1");
        _payAndCheckProRata(invoiceId, claimId, n, market.outstanding(claimId), "p2"); // exact remainder, may be < 1
        assertEq(market.outstanding(claimId), 0);
        assertEq(claims.holdersOf(claimId).length, 0);
    }

    // ---------- 2. invoice on a merchant that also has an advance: invoice holders first, lien from the rest ----------

    function test_InvoiceAndAdvance_InvoiceHoldersFirst_ThenLienFromTheRemainder() public {
        uint256 advance = _listAdvance();
        _fund(1, advance, CAP); // inv1 holds the advance
        (uint256 invoiceId, uint256 claimId) = _listInvoice(10e6, 9_500_000);
        _fund(0, claimId, 6e6); // inv0 funds 6 of the invoice's 10 units
        uint256 merchantBefore = _bal(merchant);
        uint256 a0 = _bal(inv[0]);
        uint256 a1 = _bal(inv[1]);

        vm.expectEmit(true, true, true, true, address(mp));
        // gross 10.1 (fee on top), toInvestors 6 (invoice) + 2 (20% of 10, lien), toMerchant 2
        emit MerchantPay.Paid(1, merchant, customer, invoiceId, bytes32(0), 10e6 + FEE, FEE, 8e6, 2e6);
        _payInvoice(invoiceId, 10e6, "p");

        assertEq(_bal(inv[0]) - a0, 6e6, "invoice holder repaid in full first");
        assertEq(_bal(inv[1]) - a1, 2e6, "lien: 20% of the credited 10");
        assertEq(_bal(merchant) - merchantBefore, 2e6, "merchant gets what is left");
        assertEq(market.outstanding(claimId), 0);
        assertEq(market.outstanding(advance), CAP - 2e6);
        assertEq(_bal(address(market)), 0);
        assertEq(_bal(address(mp)), 0);
    }

    function test_InvoiceAndAdvance_LienTakesOnlyTheRemainder() public {
        uint256 advance = _listAdvance();
        _fund(1, advance, CAP);
        (uint256 invoiceId, uint256 claimId) = _listInvoice(10e6, 9_500_000);
        _fund(0, claimId, 9e6); // only 1 unit of the 10 is unfinanced
        uint256 merchantBefore = _bal(merchant);
        uint256 a1 = _bal(inv[1]);

        _payInvoice(invoiceId, 10e6, "p");

        assertEq(_bal(inv[1]) - a1, 1e6, "lien capped by the remainder (1), not 20% (2)");
        assertEq(_bal(merchant), merchantBefore, "nothing left for the merchant");
        assertEq(market.outstanding(advance), CAP - 1e6);
        assertEq(_bal(address(market)), 0);
    }

    function test_InvoiceAndAdvance_FullyFinancedInvoiceLeavesTheLienUntouched() public {
        uint256 advance = _listAdvance();
        _fund(1, advance, CAP);
        (uint256 invoiceId, uint256 claimId) = _listInvoice(FACE, PRICE);
        _fund(0, claimId, FACE);
        uint256 merchantBefore = _bal(merchant);

        _payInvoice(invoiceId, 40e6, "p1"); // partial: all of it to the invoice holder
        assertEq(market.outstanding(claimId), 60e6);
        assertEq(market.outstanding(advance), CAP, "lien got nothing: no remainder");
        assertEq(_bal(merchant), merchantBefore);
        assertEq(_bal(address(market)), 0);
    }

    // ---------- 3. funding after a partial invoice payment must revert (FR-INV-3/4) ----------

    function test_RevertWhen_FundingAfterAPartialPaymentOnAFundedInvoice() public {
        (uint256 invoiceId, uint256 claimId) = _listInvoice(FACE, PRICE);
        _fund(0, claimId, 60e6);
        _payInvoice(invoiceId, 40e6, "p1");

        uint256 cost = market.quote(claimId, 40e6);
        (uint8 v, bytes32 r, bytes32 s) =
            _sig(invKey[1], inv[1], address(market), cost, market.fundingNonce(claimId, inv[1], 40e6, "f"));
        uint256 before = _bal(inv[1]);
        vm.expectRevert(CapitalMarket.OfferClosed.selector);
        vm.prank(anyone);
        market.fundWithAuthorization(claimId, inv[1], 40e6, 0, validBefore, "f", v, r, s);
        assertEq(_bal(inv[1]), before, "nothing moved");

        vm.startPrank(inv[1]);
        USDT.approve(address(market), cost);
        vm.expectRevert(CapitalMarket.OfferClosed.selector);
        market.fund(claimId, 40e6);
        vm.stopPrank();
    }

    function test_RevertWhen_FundingAfterAPartialPaymentOnAnUnfundedInvoice() public {
        (uint256 invoiceId, uint256 claimId) = _listInvoice(FACE, PRICE);
        uint256 merchantBefore = _bal(merchant);
        _payInvoice(invoiceId, 10e6, "p1"); // no holders yet: straight to the merchant
        assertEq(_bal(merchant) - merchantBefore, 10e6);

        vm.startPrank(inv[0]);
        USDT.approve(address(market), type(uint256).max);
        vm.expectRevert(CapitalMarket.OfferClosed.selector);
        market.fund(claimId, 1e6);
        vm.stopPrank();
    }

    function test_RevertWhen_FundingACancelledOrPaidInvoice() public {
        (uint256 cancelledId, uint256 claimA) = _listInvoice(FACE, PRICE);
        vm.prank(merchant);
        mp.cancelInvoice(cancelledId); // allowed: listed but not financed
        (uint256 paidId, uint256 claimB) = _listInvoice(FACE, PRICE);
        _payInvoice(paidId, FACE, "p");

        vm.startPrank(inv[0]);
        USDT.approve(address(market), type(uint256).max);
        vm.expectRevert(CapitalMarket.OfferClosed.selector);
        market.fund(claimA, 1e6);
        vm.expectRevert(CapitalMarket.OfferClosed.selector);
        market.fund(claimB, 1e6);
        vm.stopPrank();
    }

    // ---------- 4. the 9th investor (FR-TOK-3) ----------

    function test_RevertWhen_NinthInvestorFundsAClaim_NothingMoves() public {
        uint256 claimId = _listAdvance();
        for (uint256 i; i < 8; ++i) {
            _fund(i, claimId, 1e6);
        }
        uint256 cost = market.quote(claimId, 1e6);
        bytes32 nonce = market.fundingNonce(claimId, inv[8], 1e6, "f");
        (uint8 v, bytes32 r, bytes32 s) = _sig(invKey[8], inv[8], address(market), cost, nonce);
        uint256 investorBefore = _bal(inv[8]);
        uint256 merchantBefore = _bal(merchant);

        vm.expectRevert(abi.encodeWithSelector(ClaimToken.TooManyHolders.selector, claimId));
        vm.prank(anyone);
        market.fundWithAuthorization(claimId, inv[8], 1e6, 0, validBefore, "f", v, r, s);

        assertEq(_bal(inv[8]), investorBefore, "9th investor keeps the USDT");
        assertEq(_bal(merchant), merchantBefore, "merchant got nothing for it");
        assertFalse(IERC3009(address(USDT)).authorizationState(inv[8], nonce), "authorization not consumed");
        (,,,,,,,,,, uint128 sold) = market.offers(claimId);
        assertEq(sold, 8e6, "sold unchanged");
        assertEq(claims.holdersOf(claimId).length, 8);

        _fund(0, claimId, 2e6); // an existing holder can still add units (another amount, so another nonce)
        assertEq(claims.balanceOf(inv[0], claimId), 3e6);
    }

    // ---------- 5. withdrawOwed with two failed pushes (NFR-1, NFR-2) ----------

    function test_TwoFailedPushes_OwedAccumulates_MarketHoldsExactlyTotalOwed() public {
        uint256 claimId = _listAdvance();
        _fund(0, claimId, 5_500_000);
        _fund(1, claimId, 5_500_000);
        // Both holders are blocklisted (any amount): selector + address prefix match.
        vm.mockCallRevert(address(USDT), abi.encodeWithSelector(IERC20.transfer.selector, inv[0]), "blocked");
        vm.mockCallRevert(address(USDT), abi.encodeWithSelector(IERC20.transfer.selector, inv[1]), "blocked");

        _sale(10e6, "o1"); // 2 to holders: 1 each, both pushes fail
        assertEq(market.owed(inv[0]), 1e6);
        assertEq(market.owed(inv[1]), 1e6);
        assertEq(market.totalOwed(), 2e6);
        assertEq(_bal(address(market)), market.totalOwed(), "market holds exactly what it owes");
        assertEq(market.outstanding(claimId), 9e6, "units burned even though the push failed");

        vm.clearMockedCalls();
        vm.mockCallRevert(address(USDT), abi.encodeWithSelector(IERC20.transfer.selector, inv[0]), "blocked");
        uint256 b1 = _bal(inv[1]);
        _sale(10e6, "o2"); // inv0 still blocked, inv1 pushed directly
        assertEq(market.owed(inv[0]), 2e6, "second failure accumulates");
        assertEq(market.owed(inv[1]), 1e6, "a successful push doesn't touch owed");
        assertEq(_bal(inv[1]) - b1, 1e6);
        assertEq(market.totalOwed(), 3e6);
        assertEq(_bal(address(market)), 3e6);

        vm.expectRevert(); // still blocked: the pull reverts and the balance stays owed
        vm.prank(inv[0]);
        market.withdrawOwed();
        assertEq(market.owed(inv[0]), 2e6);
        assertEq(market.totalOwed(), 3e6);
        vm.clearMockedCalls();

        uint256 a0 = _bal(inv[0]);
        vm.prank(inv[0]);
        market.withdrawOwed();
        assertEq(_bal(inv[0]) - a0, 2e6);
        assertEq(market.totalOwed(), 1e6);
        assertEq(_bal(address(market)), 1e6);

        b1 = _bal(inv[1]);
        vm.prank(inv[1]);
        market.withdrawOwed();
        assertEq(_bal(inv[1]) - b1, 1e6);
        assertEq(market.totalOwed(), 0);
        assertEq(_bal(address(market)), 0);

        vm.expectRevert(CapitalMarket.NothingOwed.selector);
        vm.prank(inv[0]);
        market.withdrawOwed();
        vm.expectRevert(CapitalMarket.NothingOwed.selector);
        vm.prank(inv[1]);
        market.withdrawOwed();
    }

    // ---------- 6. MerchantPay routing when the market reverts: whole payment reverts, nothing stuck ----------

    function _reverts_saleNothingMoves(bytes memory expectedRevert) internal {
        bytes32 orderRef = keccak256("o1");
        bytes32 nonce = mp.saleNonce(merchant, orderRef, 5e6, "s");
        (uint8 v, bytes32 r, bytes32 s) = _sig(customerKey, customer, address(mp), 5e6, nonce);
        uint256 customerBefore = _bal(customer);
        uint256 merchantBefore = _bal(merchant);
        uint256 feeBefore = _bal(feeRecipient);
        uint256 investorBefore = _bal(inv[0]);
        uint256 countBefore = mp.paymentCount();

        if (expectedRevert.length == 0) vm.expectRevert();
        else vm.expectRevert(expectedRevert);
        vm.prank(anyone);
        mp.paySale(merchant, orderRef, customer, 5e6, 0, validBefore, "s", v, r, s);

        assertEq(_bal(customer), customerBefore, "payer keeps the USDT");
        assertEq(_bal(merchant), merchantBefore);
        assertEq(_bal(feeRecipient), feeBefore, "no fee taken");
        assertEq(_bal(inv[0]), investorBefore);
        assertEq(_bal(address(mp)), 0, "nothing stuck in MerchantPay");
        assertEq(_bal(address(market)), 0, "nothing stuck in the market");
        assertEq(mp.paymentCount(), countBefore);
        assertEq(mp.saleOf(merchant, orderRef), 0, "order still payable");
        assertFalse(IERC3009(address(USDT)).authorizationState(customer, nonce), "signature still usable");

        vm.clearMockedCalls();
        vm.prank(anyone);
        mp.paySale(merchant, orderRef, customer, 5e6, 0, validBefore, "s", v, r, s); // the retry goes through
        assertEq(_bal(inv[0]) - investorBefore, 1e6, "retry repays the lien");
        assertEq(_bal(address(mp)), 0);
        assertEq(_bal(address(market)), 0);
    }

    function test_RevertWhen_MarketOnPaymentReverts_WholeSaleReverts() public {
        _fund(0, _listAdvance(), CAP);
        vm.mockCallRevert(address(market), abi.encodeWithSelector(CapitalMarket.onPayment.selector), "market down");
        _reverts_saleNothingMoves(bytes("market down"));
    }

    function test_RevertWhen_MarketHasClaimsOnReverts_WholeSaleReverts() public {
        _fund(0, _listAdvance(), CAP);
        vm.mockCallRevert(address(market), abi.encodeWithSelector(CapitalMarket.hasClaimsOn.selector), "view down");
        _reverts_saleNothingMoves(bytes("view down"));
    }

    function test_RevertWhen_MarketReportsMoreThanNetToInvestors() public {
        _fund(0, _listAdvance(), CAP);
        // A market that claims it paid out more than it was sent: MerchantPay's checked math refuses it.
        vm.mockCall(
            address(market), abi.encodeWithSelector(CapitalMarket.onPayment.selector), abi.encode(5e6 - FEE + 1)
        );
        _reverts_saleNothingMoves(stdError.arithmeticError);
    }

    // ---------- 7. a revoked investor with frozen units is still repaid through the market (FR-TOK-7, FR-TOK-1) ----------

    function test_RevokedAndFrozenInvestorStillRepaidBySales() public {
        uint256 claimId = _listAdvance();
        _fund(0, claimId, CAP);
        registry.setEligible(inv[0], 0); // revoked
        claims.setFrozenTokens(inv[0], claimId, CAP); // and every unit frozen
        uint256 before = _bal(inv[0]);

        _sale(5e6, "o1");

        assertEq(_bal(inv[0]) - before, 1e6, "still paid");
        assertEq(claims.balanceOf(inv[0], claimId), CAP - 1e6);
        assertEq(claims.getFrozenTokens(inv[0], claimId), CAP - 1e6, "frozen lowered to the balance");
        assertEq(_bal(address(market)), 0);
    }

    // ---------- 8. the maturity lock never blocks repayment (FR-INV-5, FR-TOK-1) ----------

    function test_PaymentAfterTheLockAndDueDate_StillRepaysHolders() public {
        (uint256 invoiceId, uint256 claimId) = _listInvoice(FACE, PRICE);
        _fund(0, claimId, 60e6);
        _fund(1, claimId, 40e6);
        vm.warp(block.timestamp + 61 days); // past dueDate - LOCK_WINDOW and past dueDate
        validBefore = block.timestamp + 15 minutes;
        _payAndCheckProRata(invoiceId, claimId, 2, FACE, "late");
        assertEq(market.outstanding(claimId), 0);
    }

    // ---------- 9. cancelling an invoice offer frees the invoice for a new listing (cancelOffer invoice path) ----------

    function test_CancelInvoiceOffer_RelistAndFundTheNewOne() public {
        (uint256 invoiceId, uint256 oldClaim) = _listInvoice(FACE, PRICE);
        vm.startPrank(merchant);
        market.cancelOffer(oldClaim);
        assertEq(market.claimOfInvoice(invoiceId), 0);
        vm.expectRevert(CapitalMarket.OfferClosed.selector);
        market.cancelOffer(oldClaim); // twice
        uint256 newClaim = market.listInvoice(invoiceId, PRICE, uint64(block.timestamp + 1 days), 0);
        vm.stopPrank();
        assertEq(market.quote(99, 1e6), 0, "unknown claim quotes 0");

        vm.startPrank(inv[0]);
        USDT.approve(address(market), type(uint256).max);
        vm.expectRevert(CapitalMarket.OfferClosed.selector);
        market.fund(oldClaim, 1e6); // the cancelled offer stays closed
        vm.stopPrank();

        _fund(0, newClaim, FACE);
        _payAndCheckProRata(invoiceId, newClaim, 1, FACE, "p");
    }
}
