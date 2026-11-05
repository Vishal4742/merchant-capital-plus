// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerchantPay} from "../src/MerchantPay.sol";
import {CapitalMarket} from "../src/CapitalMarket.sol";

/// @notice Gate G4 live on 1874 (SRS AT-6, AT-7 at ÷100; AT-8 is checked read-only between the two steps).
///         fund():    the demo merchant creates a 100 USDT invoice due in 60 days and lists it at the 12% APR price;
///                    demo investors A and B fund 60 / 40 units with one signature each (the deployer submits).
///         pay(id):   the demo debtor (0 WBT) signs 100 + the relay fee; the deployer submits; holders are repaid
///                    60 / 40 in the same tx and the claim settles.
///         Usage: MERCHANT_PAY=… CAPITAL_MARKET=… forge script script/LiveInvoice.s.sol --sig "fund()" …
///                then (after the AT-8 cast checks) … --sig "pay(uint256)" <invoiceId>
contract LiveInvoice is Script {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint128 constant FACE = 100e6; // AT-6 ÷100
    uint128 constant PRICE = 98_065_556; // 100 / (1 + 0.12 × 60/365), rounded down (UI convention: yield basis)
    uint256 constant UNITS_A = 60e6;
    uint256 constant UNITS_B = 40e6;

    function fund() external {
        MerchantPay mp = MerchantPay(vm.envAddress("MERCHANT_PAY"));
        CapitalMarket market = CapitalMarket(vm.envAddress("CAPITAL_MARKET"));
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 merchantKey = vm.envUint("DEMO_MERCHANT_PRIVATE_KEY");
        address debtor = vm.addr(vm.envUint("DEMO_DEBTOR_PRIVATE_KEY"));

        vm.startBroadcast(merchantKey);
        uint256 invoiceId = mp.createInvoice(
            debtor, FACE, uint64(block.timestamp + 60 days), keccak256(abi.encode("g4", block.timestamp))
        );
        uint256 claimId = market.listInvoice(invoiceId, PRICE, uint64(block.timestamp + 1 days), 0);
        vm.stopBroadcast();

        _fundAs(market, deployerKey, vm.envUint("DEMO_INVESTOR_A_PRIVATE_KEY"), claimId, UNITS_A);
        _fundAs(market, deployerKey, vm.envUint("DEMO_INVESTOR_B_PRIVATE_KEY"), claimId, UNITS_B);
        console.log("invoiceId", invoiceId);
        console.log("claimId", claimId);
    }

    function pay(uint256 invoiceId) external {
        MerchantPay mp = MerchantPay(vm.envAddress("MERCHANT_PAY"));
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 debtorKey = vm.envUint("DEMO_DEBTOR_PRIVATE_KEY");
        address debtor = vm.addr(debtorKey);
        uint256 value = FACE + mp.relayFee(); // invoices: fee on top
        uint256 held = USDT.balanceOf(debtor);
        if (held < value) {
            uint256 topUp = value - held; // the 0.10 fee; the merchant sends it (its own tx and WBT)
            vm.broadcast(vm.envUint("DEMO_MERCHANT_PRIVATE_KEY"));
            require(USDT.transfer(debtor, topUp), "top-up failed");
        }
        uint256 validBefore = block.timestamp + 15 minutes;
        bytes32 nonce = mp.invoiceNonce(invoiceId, FACE, "g4");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(debtorKey, _digest(debtor, address(mp), value, validBefore, nonce));
        vm.broadcast(deployerKey);
        mp.payInvoice(invoiceId, debtor, FACE, 0, validBefore, "g4", v, r, s);
    }

    function _fundAs(CapitalMarket market, uint256 deployerKey, uint256 investorKey, uint256 claimId, uint256 units)
        internal
    {
        address investor = vm.addr(investorKey);
        uint256 validBefore = block.timestamp + 15 minutes;
        uint256 cost = market.quote(claimId, units);
        bytes32 nonce = market.fundingNonce(claimId, investor, units, "g4");
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(investorKey, _digest(investor, address(market), cost, validBefore, nonce));
        vm.broadcast(deployerKey);
        market.fundWithAuthorization(claimId, investor, units, 0, validBefore, "g4", v, r, s);
    }

    function _digest(address from, address to, uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, from, to, value, 0, validBefore, nonce));
        return MessageHashUtils.toTypedDataHash(IERC20Permit(address(USDT)).DOMAIN_SEPARATOR(), structHash);
    }
}
