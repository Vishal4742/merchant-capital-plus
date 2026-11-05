// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerchantPay} from "../src/MerchantPay.sol";

/// @notice Live smoke test (FR-PAY-5, FR-PAY-8, FR-REL-7): the payer (0 WBT) signs one sale, the DEPLOYER submits it
///         (anyone can; the relayer key belongs to claude-relayer), then the deployer, as the merchant, refunds part.
///         Keys come from .env and are never logged.
///         Usage: MERCHANT_PAY=<address> forge script script/SmokeMerchantPay.s.sol --rpc-url whitechain --broadcast --slow
contract SmokeMerchantPay is Script {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint256 constant SALE = 2e6; // 2 USDT
    uint256 constant REFUND = 1e6; // 1 USDT back to the payer

    function run() external {
        MerchantPay mp = MerchantPay(vm.envAddress("MERCHANT_PAY"));
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 payerKey = vm.envUint("PAYER_PRIVATE_KEY");
        address merchant = vm.addr(deployerKey);
        address payer = vm.addr(payerKey);
        require(payer.balance == 0, "payer must hold 0 WBT");

        bytes32 orderRef = keccak256(abi.encode("smoke", payer, block.timestamp));
        bytes32 salt = keccak256(abi.encode(orderRef, "salt"));
        uint256 validBefore = block.timestamp + 15 minutes;
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_TYPEHASH, payer, address(mp), SALE, 0, validBefore, mp.saleNonce(merchant, orderRef, SALE, salt)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            payerKey, MessageHashUtils.toTypedDataHash(IERC20Permit(address(USDT)).DOMAIN_SEPARATOR(), structHash)
        );

        vm.startBroadcast(deployerKey);
        // Test funding only; the demo seed script is batch 003 (CON-8).
        if (USDT.balanceOf(payer) < SALE) require(USDT.transfer(payer, SALE), "funding failed");
        uint256 paymentId = mp.paySale(merchant, orderRef, payer, SALE, 0, validBefore, salt, v, r, s);
        USDT.approve(address(mp), REFUND);
        mp.refund(paymentId, REFUND);
        vm.stopBroadcast();
    }
}
