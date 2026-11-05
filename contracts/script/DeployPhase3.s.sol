// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {ClaimToken} from "../src/ClaimToken.sol";
import {MerchantPay} from "../src/MerchantPay.sol";
import {CapitalMarket} from "../src/CapitalMarket.sol";
import {IInvestorRegistry} from "../src/interfaces/IInvestorRegistry.sol";
import {ICapitalMarket} from "../src/interfaces/ICapitalMarket.sol";

/// @notice Deploys and wires the Phase 3 contracts on Whitechain Sepolia 1874 with the deployer key (batch 005):
///         InvestorRegistry → ClaimToken → MerchantPay → CapitalMarket → setMarket ×2, lists the demo investors,
///         and pauses the earlier MerchantPays. Run only from a clean, committed tree; then export-abi.sh.
contract DeployPhase3 is Script {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    address constant FEE_RECIPIENT = 0xdd02FE971Ad9e21365673E701693e7ab7bF9a651; // relayer hot wallet (human 23:40)
    uint64 constant LOCK_WINDOW = 60; // testnet, so maturity shows live; production 1 day (README)
    uint64 constant KYC_VALIDITY = 30 days; // simulated KYC (SRS §7)
    MerchantPay constant PHASE2_MERCHANT_PAY = MerchantPay(0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7);
    // First Phase 3 deploy (round 1, replaced after the ClaimToken H1 fix).
    MerchantPay constant ROUND1_MERCHANT_PAY = MerchantPay(0x8EFFc3e20E99af309CB367e33716b1E7cA71248F);
    address constant DEMO_INVESTOR_A = 0xC2362c3693E185388E5745BadaffAC38184C6752;
    address constant DEMO_INVESTOR_B = 0xaf747912b20D4fE6df1B88D4993FccBc7002771B;

    function run()
        external
        returns (InvestorRegistry registry, ClaimToken claims, MerchantPay merchantPay, CapitalMarket market)
    {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(key);
        uint64 kycUntil = uint64(block.timestamp) + KYC_VALIDITY;
        vm.startBroadcast(key);
        registry = new InvestorRegistry(admin);
        claims = new ClaimToken(IInvestorRegistry(address(registry)), admin, LOCK_WINDOW);
        merchantPay = new MerchantPay(USDT, FEE_RECIPIENT);
        market = new CapitalMarket(address(merchantPay), claims, USDT);
        claims.setMarket(address(market));
        merchantPay.setMarket(ICapitalMarket(address(market)));
        registry.setEligible(DEMO_INVESTOR_A, kycUntil);
        registry.setEligible(DEMO_INVESTOR_B, kycUntil);
        if (!PHASE2_MERCHANT_PAY.paused()) PHASE2_MERCHANT_PAY.pause(); // stale signatures can't pay the old ones
        if (!ROUND1_MERCHANT_PAY.paused()) ROUND1_MERCHANT_PAY.pause();
        vm.stopBroadcast();
    }
}
