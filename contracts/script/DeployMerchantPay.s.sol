// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MerchantPay} from "../src/MerchantPay.sol";

/// @notice Deploys MerchantPay on Whitechain Sepolia 1874 with the deployer key (batch 002-P2-merchantpay).
///         Run only from a clean, committed tree; then `bash contracts/script/export-abi.sh`.
contract DeployMerchantPay is Script {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    /// Relay fees go to the relayer hot wallet so the fee-swap keeper (FR-REL-8) can refill gas from them.
    /// The owner can move them anywhere with setRelayFee.
    address constant FEE_RECIPIENT = 0xdd02FE971Ad9e21365673E701693e7ab7bF9a651;

    function run() external returns (MerchantPay mp) {
        vm.broadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        mp = new MerchantPay(USDT, FEE_RECIPIENT);
    }
}
