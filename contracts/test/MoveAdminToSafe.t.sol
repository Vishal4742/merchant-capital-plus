// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerchantPay} from "../src/MerchantPay.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {ClaimToken} from "../src/ClaimToken.sol";
import {MoveAdminToSafe, ISafe, ISafeProxyFactory} from "../script/MoveAdminToSafe.s.sol";

/// @notice Batch 048: every admin role moves from the deployer to a 2-of-3 Safe on the live contracts (fork of 1874).
contract MoveAdminToSafeForkTest is Test {
    uint256 constant FORK_BLOCK = 12_382_404; // 20:58 IST: the live contracts (owner = deployer) and Safe 1.4.1 exist
    address constant DEPLOYER = 0xb4E7eDe967E108858DDb5d88B25FDc70723B714D;
    ISafeProxyFactory constant FACTORY = ISafeProxyFactory(0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67);
    address constant SAFE_L2 = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    uint256 constant SALT = uint256(keccak256("mcplus.admin.safe"));
    MerchantPay constant PAY = MerchantPay(0xAb817593253A0A37de723072827D88fE0ca54251);
    InvestorRegistry constant REGISTRY = InvestorRegistry(0x293430faE87CA79844c6E3A64E8044078c4d3E74);
    ClaimToken constant CLAIMS = ClaimToken(0xce9b171a5C485A41DCED9D7f043733Bddc26c388);

    MoveAdminToSafe script;
    uint256[] keys;
    address[] owners;
    bytes[] proofs;

    function setUp() public {
        vm.createSelectFork("whitechain", FORK_BLOCK);
        script = new MoveAdminToSafe();
        keys = [uint256(0xA11CE), 0xB0B, 0xCA401];
        for (uint256 i; i < 3; ++i) {
            owners.push(vm.addr(keys[i]));
            proofs.push(_proof(keys[i], owners[i]));
        }
    }

    function test_MovesEveryRoleToTheSafe() public {
        ISafe predicted = script.predict(owners);
        assertEq(address(predicted).code.length, 0, "not created yet");
        ISafe safe = script.move(DEPLOYER, owners, proofs);
        assertEq(address(safe), address(predicted));
        Ownable2Step[3] memory t = script.targets();
        for (uint256 i; i < 3; ++i) {
            assertEq(t[i].owner(), address(safe), "owner is the Safe");
            assertEq(t[i].pendingOwner(), address(0), "nothing pending");
        }
        assertEq(safe.getThreshold(), 2);
        assertEq(safe.getOwners().length, 3);
        for (uint256 i; i < 3; ++i) {
            assertTrue(safe.isOwner(owners[i]));
        }
        assertFalse(safe.isOwner(DEPLOYER), "the deployer is never an owner");
        assertEq(safe.nonce(), 0, "the accepts ran inside setup, not as Safe txs");
    }

    function test_DeployerLosesEveryRole() public {
        script.move(DEPLOYER, owners, proofs);
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
        ISafe safe = script.move(DEPLOYER, owners, proofs);
        address investor = makeAddr("investor");
        bytes memory eligible = abi.encodeCall(InvestorRegistry.setEligible, (investor, type(uint64).max));

        uint256[] memory one = new uint256[](1);
        one[0] = keys[0];
        bytes memory oneSig = _sign(safe, address(REGISTRY), eligible, one); // signed first: expectRevert takes the next call
        vm.expectRevert(bytes("GS020")); // signatures too short: 1 of the 2 needed
        _exec(safe, address(REGISTRY), eligible, oneSig);

        uint256[] memory withStranger = new uint256[](2);
        withStranger[0] = keys[0];
        withStranger[1] = 0x5714;
        bytes memory strangerSigs = _sign(safe, address(REGISTRY), eligible, withStranger);
        vm.expectRevert(bytes("GS026")); // a non-owner's signature doesn't count
        _exec(safe, address(REGISTRY), eligible, strangerSigs);

        uint256[] memory two = new uint256[](2);
        two[0] = keys[1];
        two[1] = keys[2];
        _exec(safe, address(REGISTRY), eligible, _sign(safe, address(REGISTRY), eligible, two));
        assertTrue(REGISTRY.isEligible(investor), "2 of 3 run setEligible");

        bytes memory pause = abi.encodeCall(MerchantPay.pause, ());
        _exec(safe, address(PAY), pause, _sign(safe, address(PAY), pause, two));
        assertTrue(PAY.paused(), "2 of 3 run pause");
    }

    /// @dev The admin listed as one of the 3 (here a fresh admin key, since the deployer's key isn't in CI).
    function test_AdminAsOneOfThreeCantActAlone() public {
        uint256 adminKey = 0xAD;
        address admin = vm.addr(adminKey);
        Ownable2Step[3] memory t = script.targets();
        for (uint256 i; i < 3; ++i) {
            vm.prank(DEPLOYER);
            t[i].transferOwnership(admin);
            vm.prank(admin);
            t[i].acceptOwnership();
        }
        owners[0] = admin;
        proofs[0] = _proof(adminKey, admin);
        ISafe safe = script.move(admin, owners, proofs);
        assertEq(safe.getThreshold(), 2);
        assertTrue(safe.isOwner(admin) && safe.isOwner(owners[1]) && safe.isOwner(owners[2]));

        bytes memory pause = abi.encodeCall(MerchantPay.pause, ());
        bytes memory approvedBySender = abi.encodePacked(uint256(uint160(admin)), bytes32(0), uint8(1));
        vm.prank(admin);
        vm.expectRevert(bytes("GS020"));
        _exec(safe, address(PAY), pause, approvedBySender);
    }

    /// @dev A broadcast that stopped after the first handover: the re-run skips it and finishes.
    function test_PartialBroadcastResumes() public {
        address predicted = address(script.predict(owners));
        vm.prank(DEPLOYER);
        PAY.transferOwnership(predicted);
        ISafe safe = script.move(DEPLOYER, owners, proofs);
        assertEq(address(safe), predicted);
        assertEq(PAY.owner(), predicted);
        assertEq(REGISTRY.owner(), predicted);
        assertEq(CLAIMS.owner(), predicted);
    }

    /// @dev Creating the Safe before every handover fails (its setup's accept reverts), so nobody can squat it.
    function test_SafeCantBeCreatedBeforeTheHandover() public {
        bytes memory init = script.initializer(owners);
        address predicted = address(script.predict(owners));
        vm.expectRevert(); // setup's accept reverts (GS000); the 1.4.1 factory re-raises it with no data
        FACTORY.createProxyWithNonce(SAFE_L2, init, SALT);

        vm.prank(DEPLOYER);
        PAY.transferOwnership(predicted);
        vm.expectRevert(); // two of the three are still not handed over
        FACTORY.createProxyWithNonce(SAFE_L2, init, SALT);

        assertEq(predicted.code.length, 0, "no Safe");
        assertEq(PAY.owner(), DEPLOYER, "the deployer keeps every role until the Safe exists");
        assertEq(PAY.pendingOwner(), predicted);
    }

    function test_CheckReadsTheLiveState() public {
        vm.setEnv(
            "SAFE_OWNERS",
            string.concat(vm.toString(owners[0]), ",", vm.toString(owners[1]), ",", vm.toString(owners[2]))
        );
        vm.expectRevert(); // no Safe yet
        script.check();
        ISafe safe = script.move(DEPLOYER, owners, proofs);
        assertEq(address(script.check()), address(safe));
    }

    function test_BadInputReverts() public {
        address[] memory two = new address[](2);
        two[0] = owners[0];
        two[1] = owners[1];
        vm.expectRevert(MoveAdminToSafe.NeedThreeOwners.selector);
        script.move(DEPLOYER, two, proofs);

        bytes[] memory twoProofs = new bytes[](2);
        vm.expectRevert(MoveAdminToSafe.NeedThreeOwners.selector);
        script.move(DEPLOYER, owners, twoProofs);

        address[] memory bad = owners;
        bad[2] = owners[0];
        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.BadOwner.selector, owners[0]));
        script.move(DEPLOYER, bad, proofs);
        bad[2] = address(0);
        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.BadOwner.selector, address(0)));
        script.move(DEPLOYER, bad, proofs);
        bad[2] = address(0x1);
        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.BadOwner.selector, address(0x1)));
        script.move(DEPLOYER, bad, proofs);

        // a typo or a contract address can't sign: no dead seats
        bad[2] = address(PAY);
        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.NoProofOfKey.selector, address(PAY)));
        script.move(DEPLOYER, bad, proofs);
        bad[2] = owners[2];
        bytes[] memory swapped = proofs;
        swapped[2] = proofs[1]; // owner 1's proof under owner 2
        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.NoProofOfKey.selector, owners[2]));
        script.move(DEPLOYER, owners, swapped);

        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.NotAdmin.selector, address(PAY), DEPLOYER, address(0)));
        script.move(makeAddr("stranger"), owners, proofs);

        address elsewhere = makeAddr("elsewhere");
        vm.prank(DEPLOYER);
        PAY.transferOwnership(elsewhere);
        vm.expectRevert(abi.encodeWithSelector(MoveAdminToSafe.NotAdmin.selector, address(PAY), DEPLOYER, elsewhere));
        script.move(DEPLOYER, owners, proofs);
    }

    // ---------- helpers ----------

    function _proof(uint256 key, address owner) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(script.ownerMessage(owner)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _exec(ISafe safe, address to, bytes memory data, bytes memory sigs) internal {
        safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), sigs);
    }

    /// @dev Signs the Safe tx hash with `signers`, sorted by address as Safe requires.
    function _sign(ISafe safe, address to, bytes memory data, uint256[] memory signers)
        internal
        view
        returns (bytes memory sigs)
    {
        bytes32 hash = safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), safe.nonce());
        uint256[] memory k = signers;
        for (uint256 i; i < k.length; ++i) {
            for (uint256 j = i + 1; j < k.length; ++j) {
                if (vm.addr(k[j]) < vm.addr(k[i])) (k[i], k[j]) = (k[j], k[i]);
            }
        }
        for (uint256 i; i < k.length; ++i) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(k[i], hash);
            sigs = abi.encodePacked(sigs, r, s, v);
        }
    }
}
