// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script} from "forge-std/Script.sol";
import {IUSDT3009, PullStub} from "../src/PullStub.sol";

// The prize USDT on Whitechain Sepolia 1874 (SRS CON-2).
IUSDT3009 constant USDT = IUSDT3009(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);

/// EIP-712 digest of an EIP-3009 ReceiveWithAuthorization, built from the token's own domain separator and typehash.
function receiveDigest(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
    view
    returns (bytes32)
{
    bytes32 structHash = keccak256(
        abi.encode(USDT.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, validAfter, validBefore, nonce)
    );
    return keccak256(abi.encodePacked("\x19\x01", USDT.DOMAIN_SEPARATOR(), structHash));
}

/// @notice G1 (SRS DEP-1, FR-REL-1 stub): the deployer deploys PullStub, the payer (0 WBT) signs one
///         ReceiveWithAuthorization, and the relayer key submits the pull and pays the gas.
///         Keys come from .env and are never logged. Run with --slow so the pull lands after the deploy.
contract RelayPull is Script {
    uint256 constant AMOUNT = 1e6; // 1 USDT
    uint256 constant WINDOW = 15 minutes; // signature window, ARCHITECTURE.md §3 drain guard (6)

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 relayerKey = vm.envUint("RELAYER_PRIVATE_KEY");
        uint256 payerKey = vm.envUint("PAYER_PRIVATE_KEY");
        address payer = vm.addr(payerKey);
        require(payer.balance == 0, "payer must hold 0 WBT");

        vm.broadcast(deployerKey);
        PullStub stub = new PullStub(USDT, vm.addr(deployerKey));

        uint256 validBefore = block.timestamp + WINDOW;
        bytes32 nonce = keccak256(abi.encode(address(stub), payer, block.timestamp));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(payerKey, receiveDigest(payer, address(stub), AMOUNT, 0, validBefore, nonce));

        vm.broadcast(relayerKey);
        stub.pull(payer, AMOUNT, 0, validBefore, nonce, v, r, s);
    }
}
