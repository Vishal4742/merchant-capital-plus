// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PullStub} from "../src/PullStub.sol";
import {USDT, receiveDigest} from "../script/RelayPull.s.sol";

/// @notice Fork tests on Whitechain Sepolia 1874 against the real prize USDT (SRS DEP-1, CON-2, CON-4).
contract PullStubForkTest is Test {
    /// Large USDT holder that funds the test payer (research_notes/build_prep/contracts_prep.md §5).
    address constant HOLDER = 0xFfD76ff981cc7EA15EE2F67680815763C4C7683E;
    uint256 constant AMOUNT = 1e6; // 1 USDT
    bytes32 constant NONCE = keccak256("PullStubForkTest");

    IERC20 token = IERC20(address(USDT));
    PullStub stub;
    address payee = makeAddr("payee");
    address relayer = makeAddr("relayer");
    address payer;
    uint256 payerKey;
    uint256 validBefore;

    function setUp() public {
        vm.createSelectFork("whitechain");
        (payer, payerKey) = makeAddrAndKey("payer");
        stub = new PullStub(USDT, payee);
        validBefore = block.timestamp + 15 minutes;
        vm.prank(HOLDER);
        token.transfer(payer, 2 * AMOUNT); // twice the amount, so a replay can't fail for lack of balance
    }

    function _sign(uint256 key) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        return vm.sign(key, receiveDigest(payer, address(stub), AMOUNT, 0, validBefore, NONCE));
    }

    function _relay(uint8 v, bytes32 r, bytes32 s) internal {
        vm.prank(relayer);
        stub.pull(payer, AMOUNT, 0, validBefore, NONCE, v, r, s);
    }

    function test_TokenUsesStandardEip3009Typehash() public view {
        assertEq(
            USDT.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
            keccak256(
                "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
            )
        );
    }

    function test_RelayerPullsForPayerWithNoGasToken() public {
        uint256 payerBefore = token.balanceOf(payer);
        uint256 payeeBefore = token.balanceOf(payee);
        assertEq(payer.balance, 0, "payer starts with 0 WBT");

        (uint8 v, bytes32 r, bytes32 s) = _sign(payerKey);
        _relay(v, r, s);

        assertEq(token.balanceOf(payer), payerBefore - AMOUNT, "payer paid");
        assertEq(token.balanceOf(payee), payeeBefore + AMOUNT, "payee received");
        assertEq(token.balanceOf(address(stub)), 0, "nothing stays in the stub");
        assertEq(payer.balance, 0, "payer still has 0 WBT");
        assertTrue(USDT.authorizationState(payer, NONCE), "authorization marked used");
    }

    function test_RevertWhen_AuthorizationIsReplayed() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(payerKey);
        _relay(v, r, s);
        vm.expectRevert(bytes("TetherToken: auth invalid"));
        _relay(v, r, s);
    }

    /// A front-runner who copies the signature from the mempool can't redeem it outside PullStub.
    function test_RevertWhen_ThirdPartyCallsTokenDirectly() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(payerKey);
        vm.expectRevert(bytes("TetherToken: to != msg.sender"));
        vm.prank(relayer);
        USDT.receiveWithAuthorization(payer, address(stub), AMOUNT, 0, validBefore, NONCE, v, r, s);
    }

    function test_RevertWhen_SignedByAnotherKey() public {
        (, uint256 otherKey) = makeAddrAndKey("other");
        (uint8 v, bytes32 r, bytes32 s) = _sign(otherKey);
        vm.expectRevert(bytes("TetherToken: invalid signature"));
        _relay(v, r, s);
    }
}
