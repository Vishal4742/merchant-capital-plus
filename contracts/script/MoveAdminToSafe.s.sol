// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script, console} from "forge-std/Script.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @dev The Safe 1.4.1 calls this script makes (operation 0 = call).
interface ISafe {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 nonce
    ) external view returns (bytes32);
    function addOwnerWithThreshold(address owner, uint256 threshold) external;
    function removeOwner(address prevOwner, address owner, uint256 threshold) external;
    function changeThreshold(uint256 threshold) external;
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function isOwner(address owner) external view returns (bool);
    function nonce() external view returns (uint256);
}

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

/// @notice Batch 048: moves every admin role (the owner of MerchantPay, InvestorRegistry and ClaimToken) from the
///         deployer to a new 2-of-3 Safe 1.4.1, with no redeploy. CapitalMarket has no admin.
///         dry run:   SAFE_OWNERS=0xA,0xB,0xC forge script script/MoveAdminToSafe.s.sol --rpc-url whitechain
///         broadcast: the same plus --broadcast, ONLY after both G5 runs and the human's yes (G5 may need setEligible).
///         The deployer is the Safe's only owner (threshold 1) until the last step of this run, and is removed then
///         unless it is one of SAFE_OWNERS.
contract MoveAdminToSafe is Script {
    // Safe 1.4.1, canonical on chain 1874 (safe-global/safe-deployments v1.4.1; code checked on chain, batch 048)
    ISafeProxyFactory constant FACTORY = ISafeProxyFactory(0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67);
    address constant SAFE_L2 = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    address constant SENTINEL = address(0x1); // the Safe's owner-list head
    uint256 constant OWNERS = 3;
    uint256 constant THRESHOLD = 2;
    uint256 constant SALT = uint256(keccak256("mcplus.admin.safe"));

    error NeedThreeOwners();
    error BadOwner(address owner);
    /// @notice A contract isn't owned by the admin, or already has a pending owner: nothing was sent.
    error NotAdmin(address target, address owner, address pendingOwner);

    function run() external returns (ISafe safe) {
        address admin = vm.rememberKey(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        safe = move(admin, vm.envAddress("SAFE_OWNERS", ","));
        console.log("Safe", address(safe));
    }

    /// @notice The live contracts (packages/shared/contracts.ts): MerchantPay, InvestorRegistry, ClaimToken.
    function targets() public pure returns (Ownable2Step[3] memory t) {
        t[0] = Ownable2Step(0xAb817593253A0A37de723072827D88fE0ca54251);
        t[1] = Ownable2Step(0x293430faE87CA79844c6E3A64E8044078c4d3E74);
        t[2] = Ownable2Step(0xce9b171a5C485A41DCED9D7f043733Bddc26c388);
    }

    function move(address admin, address[] memory owners) public returns (ISafe safe) {
        _check(admin, owners); // every check before the first tx
        Ownable2Step[3] memory t = targets();
        address[] memory boot = new address[](1);
        boot[0] = admin;
        bytes memory init = abi.encodeCall(
            ISafe.setup, (boot, 1, address(0), "", FALLBACK_HANDLER, address(0), 0, payable(address(0)))
        );

        vm.startBroadcast(admin);
        safe = ISafe(FACTORY.createProxyWithNonce(SAFE_L2, init, SALT));
        for (uint256 i; i < t.length; ++i) {
            t[i].transferOwnership(address(safe));
        }
        for (uint256 i; i < t.length; ++i) {
            _exec(safe, admin, address(t[i]), abi.encodeCall(Ownable2Step.acceptOwnership, ()));
        }
        bool adminStays;
        for (uint256 i; i < OWNERS; ++i) {
            if (owners[i] == admin) adminStays = true;
            else _exec(safe, admin, address(safe), abi.encodeCall(ISafe.addOwnerWithThreshold, (owners[i], 1)));
        }
        _exec(
            safe,
            admin,
            address(safe),
            adminStays
                ? abi.encodeCall(ISafe.changeThreshold, (THRESHOLD))
                : abi.encodeCall(ISafe.removeOwner, (_prevOwner(safe, admin), admin, THRESHOLD))
        );
        vm.stopBroadcast();

        _verify(safe, owners);
    }

    function _check(address admin, address[] memory owners) internal view {
        if (owners.length != OWNERS) revert NeedThreeOwners();
        for (uint256 i; i < OWNERS; ++i) {
            if (owners[i] == address(0) || owners[i] == SENTINEL) revert BadOwner(owners[i]);
            for (uint256 j; j < i; ++j) {
                if (owners[j] == owners[i]) revert BadOwner(owners[i]);
            }
        }
        Ownable2Step[3] memory t = targets();
        for (uint256 i; i < t.length; ++i) {
            if (t[i].owner() != admin || t[i].pendingOwner() != address(0)) {
                revert NotAdmin(address(t[i]), t[i].owner(), t[i].pendingOwner());
            }
        }
    }

    /// @dev One Safe tx from the admin while it is the only owner: v = 1 is Safe's "approved by msg.sender" signature,
    ///      so nothing is signed. safeTxGas = gasPrice = 0 makes a failing inner call revert the whole tx (GS013).
    function _exec(ISafe safe, address admin, address to, bytes memory data) internal {
        bytes memory approvedBySender = abi.encodePacked(uint256(uint160(admin)), bytes32(0), uint8(1));
        safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), approvedBySender);
    }

    function _prevOwner(ISafe safe, address owner) internal view returns (address) {
        address[] memory list = safe.getOwners();
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == owner) return i == 0 ? SENTINEL : list[i - 1];
        }
        revert BadOwner(owner);
    }

    function _verify(ISafe safe, address[] memory owners) internal view {
        Ownable2Step[3] memory t = targets();
        for (uint256 i; i < t.length; ++i) {
            require(t[i].owner() == address(safe) && t[i].pendingOwner() == address(0), "role not moved");
        }
        require(safe.getThreshold() == THRESHOLD && safe.getOwners().length == OWNERS, "Safe is not 2 of 3");
        for (uint256 i; i < OWNERS; ++i) {
            require(safe.isOwner(owners[i]), "owner missing");
        }
    }
}
