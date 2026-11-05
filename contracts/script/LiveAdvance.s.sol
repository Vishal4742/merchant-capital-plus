// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerchantPay} from "../src/MerchantPay.sol";
import {CapitalMarket} from "../src/CapitalMarket.sol";

/// @notice Gate G3 live on 1874 (SRS AT-3, AT-4, AT-5 at ÷100): the demo merchant lists an advance (its own tx),
///         demo investor A funds it with one signature, then the customer (PAYER, 0 WBT) pays sales that repay 20% each
///         until the cap; the deployer submits every signed action, so investor and customer never need WBT.
///         Usage: MERCHANT_PAY=<addr> CAPITAL_MARKET=<addr> forge script script/LiveAdvance.s.sol --rpc-url whitechain --broadcast --slow
contract LiveAdvance is Script {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint128 constant PRINCIPAL = 10e6; // AT-3 ÷100: advance 10
    uint128 constant CAP = 11e6; //            cap 11
    uint16 constant HOLDBACK = 2000; //        holdback 20%
    uint256 constant CUSTOMER_FLOAT = 56e6; // 5 (AT-4) + 5 × 10 (AT-5) + 1 (after the cap)

    MerchantPay mp;
    CapitalMarket market;
    uint256 deployerKey;
    uint256 customerKey;
    uint256 merchantKey;
    address merchant;
    uint256 validBefore;

    function run() external {
        mp = MerchantPay(vm.envAddress("MERCHANT_PAY"));
        market = CapitalMarket(vm.envAddress("CAPITAL_MARKET"));
        deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        customerKey = vm.envUint("PAYER_PRIVATE_KEY");
        merchantKey = vm.envUint("DEMO_MERCHANT_PRIVATE_KEY");
        uint256 investorKey = vm.envUint("DEMO_INVESTOR_A_PRIVATE_KEY");
        merchant = vm.addr(merchantKey);
        address investor = vm.addr(investorKey);
        validBefore = block.timestamp + 15 minutes;

        // AT-3: list, then fund with one investor signature.
        vm.broadcast(merchantKey);
        uint256 claimId = market.listAdvance(PRINCIPAL, CAP, HOLDBACK, 30 days, uint64(block.timestamp + 1 days));
        uint256 cost = market.quote(claimId, CAP);
        bytes32 nonce = market.fundingNonce(claimId, investor, CAP, "at3");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(investorKey, _digest(investor, address(market), cost, nonce));
        vm.broadcast(deployerKey);
        market.fundWithAuthorization(claimId, investor, CAP, 0, validBefore, "at3", v, r, s);

        // Customer float: what the team wallet can spare now; the merchant recycles its takings for the rest (_sale).
        address customer = vm.addr(customerKey);
        uint256 held = USDT.balanceOf(customer);
        uint256 spare = USDT.balanceOf(vm.addr(deployerKey));
        if (held < CUSTOMER_FLOAT && spare != 0) {
            uint256 topUp = CUSTOMER_FLOAT - held < spare ? CUSTOMER_FLOAT - held : spare;
            vm.broadcast(deployerKey);
            require(USDT.transfer(customer, topUp), "funding failed");
        }

        _sale(5e6, "at4"); // AT-4: 1 to the investor, 10 left
        for (uint256 i = 0; i < 5; ++i) {
            _sale(10e6, bytes32(abi.encode("at5", i))); // AT-5: 2 each until the cap
        }
        _sale(1e6, "after-cap"); // lien gone: 100% minus the fee to the merchant
    }

    function _sale(uint256 amount, bytes32 label) internal {
        address customer = vm.addr(customerKey);
        uint256 held = USDT.balanceOf(customer);
        if (held < amount) {
            // The shop sends back some of its takings (its own tx and WBT), so the customer can keep buying.
            uint256 shortfall = amount - held;
            vm.broadcast(merchantKey);
            require(USDT.transfer(customer, shortfall), "recycle failed");
        }
        bytes32 orderRef = keccak256(abi.encode(label, block.timestamp, address(market)));
        bytes32 nonce = mp.saleNonce(merchant, orderRef, amount, "s");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(customerKey, _digest(customer, address(mp), amount, nonce));
        vm.broadcast(deployerKey);
        mp.paySale(merchant, orderRef, customer, amount, 0, validBefore, "s", v, r, s);
    }

    function _digest(address from, address to, uint256 value, bytes32 nonce) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(RECEIVE_TYPEHASH, from, to, value, 0, validBefore, nonce));
        return MessageHashUtils.toTypedDataHash(IERC20Permit(address(USDT)).DOMAIN_SEPARATOR(), structHash);
    }
}
