// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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

/// @title PullStub: Phase 1 rail proof (SRS DEP-1, FR-REL-1 stub)
/// @notice Pulls USDT with the payer's signed EIP-3009 authorization and forwards all of it to `payee`.
///         Anyone may submit, so the relayer pays the gas and the payer never needs WBT. The token only
///         accepts the call from the payee named in the signature (this contract), so a copied signature
///         can't be redeemed anywhere else. Nothing is kept here.
/// @dev ponytail: stub with no invoice-bound nonce, fee or minimum; replaced by MerchantPay in Phase 2.
contract PullStub {
    using SafeERC20 for IERC20;

    IUSDT3009 public immutable usdt;
    address public immutable payee;

    constructor(IUSDT3009 usdt_, address payee_) {
        require(payee_ != address(0), "PullStub: zero payee");
        usdt = usdt_;
        payee = payee_;
    }

    function pull(
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        usdt.receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s);
        IERC20(address(usdt)).safeTransfer(payee, value);
    }
}
