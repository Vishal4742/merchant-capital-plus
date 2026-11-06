// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerchantPay} from "../src/MerchantPay.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {ClaimToken} from "../src/ClaimToken.sol";
import {MoveAdminToSafe, ISafe} from "../script/MoveAdminToSafe.s.sol";

/// @notice Batch 048: every admin role moves from the deployer to a 2-of-3 Safe on the live contracts (fork of 1874).
contract MoveAdminToSafeForkTest is Test {
    uint256 constant FORK_BLOCK = 12_303_386; // same block as the other fork tests: Safe 1.4.1 is deployed there
    address constant DEPLOYER = 0xb4E7eDe967E108858DDb5d88B25FDc70723B714D;
    MerchantPay constant PAY = MerchantPay(0xAb817593253A0A37de723072827D88fE0ca54251);
    InvestorRegistry constant REGISTRY = InvestorRegistry(0x293430faE87CA79844c6E3A64E8044078c4d3E74);
    ClaimToken constant CLAIMS = ClaimToken(0xce9b171a5C485A41DCED9D7f043733Bddc26c388);

    MoveAdminToSafe script;
    uint256[3] keys = [uint256(0xA11CE), 0xB0B, 0xCA401];
    address[] owners;

    function setUp() public {
        vm.createSelectFork("whitechain", FORK_BLOCK);
        script = new MoveAdminToSafe();
        for (uint256 i; i < 3; ++i) {
            owners.push(vm.addr(keys[i]));
        }
    }

    function test_MovesEveryRoleToTheSafe() public {
        ISafe safe = script.move(DEPLOYER, owners);
        address[3] memory t = [address(PAY), address(REGISTRY), address(CLAIMS)];
        for (uint256 i; i < 3; ++i) {
            assertEq(Ownable(t[i]).owner(), address(safe), "owner is the Safe");
            assertEq(PAY.pendingOwner(), address(0), "nothing pending");
        }
        assertEq(REGISTRY.pendingOwner(), address(0));
        assertEq(CLAIMS.pendingOwner(), address(0));
        assertEq(safe.getThreshold(), 2);
        assertEq(safe.getOwners().length, 3);
        for (uint256 i; i < 3; ++i) {
            assertTrue(safe.isOwner(owners[i]));
        }
        assertFalse(safe.isOwner(DEPLOYER), "the deployer is out");
    }

    function test_DeployerLosesEveryRole() public {
        script.move(DEPLOYER, owners);
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, DEPLOYER);
        vm.startPrank(DEPLOYER);
        vm.expectRevert(unauthorized);
        REGISTRY.setEligible(DEPLOYER, type(uint64).max);
        vm.expectRevert(unauthorized);
        CLAIMS.forcedTransfer(owners[0], DEPLOYER, 1, 1);
        vm.expectRevert(unauthorized);
        CLAIMS.setFrozenTokens(owners[0], 1, 1);
        vm.expectRevert(unauthorized);
        PAY.pause();
        vm.expectRevert(unauthorized);
        PAY.unpause();
        vm.expectRevert(unauthorized);
        PAY.sweep(DEPLOYER);
        vm.expectRevert(unauthorized);
        PAY.setRelayFee(0, DEPLOYER);
        vm.expectRevert(unauthorized);
        PAY.transferOwnership(DEPLOYER);
        vm.expectRevert(unauthorized);
        REGISTRY.transferOwnership(DEPLOYER);
        vm.expectRevert(unauthorized);
        CLAIMS.transferOwnership(DEPLOYER);
        vm.stopPrank();
    }

    function test_TwoOwnersActOneCannot() public {
        ISafe safe = script.move(DEPLOYER, owners);
        address investor = makeAddr("investor");
        bytes memory eligible = abi.encodeCall(InvestorRegistry.setEligible, (investor, type(uint64).max));

        vm.expectRevert(bytes("GS020")); // signatures too short: 1 of the 2 needed
        _exec(safe, address(REGISTRY), eligible, _sign(safe, address(REGISTRY), eligible, 1));

        _exec(safe, address(REGISTRY), eligible, _sign(safe, address(REGISTRY), eligible, 2));
        assertTrue(REGISTRY.isEligible(investor), "2 of 3 run setEligible");

        bytes memory pause = abi.encodeCall(MerchantPay.pause, ());
        _exec(safe, address(PAY), pause, _sign(safe, address(PAY), pause, 2));
        assertTrue(PAY.paused(), "2 of 3 run pause");
    }

    function test_DeployerAsOneOfThreeCantActAlone() public {
        owners[0] = DEPLOYER;
        ISafe safe = script.move(DEPLOYER, owners);
        assertEq(safe.getThreshold(), 2);
        assertEq(safe.getOwners().length, 3);
        assertTrue(safe.isOwner(DEPLOYER) && safe.isOwner(owners[1]) && safe.isOwner(owners[2]));
        assertEq(PAY.owner(), address(safe));

        bytes memory pause = abi.encodeCall(MerchantPay.pause, ());
        bytes memory approvedBySender = abi.encodePacked(uint256(uint160(DEPLOYER)), bytes32(0), uint8(1));
        vm.prank(DEPLOYER);
        vm.expectRevert(bytes("GS020"));
        _exec(safe, address(PAY), pause, approvedBySender);
    }

    function test_BadInputMovesNothing() public {
        address[] memory two = new address[](2);
        two[0] = owners[0];
        two[1] = owners[1];
        vm.expectRevert(MoveAdminToSafe.NeedThreeOwners.selector);
        script.move(DEPLOYER, two);

        address[] memory four = new address[](4);
        for (uint256 i; i < 3; ++i) {
            four[i] = owners[i];
        }
        four[3] = makeAddr("fourth");
        vm.expectRevert(MoveAdminToSafe.NeedThreeOwners.selector);
        script.move(DEPLOYER, four);

        address[] memory bad = owners;
        bad[2] = owners[0];
        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.BadOwner.selector, owners[0]));
        script.move(DEPLOYER, bad);
        bad[2] = address(0);
        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.BadOwner.selector, address(0)));
        script.move(DEPLOYER, bad);

        bad[2] = vm.addr(keys[2]);
        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.NotAdmin.selector, address(PAY), DEPLOYER, address(0)));
        script.move(stranger, bad);

        assertEq(PAY.owner(), DEPLOYER);
        assertEq(REGISTRY.owner(), DEPLOYER);
        assertEq(CLAIMS.owner(), DEPLOYER);
    }

    // ---------- Safe tx helpers: owners sign the EIP-712 Safe tx hash, sorted by address ----------

    function _exec(ISafe safe, address to, bytes memory data, bytes memory sigs) internal {
        safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), sigs);
    }

    function _sign(ISafe safe, address to, bytes memory data, uint256 n) internal view returns (bytes memory sigs) {
        bytes32 hash = safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), safe.nonce());
        uint256[3] memory k = keys;
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                if (vm.addr(k[j]) < vm.addr(k[i])) (k[i], k[j]) = (k[j], k[i]);
            }
        }
        for (uint256 i; i < n; ++i) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(k[i], hash);
            sigs = abi.encodePacked(sigs, r, s, v);
        }
    }
}
