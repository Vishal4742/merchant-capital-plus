// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerchantPay} from "../src/MerchantPay.sol";
import {CapitalMarket} from "../src/CapitalMarket.sol";
import {ClaimToken} from "../src/ClaimToken.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {IInvestorRegistry} from "../src/interfaces/IInvestorRegistry.sol";
import {ICapitalMarket} from "../src/interfaces/ICapitalMarket.sol";

/// @notice Fork tests for the advance and invoice financing on Whitechain Sepolia 1874 with the real USDT
///         (SRS FR-ADV-1–6, FR-INV-1/3/4/5, NFR-1/2; AT-3–AT-7 at the ÷100 demo amounts).
contract CapitalMarketForkTest is Test {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    address constant HOLDER = 0xFfD76ff981cc7EA15EE2F67680815763C4C7683E;
    uint256 constant FORK_BLOCK = 12_303_386;
    uint64 constant LOCK_WINDOW = 60; // testnet (ARCHITECTURE §2)
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint256 constant FEE = 100_000;
    // AT-3 at ÷100: advance 10, cap 11, holdback 20%.
    uint128 constant PRINCIPAL = 10e6;
    uint128 constant CAP = 11e6;
    uint16 constant HOLDBACK = 2000;
    // AT-6 at ÷100: 100 face at 12% APR for 60 days, yield basis: 100e6 × 365 / (365 + 0.12 × 60) rounded down.
    uint128 constant FACE = 100e6;
    uint128 constant PRICE = 98_065_556;

    InvestorRegistry registry;
    ClaimToken claims;
    MerchantPay mp;
    CapitalMarket market;
    bytes32 domainSeparator;
    uint256 validBefore;
    address merchant = makeAddr("merchant");
    address feeRecipient = makeAddr("feeRecipient");
    address anyone = makeAddr("anyone");
    address investorA;
    uint256 investorAKey;
    address investorB;
    uint256 investorBKey;
    address customer;
    uint256 customerKey;

    function setUp() public {
        vm.createSelectFork("whitechain", FORK_BLOCK);
        (investorA, investorAKey) = makeAddrAndKey("investorA");
        (investorB, investorBKey) = makeAddrAndKey("investorB");
        (customer, customerKey) = makeAddrAndKey("customer");
        registry = new InvestorRegistry(address(this));
        claims = new ClaimToken(IInvestorRegistry(address(registry)), address(this), LOCK_WINDOW);
        mp = new MerchantPay(USDT, feeRecipient);
        market = new CapitalMarket(address(mp), claims, USDT);
        claims.setMarket(address(market));
        mp.setMarket(ICapitalMarket(address(market)));
        registry.setEligible(investorA, type(uint64).max);
        registry.setEligible(investorB, type(uint64).max);
        domainSeparator = IERC20Permit(address(USDT)).DOMAIN_SEPARATOR();
        validBefore = block.timestamp + 15 minutes;
        vm.startPrank(HOLDER);
        USDT.transfer(investorA, 200e6);
        USDT.transfer(investorB, 200e6);
        USDT.transfer(customer, 500e6);
        vm.stopPrank();
    }

    // ---------- helpers (no external calls before the call under test) ----------

    function _sig(uint256 key, address from, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, from, to, value, 0, validBefore, nonce));
        return vm.sign(key, MessageHashUtils.toTypedDataHash(domainSeparator, structHash));
    }

    function _fund(uint256 key, address investor, uint256 claimId, uint256 units) internal {
        uint256 cost = market.quote(claimId, units);
        bytes32 nonce = market.fundingNonce(claimId, investor, units, "f");
        (uint8 v, bytes32 r, bytes32 s) = _sig(key, investor, address(market), cost, nonce);
        vm.prank(anyone);
        market.fundWithAuthorization(claimId, investor, units, 0, validBefore, "f", v, r, s);
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

    function _fundedAdvance() internal returns (uint256 claimId) {
        claimId = _listAdvance();
        _fund(investorAKey, investorA, claimId, CAP);
    }

    function _listInvoice() internal returns (uint256 invoiceId, uint256 claimId) {
        vm.startPrank(merchant);
        invoiceId = mp.createInvoice(customer, FACE, uint64(block.timestamp + 60 days), keccak256("inv-random-id"));
        claimId = market.listInvoice(invoiceId, PRICE, uint64(block.timestamp + 1 days), 0);
        vm.stopPrank();
    }

    function _bal(address a) internal view returns (uint256) {
        return USDT.balanceOf(a);
    }

    // ---------- the advance: AT-3, AT-4, AT-5 (FR-ADV-1–5) ----------

    function test_AT3_InvestorFundsAdvance_MerchantGetsCashNow() public {
        uint256 claimId = _listAdvance();
        assertEq(market.quote(claimId, CAP), PRINCIPAL, "total cost of 11 units of claim is 10 USDT");

        _fund(investorAKey, investorA, claimId, CAP);

        assertEq(_bal(merchant), PRINCIPAL, "merchant receives 10 now");
        assertEq(claims.balanceOf(investorA, claimId), CAP, "investor holds 11,000,000 units");
        assertEq(investorA.balance, 0, "investor holds no WBT");
        uint256[] memory liens = market.liensOf(merchant);
        assertEq(liens.length, 1);
        assertEq(liens[0], claimId);
        assertEq(_bal(address(market)), 0);
    }

    function test_AT4_SaleRepaysHoldbackInTheSameTx() public {
        uint256 claimId = _fundedAdvance();
        uint256 merchantBefore = _bal(merchant);

        vm.expectEmit(true, true, true, true, address(mp));
        emit MerchantPay.Paid(1, merchant, customer, 0, keccak256("o1"), 5e6, FEE, 1e6, 5e6 - FEE - 1e6);
        _sale(5e6, keccak256("o1"));

        assertEq(_bal(investorA), 200e6 - PRINCIPAL + 1e6, "20% of the 5 USDT sale to the investor");
        assertEq(market.outstanding(claimId), 10e6, "outstanding falls to 10");
        assertEq(_bal(merchant) - merchantBefore, 5e6 - FEE - 1e6);
        assertEq(_bal(address(market)), 0);
    }

    function test_AT5_LienEndsAtTheCap_NextSaleGoesToTheMerchant() public {
        uint256 claimId = _fundedAdvance();
        _sale(5e6, keccak256("o1")); // 1 repaid, 10 left
        for (uint256 i; i < 5; ++i) {
            _sale(10e6, keccak256(abi.encode("o", i))); // 2 each
        }
        assertEq(market.outstanding(claimId), 0, "cap repaid");
        assertEq(market.liensOf(merchant).length, 0, "lien removed");
        assertEq(market.advanceOf(merchant), 0);
        assertFalse(market.hasClaimsOn(merchant, 0));
        assertEq(_bal(investorA), 200e6 - PRINCIPAL + CAP, "investor got the full cap back");

        uint256 merchantBefore = _bal(merchant);
        _sale(5e6, keccak256("after"));
        assertEq(_bal(merchant) - merchantBefore, 5e6 - FEE, "100% minus the fee");

        vm.prank(merchant);
        market.listAdvance(PRINCIPAL, CAP, HOLDBACK, 30 days, uint64(block.timestamp + 1 days)); // can raise again
    }

    function test_Lien_CappedByWhatIsStillOwed() public {
        uint256 claimId = _fundedAdvance();
        uint256 merchantBefore = _bal(merchant);
        _sale(100e6, keccak256("big")); // 20% would be 20, only 11 owed
        assertEq(market.outstanding(claimId), 0);
        assertEq(_bal(merchant) - merchantBefore, 100e6 - FEE - CAP);
        assertEq(_bal(address(market)), 0);
    }

    function test_RevertWhen_SecondAdvanceWhileOneIsListed() public {
        uint256 claimId = _listAdvance();
        vm.startPrank(merchant);
        vm.expectRevert(CapitalMarket.AdvanceActive.selector);
        market.listAdvance(PRINCIPAL, CAP, HOLDBACK, 30 days, uint64(block.timestamp + 1 days));
        market.cancelOffer(claimId);
        market.listAdvance(PRINCIPAL, CAP, HOLDBACK, 30 days, uint64(block.timestamp + 1 days)); // after cancel: fine
        vm.stopPrank();
    }

    function test_RevertWhen_AdvanceTermsAreBad() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        vm.startPrank(merchant);
        vm.expectRevert(CapitalMarket.BadTerms.selector);
        market.listAdvance(PRINCIPAL, PRINCIPAL - 1, HOLDBACK, 30 days, deadline); // cap below principal
        vm.expectRevert(CapitalMarket.BadTerms.selector);
        market.listAdvance(PRINCIPAL, CAP, 3001, 30 days, deadline); // holdback above 30%
        vm.expectRevert(CapitalMarket.BadTerms.selector);
        market.listAdvance(PRINCIPAL, CAP, 0, 30 days, deadline);
        vm.expectRevert(CapitalMarket.BadTerms.selector);
        market.listAdvance(PRINCIPAL, CAP, HOLDBACK, 0, deadline);
        vm.expectRevert(CapitalMarket.BadTerms.selector);
        market.listAdvance(PRINCIPAL, CAP, HOLDBACK, 30 days, uint64(block.timestamp));
        vm.expectRevert(CapitalMarket.BadTerms.selector);
        market.listAdvance(0, CAP, HOLDBACK, 30 days, deadline);
        vm.stopPrank();
    }

    function test_RevertWhen_IneligibleInvestorFunds() public {
        uint256 claimId = _listAdvance();
        (address stranger, uint256 strangerKey) = makeAddrAndKey("stranger");
        vm.prank(HOLDER);
        USDT.transfer(stranger, 20e6);
        uint256 cost = market.quote(claimId, CAP);
        bytes32 nonce = market.fundingNonce(claimId, stranger, CAP, "f");
        (uint8 v, bytes32 r, bytes32 s) = _sig(strangerKey, stranger, address(market), cost, nonce);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("ERC7943CannotReceive(address)")), stranger));
        vm.prank(anyone);
        market.fundWithAuthorization(claimId, stranger, CAP, 0, validBefore, "f", v, r, s);
        assertEq(_bal(stranger), 20e6, "nothing moved");
    }

    function test_RevertWhen_FundingAfterDeadlineOrAboveFace() public {
        uint256 claimId = _listAdvance();
        uint256 tooMany = uint256(CAP) + 1;
        uint256 cost = market.quote(claimId, tooMany);
        (uint8 v, bytes32 r, bytes32 s) =
            _sig(investorAKey, investorA, address(market), cost, market.fundingNonce(claimId, investorA, tooMany, "f"));
        vm.expectRevert(CapitalMarket.WrongUnits.selector);
        vm.prank(anyone);
        market.fundWithAuthorization(claimId, investorA, tooMany, 0, validBefore, "f", v, r, s);

        vm.warp(block.timestamp + 1 days + 1);
        validBefore = block.timestamp + 15 minutes;
        uint256 units = CAP;
        cost = market.quote(claimId, units);
        (v, r, s) =
            _sig(investorAKey, investorA, address(market), cost, market.fundingNonce(claimId, investorA, units, "f"));
        vm.expectRevert(CapitalMarket.OfferClosed.selector);
        vm.prank(anyone);
        market.fundWithAuthorization(claimId, investorA, units, 0, validBefore, "f", v, r, s);
    }

    function test_CancelOffer_OnlyByItsMerchantAndBeforeFunding() public {
        uint256 claimId = _listAdvance();
        vm.expectRevert(CapitalMarket.NotMerchant.selector);
        vm.prank(anyone);
        market.cancelOffer(claimId);

        _fund(investorAKey, investorA, claimId, 1e6);
        vm.expectRevert(CapitalMarket.AlreadyFunded.selector);
        vm.prank(merchant);
        market.cancelOffer(claimId);
    }

    function test_Fund_DirectWithApprove() public {
        uint256 claimId = _listAdvance();
        vm.startPrank(investorA);
        USDT.approve(address(market), PRINCIPAL);
        market.fund(claimId, CAP);
        vm.stopPrank();
        assertEq(claims.balanceOf(investorA, claimId), CAP);
        assertEq(_bal(merchant), PRINCIPAL);
    }

    // ---------- invoice financing: AT-6, AT-7, partial payments (FR-INV-1/3/4/5) ----------

    function test_AT6_TwoInvestorsFundAnInvoice_MerchantGetsTheSum() public {
        (uint256 invoiceId, uint256 claimId) = _listInvoice();
        assertEq(market.quote(claimId, 60e6), 58_839_334, "investor A pays about 58.84");
        assertEq(market.quote(claimId, 40e6), 39_226_223, "investor B pays about 39.23");

        _fund(investorAKey, investorA, claimId, 60e6);
        _fund(investorBKey, investorB, claimId, 40e6);

        assertEq(_bal(merchant), 58_839_334 + 39_226_223, "merchant receives their sum");
        assertTrue(market.isFinanced(invoiceId));
        vm.expectRevert(MerchantPay.InvoiceFinanced.selector);
        vm.prank(merchant);
        mp.cancelInvoice(invoiceId);
    }

    function test_AT7_DebtorPays_BothInvestorsRepaidInOneTx_ClaimSettled() public {
        (uint256 invoiceId, uint256 claimId) = _listInvoice();
        _fund(investorAKey, investorA, claimId, 60e6);
        _fund(investorBKey, investorB, claimId, 40e6);
        uint256 aBefore = _bal(investorA);
        uint256 bBefore = _bal(investorB);
        uint256 merchantBefore = _bal(merchant);

        vm.expectEmit(true, true, false, true, address(market));
        emit CapitalMarket.Settled(claimId);
        _payInvoice(invoiceId, FACE, "p");

        assertEq(_bal(investorA) - aBefore, 60e6, "A receives 60");
        assertEq(_bal(investorB) - bBefore, 40e6, "B receives 40");
        assertEq(market.outstanding(claimId), 0, "claim settled");
        assertEq(_bal(merchant), merchantBefore, "the debtor's money went to the holders");
        assertEq(_bal(feeRecipient), FEE, "relay fee on top");
        (,, MerchantPay.InvoiceStatus st,,,) = mp.invoices(invoiceId);
        assertEq(uint8(st), uint8(MerchantPay.InvoiceStatus.Paid));
        assertEq(_bal(address(market)), 0);
    }

    function test_PartialInvoicePayments_BurnCoveredUnitsProRata() public {
        (uint256 invoiceId, uint256 claimId) = _listInvoice();
        _fund(investorAKey, investorA, claimId, 60e6);
        _fund(investorBKey, investorB, claimId, 40e6);

        _payInvoice(invoiceId, 40e6, "p1");
        assertEq(claims.balanceOf(investorA, claimId), 36e6);
        assertEq(claims.balanceOf(investorB, claimId), 24e6);
        assertEq(market.outstanding(claimId), 60e6);

        _payInvoice(invoiceId, 60e6, "p2");
        assertEq(market.outstanding(claimId), 0);
        assertEq(_bal(address(market)), 0);
    }

    function test_FirstFundingLocksTransfersFromDueDateMinusLockWindow() public {
        (, uint256 claimId) = _listInvoice();
        vm.recordLogs();
        _fund(investorAKey, investorA, claimId, 60e6);
        (,,,,,,,,, uint64 maturity,) = market.offers(claimId);
        // The lock is ClaimToken's rule (tested in ClaimToken.t.sol); here: the market set it once, at maturity - window.
        bool found;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == keccak256("ClaimStateSet(uint256,uint64,bool)")) {
                (uint64 lockFrom, bool frozen) = abi.decode(logs[i].data, (uint64, bool));
                assertEq(lockFrom, maturity - LOCK_WINDOW);
                assertFalse(frozen);
                found = true;
            }
        }
        assertTrue(found, "ClaimStateSet emitted on first funding");
    }

    function test_RevertWhen_InvoiceListingBreaksTheRules() public {
        vm.prank(merchant);
        uint256 id = mp.createInvoice(customer, FACE, uint64(block.timestamp + 60 days), bytes32(0));
        uint64 deadline = uint64(block.timestamp + 1 days);

        vm.expectRevert(CapitalMarket.NotMerchant.selector);
        vm.prank(anyone);
        market.listInvoice(id, PRICE, deadline, 0);

        vm.startPrank(merchant);
        vm.expectRevert(CapitalMarket.BadTerms.selector);
        market.listInvoice(id, FACE, deadline, 0); // price must be below face
        vm.expectRevert(CapitalMarket.BadTerms.selector);
        market.listInvoice(id, PRICE, uint64(block.timestamp + 60 days), 0); // deadline after the lock
        market.listInvoice(id, PRICE, deadline, 0);
        vm.expectRevert(CapitalMarket.InvoiceNotListable.selector);
        market.listInvoice(id, PRICE, deadline, 0); // listed twice
        vm.stopPrank();
    }

    function test_UnfinancedInvoice_StillRepaysTheMerchantsAdvance() public {
        uint256 claimId = _fundedAdvance();
        vm.prank(merchant);
        uint256 id = mp.createInvoice(customer, 10e6, uint64(block.timestamp + 30 days), bytes32(0));
        uint256 merchantBefore = _bal(merchant);
        _payInvoice(id, 10e6, "p");
        assertEq(market.outstanding(claimId), CAP - 2e6, "20% of the credited 10");
        assertEq(_bal(merchant) - merchantBefore, 8e6);
    }

    // ---------- NFR-1: a failed push becomes a pull balance ----------

    function test_FailedPushBecomesAPullBalance() public {
        _fundedAdvance();
        vm.mockCallRevert(address(USDT), abi.encodeCall(IERC20.transfer, (investorA, 1e6)), "blocked");
        _sale(5e6, keccak256("o1"));
        vm.clearMockedCalls();

        assertEq(market.owed(investorA), 1e6);
        assertEq(market.totalOwed(), 1e6);
        assertEq(_bal(address(market)), 1e6, "market holds exactly what it owes");

        uint256 before = _bal(investorA);
        vm.prank(investorA);
        market.withdrawOwed();
        assertEq(_bal(investorA) - before, 1e6);
        assertEq(_bal(address(market)), 0);

        vm.expectRevert(CapitalMarket.NothingOwed.selector);
        vm.prank(investorA);
        market.withdrawOwed();
    }

    function test_RevertWhen_OnPaymentNotFromMerchantPay() public {
        vm.expectRevert(CapitalMarket.NotMerchantPay.selector);
        market.onPayment(merchant, 0, 1e6, 1e6, 1);
    }

    // ---------- F1 (NFR-2): every unit is accounted for, the market keeps only what it owes ----------

    function testFuzz_SaleSplitAddsUpWithAnAdvance(uint256 amount) public {
        amount = bound(amount, 1e6, 400e6);
        _fundedAdvance();
        uint256 merchantBefore = _bal(merchant);
        uint256 investorBefore = _bal(investorA);
        uint256 feeBefore = _bal(feeRecipient);
        _sale(amount, keccak256(abi.encode(amount)));
        uint256 toInvestor = _bal(investorA) - investorBefore;
        assertEq((_bal(merchant) - merchantBefore) + toInvestor + (_bal(feeRecipient) - feeBefore), amount);
        assertEq(toInvestor, amount * HOLDBACK / 10_000 > CAP ? CAP : amount * HOLDBACK / 10_000);
        assertEq(_bal(address(market)), market.totalOwed());
    }

    function testFuzz_InvoicePayoutRoundsWithoutDust(uint256 unitsA, uint256 payment) public {
        unitsA = bound(unitsA, 1, FACE - 1);
        payment = bound(payment, 1e6, FACE);
        (uint256 invoiceId, uint256 claimId) = _listInvoice();
        _fund(investorAKey, investorA, claimId, unitsA);
        _fund(investorBKey, investorB, claimId, FACE - unitsA);
        uint256 aBefore = _bal(investorA);
        uint256 bBefore = _bal(investorB);
        _payInvoice(invoiceId, payment, "p");
        uint256 paidA = _bal(investorA) - aBefore;
        uint256 paidB = _bal(investorB) - bBefore;
        assertEq(paidA + paidB, payment, "holders get exactly the payment");
        assertLe(paidA, unitsA);
        assertLe(paidB, FACE - unitsA);
        assertEq(market.outstanding(claimId), FACE - payment);
        assertEq(_bal(address(market)), 0, "no dust");
    }
}
