// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC3009} from "@openzeppelin/contracts/interfaces/draft-IERC3009.sol";
import {Seed} from "../script/Seed.s.sol";
import {SeedHarness} from "./Seed.t.sol";

/// A WBT target that cannot receive native value (no receive or fallback).
contract RejectsWbt {}

/// @notice Tester-added fork tests for batch 004 round 1 (gaps found against spec.md): top-ups of partly funded
///         wallets, WBT above target, the WBT shortfall, failed transfers, no authorization for empty wallets, and the
///         two .env entry points run end to end. Every key here is a makeAddrAndKey test key set with vm.setEnv; .env
///         is never read.
contract SeedEdgesForkTest is Test {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    address constant HOLDER = 0xFfD76ff981cc7EA15EE2F67680815763C4C7683E;
    uint256 constant FORK_BLOCK = 12_303_386;

    SeedHarness seed;
    address team;
    uint256 teamKey;
    address merchant;
    uint256 merchantKey;
    address investorA;
    uint256 investorAKey;
    address investorB;
    uint256 investorBKey;
    address debtor;
    uint256 debtorKey;
    address payer;
    uint256 payerKey;
    address customer = makeAddr("customer");

    function setUp() public {
        vm.createSelectFork("whitechain", FORK_BLOCK);
        seed = new SeedHarness();
        (team, teamKey) = makeAddrAndKey("team");
        (merchant, merchantKey) = makeAddrAndKey("merchant");
        (investorA, investorAKey) = makeAddrAndKey("investorA");
        (investorB, investorBKey) = makeAddrAndKey("investorB");
        (debtor, debtorKey) = makeAddrAndKey("debtor");
        (payer, payerKey) = makeAddrAndKey("payer");
        vm.prank(HOLDER);
        USDT.transfer(team, 300e6);
        vm.deal(team, 1 ether);
    }

    function _targets() internal view returns (Seed.Target[] memory t) {
        t = new Seed.Target[](4);
        t[0] = Seed.Target(merchant, seed.MERCHANT_USDT(), seed.MERCHANT_WBT());
        t[1] = Seed.Target(investorA, seed.INVESTOR_A_USDT(), 0);
        t[2] = Seed.Target(investorB, seed.INVESTOR_B_USDT(), 0);
        t[3] = Seed.Target(debtor, seed.DEBTOR_USDT(), 0);
    }

    function _walletKeys() internal view returns (uint256[] memory k) {
        k = new uint256[](4);
        (k[0], k[1], k[2], k[3]) = (merchantKey, investorAKey, investorBKey, debtorKey);
    }

    function test_Fund_TopsUpPartlyFundedWalletsToTheirTarget() public {
        vm.prank(HOLDER);
        USDT.transfer(debtor, 30e6);
        vm.deal(merchant, 0.005 ether);
        Seed.Target[] memory t = _targets();

        seed.fundWith(teamKey, t);

        assertEq(USDT.balanceOf(debtor), 100e6, "debtor topped up to its target, not by it");
        assertEq(merchant.balance, 0.02 ether, "merchant WBT topped up to its target, not by it");
        assertEq(USDT.balanceOf(team), 300e6 - 180e6, "team sends only the missing 1 + 69 + 40 + 70");
        assertEq(team.balance, 1 ether - 0.015 ether, "team sends only the missing 0.015 WBT");
    }

    function test_Fund_LeavesWbtAboveTargetAlone() public {
        vm.deal(merchant, 0.05 ether);
        Seed.Target[] memory t = _targets();

        seed.fundWith(teamKey, t);

        assertEq(merchant.balance, 0.05 ether, "WBT above target is left alone");
        assertEq(team.balance, 1 ether, "no WBT sent");
        assertEq(USDT.balanceOf(merchant), 1e6, "USDT still topped up");
    }

    function test_RevertWhen_TeamWalletShortOfWbt_NamesTheWbtShortfall() public {
        vm.deal(team, 0.005 ether);
        Seed.Target[] memory t = _targets(); // its view calls must happen before expectRevert

        vm.expectRevert(abi.encodeWithSelector(Seed.TeamWalletShort.selector, 0, 0.015 ether));
        seed.fundWith(teamKey, t);
    }

    function test_RevertWhen_WbtTransferFails() public {
        Seed.Target[] memory t = new Seed.Target[](1);
        t[0] = Seed.Target(address(new RejectsWbt()), 0, 0.01 ether);

        vm.expectRevert(bytes("WBT transfer failed"));
        seed.fundWith(teamKey, t);
    }

    function test_RevertWhen_UsdtTransferReturnsFalse() public {
        Seed.Target[] memory t = _targets();
        vm.mockCall(address(USDT), abi.encodeWithSelector(IERC20.transfer.selector), abi.encode(false));

        vm.expectRevert(bytes("USDT transfer failed"));
        seed.fundWith(teamKey, t);
    }

    function test_Reclaim_SubmitsOneAuthorizationPerNonEmptyWallet() public {
        vm.prank(HOLDER);
        USDT.transfer(investorB, 7e6);

        vm.expectCall(address(USDT), abi.encodeWithSelector(IERC3009.transferWithAuthorization.selector), 1);
        seed.reclaimWith(teamKey, _walletKeys());

        assertEq(USDT.balanceOf(investorB), 0);
        assertEq(USDT.balanceOf(team), 307e6);
    }

    function test_EntryPoints_FundAndReclaimTheEnvWallets() public {
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(teamKey));
        vm.setEnv("DEMO_MERCHANT_PRIVATE_KEY", vm.toString(merchantKey));
        vm.setEnv("DEMO_INVESTOR_A_PRIVATE_KEY", vm.toString(investorAKey));
        vm.setEnv("DEMO_INVESTOR_B_PRIVATE_KEY", vm.toString(investorBKey));
        vm.setEnv("DEMO_DEBTOR_PRIVATE_KEY", vm.toString(debtorKey));
        vm.setEnv("PAYER_PRIVATE_KEY", vm.toString(payerKey));
        vm.setEnv("CUSTOMER", vm.toString(address(0)));

        seed.fund(); // CUSTOMER unset: the four script wallets only
        assertEq(USDT.balanceOf(merchant), 1e6);
        assertEq(USDT.balanceOf(investorA), 69e6);
        assertEq(USDT.balanceOf(investorB), 40e6);
        assertEq(USDT.balanceOf(debtor), 100e6);
        assertEq(merchant.balance, 0.02 ether);
        assertEq(USDT.balanceOf(team), 300e6 - 210e6, "210 without a customer");

        vm.setEnv("CUSTOMER", vm.toString(customer));
        seed.fund(); // now only the customer is missing anything
        assertEq(USDT.balanceOf(customer), 56e6);
        assertEq(USDT.balanceOf(team), 300e6 - 266e6, "266 with a customer");

        vm.prank(HOLDER);
        USDT.transfer(payer, 1e6);
        seed.reclaim();
        assertEq(USDT.balanceOf(team), 300e6 - 56e6 + 1e6, "all five script wallets come back, the customer does not");
        assertEq(USDT.balanceOf(payer), 0, "PAYER is reclaimed");
        assertEq(USDT.balanceOf(customer), 56e6, "the browser customer is never reclaimed");
        assertEq(payer.balance + vm.getNonce(payer), 0, "PAYER spends no WBT and sends no tx");
    }
}
