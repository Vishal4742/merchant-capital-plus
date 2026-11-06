// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script, console} from "forge-std/Script.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev The Safe 1.4.1 calls this script and its tests make (operation 0 = call).
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
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function isOwner(address owner) external view returns (bool);
    function nonce() external view returns (uint256);
}

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
    function proxyCreationCode() external pure returns (bytes memory);
}

interface IMultiSend {
    function multiSend(bytes memory transactions) external payable;
}

/// @notice Batch 048: moves every admin role (the owner of MerchantPay, InvestorRegistry and ClaimToken) from the
///         deployer to a new 2-of-3 Safe 1.4.1, with no redeploy. CapitalMarket has no admin.
///         1. The deployer hands each contract to the Safe's predicted address (Ownable2Step: it stays owner until
///            the Safe accepts, so it can still change its mind).
///         2. The factory creates the Safe with the 3 owners at threshold 2, and the Safe's own setup accepts all three
///            (a delegatecall to MultiSendCallOnly). The Safe never exists with fewer owners or a lower threshold, and
///            the deployer is never one of its owners unless listed. If a handover is missing, creation reverts.
///         Every owner proves it holds its key: SAFE_OWNER_SIGS[i] is SAFE_OWNERS[i]'s personal_sign of
///         ownerMessage(owner) (`cast wallet sign "<message>"`, or MetaMask). So owners are EOAs, and a typo can't
///         become a dead seat.
///         dry run:   SAFE_OWNERS=0xA,0xB,0xC SAFE_OWNER_SIGS=0x..,0x..,0x.. forge script script/MoveAdminToSafe.s.sol --rpc-url whitechain
///         broadcast: the same plus --broadcast --slow, ONLY after both G5 runs and the human's yes.
///         then:      SAFE_OWNERS=... forge script script/MoveAdminToSafe.s.sol --sig "check()" --rpc-url whitechain
///         A broadcast that stops part-way is safe to re-run: handed-over contracts are skipped, and the deployer still
///         owns every contract until the Safe is created.
contract MoveAdminToSafe is Script {
    // Safe 1.4.1, canonical on chain 1874 (safe-global/safe-deployments v1.4.1; code hashes checked on chain, batch 048)
    ISafeProxyFactory constant FACTORY = ISafeProxyFactory(0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67);
    address constant SAFE_L2 = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    address constant MULTI_SEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;
    address constant SENTINEL = address(0x1); // the Safe's owner-list head
    uint256 constant OWNERS = 3;
    uint256 constant THRESHOLD = 2;
    uint256 constant SALT = uint256(keccak256("mcplus.admin.safe"));

    error NeedThreeOwners();
    error BadOwner(address owner);
    /// @notice `owner` didn't sign ownerMessage(owner): no proof anyone holds that key.
    error NoProofOfKey(address owner);
    /// @notice A contract isn't owned by the admin, or is pending to someone other than this Safe: nothing was sent.
    error NotAdmin(address target, address owner, address pendingOwner);

    function run() external returns (ISafe safe) {
        address admin = vm.rememberKey(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        safe = move(admin, vm.envAddress("SAFE_OWNERS", ","), vm.envBytes("SAFE_OWNER_SIGS", ","));
        console.log("Safe", address(safe));
    }

    /// @notice Read-only, against the live chain after the broadcast: reverts unless the Safe holds every role, 2 of 3.
    function check() external view returns (ISafe safe) {
        address[] memory owners = vm.envAddress("SAFE_OWNERS", ",");
        safe = predict(owners);
        _verify(safe, owners);
    }

    /// @notice The live contracts (packages/shared/contracts.ts): MerchantPay, InvestorRegistry, ClaimToken.
    function targets() public pure returns (Ownable2Step[3] memory t) {
        t[0] = Ownable2Step(0xAb817593253A0A37de723072827D88fE0ca54251);
        t[1] = Ownable2Step(0x293430faE87CA79844c6E3A64E8044078c4d3E74);
        t[2] = Ownable2Step(0xce9b171a5C485A41DCED9D7f043733Bddc26c388);
    }

    /// @notice The text each owner signs (personal_sign) to prove it holds its key.
    function ownerMessage(address owner) public pure returns (string memory) {
        return string.concat("Merchant Capital+ admin Safe: I hold the key of ", vm.toString(owner), " on chain 1874");
    }

    /// @notice Safe.setup for the final Safe: the owners at threshold 2, and acceptOwnership on every target.
    function initializer(address[] memory owners) public pure returns (bytes memory) {
        bytes memory accept = abi.encodeCall(Ownable2Step.acceptOwnership, ());
        Ownable2Step[3] memory t = targets();
        bytes memory calls;
        for (uint256 i; i < t.length; ++i) {
            calls = abi.encodePacked(calls, uint8(0), address(t[i]), uint256(0), accept.length, accept);
        }
        return abi.encodeCall(
            ISafe.setup,
            (
                owners,
                THRESHOLD,
                MULTI_SEND_CALL_ONLY,
                abi.encodeCall(IMultiSend.multiSend, (calls)),
                FALLBACK_HANDLER,
                address(0),
                0,
                payable(address(0))
            )
        );
    }

    /// @notice The Safe's CREATE2 address (SafeProxyFactory 1.4.1): it commits to the owners, threshold and accepts.
    function predict(address[] memory owners) public view returns (ISafe) {
        bytes32 salt = keccak256(abi.encodePacked(keccak256(initializer(owners)), SALT));
        bytes32 code = keccak256(abi.encodePacked(FACTORY.proxyCreationCode(), uint256(uint160(SAFE_L2))));
        return ISafe(vm.computeCreate2Address(salt, code, address(FACTORY)));
    }

    function move(address admin, address[] memory owners, bytes[] memory proofs) public returns (ISafe safe) {
        safe = predict(owners);
        bool[3] memory handedOver = _check(admin, owners, proofs, address(safe)); // every check before the first tx
        Ownable2Step[3] memory t = targets();
        vm.startBroadcast(admin);
        for (uint256 i; i < t.length; ++i) {
            if (!handedOver[i]) t[i].transferOwnership(address(safe));
        }
        address created = FACTORY.createProxyWithNonce(SAFE_L2, initializer(owners), SALT);
        vm.stopBroadcast();
        require(created == address(safe), "Safe address mismatch");
        _verify(safe, owners);
    }

    /// @return handedOver Contracts already pending to this Safe (a re-run after a broadcast that stopped part-way).
    function _check(address admin, address[] memory owners, bytes[] memory proofs, address safe)
        internal
        view
        returns (bool[3] memory handedOver)
    {
        if (owners.length != OWNERS || proofs.length != OWNERS) revert NeedThreeOwners();
        for (uint256 i; i < OWNERS; ++i) {
            address owner = owners[i];
            if (owner == address(0) || owner == SENTINEL || owner == safe) revert BadOwner(owner);
            for (uint256 j; j < i; ++j) {
                if (owners[j] == owner) revert BadOwner(owner);
            }
            bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(ownerMessage(owner)));
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, proofs[i]);
            if (err != ECDSA.RecoverError.NoError || signer != owner) revert NoProofOfKey(owner);
        }
        if (safe.code.length != 0) revert BadOwner(safe); // already created: run check() instead
        Ownable2Step[3] memory t = targets();
        for (uint256 i; i < t.length; ++i) {
            address pending = t[i].pendingOwner();
            if (t[i].owner() != admin || (pending != address(0) && pending != safe)) {
                revert NotAdmin(address(t[i]), t[i].owner(), pending);
            }
            handedOver[i] = pending == safe;
        }
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
