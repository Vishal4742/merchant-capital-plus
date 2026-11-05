// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IUSDT3009} from "../src/PullStub.sol";

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
