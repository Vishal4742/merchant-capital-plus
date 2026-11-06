// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC3009} from "@openzeppelin/contracts/interfaces/draft-IERC3009.sol";
import {Seed} from "../script/Seed.s.sol";

/// Exposes the seed script's internals with test keys, so the tests never read .env.
contract SeedHarness is Seed {
    function fundWith(uint256 deployerKey, Target[] memory t) external {
        _fund(deployerKey, t);
    }

    function reclaimWith(uint256 deployerKey, uint256[] memory walletKeys) external {
        _reclaim(deployerKey, walletKeys);
    }
}

/// @notice Fork tests for the demo seed script (SRS CON-8, CON-4) against the real prize USDT on 1874.
contract SeedForkTest is Test {
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
    address customer = makeAddr("customer");

    function setUp() public {
        vm.createSelectFork("whitechain", FORK_BLOCK);
        seed = new SeedHarness();
        (team, teamKey) = makeAddrAndKey("team");
        (merchant, merchantKey) = makeAddrAndKey("merchant");
        (investorA, investorAKey) = makeAddrAndKey("investorA");
        (investorB, investorBKey) = makeAddrAndKey("investorB");
        (debtor, debtorKey) = makeAddrAndKey("debtor");
        vm.prank(HOLDER);
        USDT.transfer(team, 300e6);
        vm.deal(team, 1 ether);
    }

    function _targets() internal view returns (Seed.Target[] memory t) {
        t = new Seed.Target[](5);
        t[0] = Seed.Target(merchant, seed.MERCHANT_USDT(), seed.MERCHANT_WBT());
        t[1] = Seed.Target(investorA, seed.INVESTOR_A_USDT(), 0);
        t[2] = Seed.Target(investorB, seed.INVESTOR_B_USDT(), 0);
        t[3] = Seed.Target(debtor, seed.DEBTOR_USDT(), 0);
        t[4] = Seed.Target(customer, seed.CUSTOMER_USDT(), 0);
    }

    function _walletKeys() internal view returns (uint256[] memory k) {
        k = new uint256[](4);
        (k[0], k[1], k[2], k[3]) = (merchantKey, investorAKey, investorBKey, debtorKey);
    }

    function test_Targets_MatchTheDivideBy100Demo() public view {
        assertEq(seed.MERCHANT_USDT(), 1e6);
        assertEq(seed.MERCHANT_WBT(), 0.02 ether);
        assertEq(seed.INVESTOR_A_USDT(), 69e6);
        assertEq(seed.INVESTOR_B_USDT(), 40e6);
        assertEq(seed.DEBTOR_USDT(), 0, "batch 009 (Q5): the browser guest pays AT-7, not the script debtor");
        assertEq(seed.CUSTOMER_USDT(), 156_100_000, "AT-4 5 + AT-5 50 + 1 + AT-7 100.10");
    }

    function test_Fund_TopsUpEachWalletToItsTarget() public {
        uint256 teamBefore = USDT.balanceOf(team);
        seed.fundWith(teamKey, _targets());

        assertEq(USDT.balanceOf(merchant), 1e6);
        assertEq(USDT.balanceOf(investorA), 69e6);
        assertEq(USDT.balanceOf(investorB), 40e6);
        assertEq(USDT.balanceOf(debtor), 0, "batch 009: the browser guest pays AT-7");
        assertEq(USDT.balanceOf(customer), 156_100_000);
        assertEq(USDT.balanceOf(team), teamBefore - 266_100_000);
        assertEq(merchant.balance, 0.02 ether, "merchant gets WBT for its own admin txs");
        assertEq(investorA.balance + investorB.balance + debtor.balance + customer.balance, 0, "payers get no WBT");
    }

    function test_Fund_IsIdempotentAndNeverOverfills() public {
        vm.prank(HOLDER);
        USDT.transfer(investorA, 80e6); // already above its 69 target
        seed.fundWith(teamKey, _targets());
        assertEq(USDT.balanceOf(investorA), 80e6, "left alone");

        uint256 teamAfterFirst = USDT.balanceOf(team);
        uint256 wbtAfterFirst = team.balance;
        seed.fundWith(teamKey, _targets());
        assertEq(USDT.balanceOf(team), teamAfterFirst, "second run sends no USDT");
        assertEq(team.balance, wbtAfterFirst, "second run sends no WBT");
    }

    function test_Shortfall_SumsOnlyWhatIsMissing() public {
        vm.prank(HOLDER);
        USDT.transfer(investorA, 30e6); // 30 of its 69
        (uint256 usdt, uint256 wbt) = seed.shortfall(_targets());
        assertEq(usdt, 266_100_000 - 30e6);
        assertEq(wbt, 0.02 ether);
    }

    function test_RevertWhen_TeamWalletShort_AndNothingMoves() public {
        (address poorTeam, uint256 poorKey) = makeAddrAndKey("poorTeam");
        vm.prank(HOLDER);
        USDT.transfer(poorTeam, 100e6);
        vm.deal(poorTeam, 1 ether);
        Seed.Target[] memory targets = _targets(); // its view calls must happen before expectRevert

        vm.expectRevert(abi.encodeWithSelector(Seed.TeamWalletShort.selector, 166_100_000, 0));
        seed.fundWith(poorKey, targets);
        assertEq(USDT.balanceOf(poorTeam), 100e6);
        assertEq(USDT.balanceOf(investorA), 0);
    }

    function test_Reclaim_ReturnsUsdtWithoutGasFromTheWallets() public {
        seed.fundWith(teamKey, _targets());
        uint256 teamBefore = USDT.balanceOf(team);

        seed.reclaimWith(teamKey, _walletKeys());

        assertEq(USDT.balanceOf(merchant) + USDT.balanceOf(investorA), 0);
        assertEq(USDT.balanceOf(investorB) + USDT.balanceOf(debtor), 0);
        assertEq(USDT.balanceOf(team), teamBefore + 110e6, "everything but the browser customer comes back (1 + 69 + 40)");
        assertEq(merchant.balance, 0.02 ether, "wallets spend no WBT");
        assertEq(vm.getNonce(investorA) + vm.getNonce(debtor), 0, "wallets sent no transaction");
    }

    function test_Reclaim_SkipsEmptyWallets() public {
        seed.reclaimWith(teamKey, _walletKeys()); // nothing to reclaim: must not revert
        assertEq(USDT.balanceOf(team), 300e6);
    }

    function test_RevertWhen_ReclaimSignatureIsRedirected() public {
        vm.prank(HOLDER);
        USDT.transfer(investorA, 10e6);
        uint256 validBefore = block.timestamp + 15 minutes;
        bytes32 nonce = keccak256("reclaim-test");
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(investorAKey, seed.transferDigest(investorA, team, 10e6, validBefore, nonce));

        vm.expectRevert(bytes("TetherToken: invalid signature"));
        IERC3009(address(USDT))
            .transferWithAuthorization(investorA, makeAddr("thief"), 10e6, 0, validBefore, nonce, v, r, s);

        IERC3009(address(USDT)).transferWithAuthorization(investorA, team, 10e6, 0, validBefore, nonce, v, r, s);
        assertEq(USDT.balanceOf(investorA), 0);
    }
}
