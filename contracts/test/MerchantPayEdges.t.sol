// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerchantPay} from "../src/MerchantPay.sol";

/// @notice Smart-wallet payer that, while the token checks its ERC-1271 signature, tries to re-enter MerchantPay with
///         a call armed beforehand. It approves its own payment only if that re-entry reverted.
contract ReenteringWallet {
    bytes4 constant MAGIC = 0x1626ba7e; // IERC1271.isValidSignature.selector
    address immutable target;
    bytes armed;

    constructor(address target_) {
        target = target_;
    }

    function arm(bytes calldata call_) external {
        armed = call_;
    }

    /// Not `view` on purpose: it attempts a state-changing call. The token reaches it with a staticcall.
    function isValidSignature(bytes32, bytes calldata) external returns (bytes4) {
        (bool reentered,) = target.call(armed);
        return reentered ? bytes4(0xffffffff) : MAGIC;
    }
}

/// @notice Tester-added fork tests for batch 002 round 1 (gaps found against spec.md): ERC-1271 re-entry, refund
///         pull failures, cumulative Refunded event, constructor RelayFeeSet, and the 1 USDT boundaries.
contract MerchantPayEdgesForkTest is Test {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    address constant HOLDER = 0xFfD76ff981cc7EA15EE2F67680815763C4C7683E;
    uint256 constant FORK_BLOCK = 12_303_386;
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint256 constant SALE = 25e6;
    uint256 constant FEE = 100_000;

    MerchantPay mp;
    address merchant = makeAddr("merchant");
    address feeRecipient = makeAddr("feeRecipient");
    address anyone = makeAddr("anyone");
    address payer;
    uint256 payerKey;
    uint256 validBefore;

    function setUp() public {
        vm.createSelectFork("whitechain", FORK_BLOCK);
        (payer, payerKey) = makeAddrAndKey("payer");
        mp = new MerchantPay(USDT, feeRecipient);
        validBefore = block.timestamp + 15 minutes;
        vm.prank(HOLDER);
        USDT.transfer(payer, 100e6);
    }

    function _saleCall(bytes32 orderRef, uint256 amount, bytes32 salt) internal view returns (bytes memory) {
        bytes32 nonce = mp.saleNonce(merchant, orderRef, amount, salt);
        bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, payer, address(mp), amount, 0, validBefore, nonce));
        bytes32 digest = MessageHashUtils.toTypedDataHash(IERC20Permit(address(USDT)).DOMAIN_SEPARATOR(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        return abi.encodeCall(mp.paySale, (merchant, orderRef, payer, amount, 0, validBefore, salt, v, r, s));
    }

    function _paySale(bytes32 orderRef, uint256 amount) internal returns (uint256 paymentId) {
        bytes memory call_ = _saleCall(orderRef, amount, "s1");
        vm.prank(anyone);
        (bool ok, bytes memory ret) = address(mp).call(call_);
        assertTrue(ok, "paySale");
        paymentId = abi.decode(ret, (uint256));
    }

    /// Re-entry through a malicious ERC-1271 payer is impossible (spec "Out of scope" claim, NFR-1): the wallet's
    /// re-entry into paySale reverts, its own payment goes through once, and the armed call was valid on its own.
    function test_Erc1271PayerCannotReenterPaySale() public {
        ReenteringWallet wallet = new ReenteringWallet(address(mp));
        vm.prank(HOLDER);
        USDT.transfer(address(wallet), 5e6);
        bytes32 innerOrder = keccak256("inner");
        wallet.arm(_saleCall(innerOrder, 5e6, "s1"));
        uint256 payerBefore = USDT.balanceOf(payer);

        vm.prank(anyone);
        uint256 paymentId =
            mp.paySale(merchant, keccak256("outer"), address(wallet), 5e6, 0, validBefore, "w", 27, 0, 0);

        assertEq(paymentId, 1);
        assertEq(mp.paymentCount(), 1, "re-entry recorded no payment");
        assertEq(mp.saleOf(merchant, innerOrder), 0, "inner order unpaid");
        assertEq(USDT.balanceOf(payer), payerBefore, "inner payer untouched");
        assertEq(USDT.balanceOf(address(wallet)), 0, "wallet paid its own sale");
        assertEq(USDT.balanceOf(merchant), 5e6 - FEE);
        assertEq(USDT.balanceOf(address(mp)), 0);

        // Control: the armed call was a valid payment; it only failed because it was a re-entry.
        bytes memory armed = _saleCall(innerOrder, 5e6, "s1");
        vm.prank(anyone);
        (bool ok,) = address(mp).call(armed);
        assertTrue(ok, "armed call pays outside the re-entry");
        assertEq(mp.saleOf(merchant, innerOrder), 2);
    }

    /// FR-PAY-8: a refund the merchant hasn't approved (or can't cover) reverts whole; nothing is recorded or moved.
    function test_RevertWhen_RefundAllowanceOrBalanceTooSmall() public {
        uint256 paymentId = _paySale(keccak256("order-1"), SALE);
        uint256 payerBefore = USDT.balanceOf(payer);

        vm.startPrank(merchant);
        USDT.approve(address(mp), 1e6);
        vm.expectRevert(bytes("ERC20: transfer amount exceeds allowance"));
        mp.refund(paymentId, 2e6);

        USDT.approve(address(mp), SALE);
        vm.expectRevert(bytes("ERC20: transfer amount exceeds balance"));
        mp.refund(paymentId, SALE); // merchant holds SALE - FEE
        vm.stopPrank();

        (,,, uint96 refunded) = mp.payments(paymentId);
        assertEq(refunded, 0, "failed refunds record nothing");
        assertEq(USDT.balanceOf(payer), payerBefore);
        assertEq(USDT.balanceOf(merchant), SALE - FEE);
    }

    /// Refunded.totalRefunded is cumulative, not the last amount (ARCHITECTURE §2 event; indexers read it).
    function test_SecondRefundEmitsCumulativeTotal() public {
        uint256 paymentId = _paySale(keccak256("order-1"), SALE);
        vm.startPrank(merchant);
        USDT.approve(address(mp), type(uint256).max);
        mp.refund(paymentId, 10e6);
        vm.expectEmit(true, false, false, true, address(mp));
        emit MerchantPay.Refunded(paymentId, 5e6, 15e6);
        mp.refund(paymentId, 5e6);
        vm.stopPrank();
    }

    /// Indexers learn the starting fee and recipient from the constructor's RelayFeeSet.
    function test_ConstructorEmitsRelayFeeSet() public {
        vm.expectEmit(false, false, false, true);
        emit MerchantPay.RelayFeeSet(FEE, feeRecipient);
        new MerchantPay(USDT, feeRecipient);
    }

    /// FR-REL-4: exactly 1 USDT is a valid sale and a valid invoice; a due date one second ahead is valid.
    function test_MinimumPaymentIsAccepted() public {
        uint256 saleId = _paySale(keccak256("order-min"), 1e6);
        assertEq(USDT.balanceOf(merchant), 1e6 - FEE);

        vm.prank(merchant);
        uint256 id = mp.createInvoice(address(0), 1e6, uint64(block.timestamp + 1), bytes32(0));
        bytes32 nonce = mp.invoiceNonce(id, 1e6, "s1");
        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_TYPEHASH, payer, address(mp), 1e6 + FEE, 0, validBefore, nonce)); // invoices: fee on top
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            payerKey, MessageHashUtils.toTypedDataHash(IERC20Permit(address(USDT)).DOMAIN_SEPARATOR(), structHash)
        );
        vm.prank(anyone);
        uint256 invoicePaymentId = mp.payInvoice(id, payer, 1e6, 0, validBefore, "s1", v, r, s);

        assertEq(saleId, 1);
        assertEq(invoicePaymentId, 2);
        assertEq(USDT.balanceOf(merchant), (1e6 - FEE) + 1e6, "sale minus fee + invoice credited in full");
        assertEq(USDT.balanceOf(address(mp)), 0);
    }
}
