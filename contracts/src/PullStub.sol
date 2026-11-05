// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @dev The EIP-3009 surface of the prize USDT (0xcedf…55a7) that we use.
interface IUSDT3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
}

contract PullStub {
    IUSDT3009 public immutable usdt;
    address public immutable payee;

    constructor(IUSDT3009 usdt_, address payee_) {
        usdt = usdt_;
        payee = payee_;
    }

    function pull(address, uint256, uint256, uint256, bytes32, uint8, bytes32, bytes32) external {}
}
