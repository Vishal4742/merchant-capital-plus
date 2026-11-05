// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {ClaimToken} from "../src/ClaimToken.sol";

/// @notice Tester probe for batch 005 (round 1): frozen units must never move, even when a batch repeats an id
///         (SRS FR-TOK-4, ERC-7943 partial freeze; acceptance criterion T1 "partial freeze").
contract ClaimTokenProbeTest is Test {
    uint256 constant ID = 1;
    InvestorRegistry reg;
    ClaimToken token;
    address admin = makeAddr("admin");
    address market = makeAddr("market");
    address a = makeAddr("a");
    address b = makeAddr("b");

    function setUp() public {
        reg = new InvestorRegistry(admin);
        token = new ClaimToken(reg, admin, 60);
        vm.startPrank(admin);
        token.setMarket(market);
        reg.setEligible(a, type(uint64).max);
        reg.setEligible(b, type(uint64).max);
        token.setFrozenTokens(a, ID, 60);
        vm.stopPrank();
        vm.prank(market);
        token.mint(a, ID, 100); // 40 unfrozen
    }

    function _batch(uint256[] memory values) internal {
        uint256[] memory ids = new uint256[](values.length);
        for (uint256 i; i < ids.length; ++i) {
            ids[i] = ID;
        }
        vm.prank(a);
        token.safeBatchTransferFrom(a, b, ids, values, "");
    }

    function test_RevertWhen_BatchRepeatsAnIdToMoveFrozenUnits() public {
        uint256[] memory values = new uint256[](3);
        values[0] = 40;
        values[1] = 40;
        values[2] = 20; // each entry fits the 40 unfrozen; together they would move all 100
        vm.expectRevert();
        _batch(values);
        assertEq(token.balanceOf(a, ID), 100, "frozen units stay with a");
        assertGe(token.balanceOf(a, ID), token.getFrozenTokens(a, ID), "balance never below frozen");
    }

    function test_BatchRepeatingAnIdWithinTheUnfrozenBalancePasses() public {
        uint256[] memory values = new uint256[](2);
        values[0] = 20;
        values[1] = 20;
        _batch(values);
        assertEq(token.balanceOf(b, ID), 40);
        assertEq(token.balanceOf(a, ID), 60);
        assertEq(token.getFrozenTokens(a, ID), 60);
    }
}
