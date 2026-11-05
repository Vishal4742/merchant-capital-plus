// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {MerchantPay} from "../src/MerchantPay.sol";
import {CapitalMarket} from "../src/CapitalMarket.sol";
import {IERC7943MultiToken} from "../src/ClaimToken.sol";
import {IClaimToken} from "../src/interfaces/IClaimToken.sol";
import {IInvestorRegistry} from "../src/interfaces/IInvestorRegistry.sol";

/// @notice E1 (SRS NFR-10): the event ABI frozen at G3. The web and relayer lanes decode these topics from logs, so a
///         changed signature must fail here before it silently breaks their parsing.
contract EventAbiSnapshotTest is Test {
    function test_MerchantPayEventTopicsAreFrozen() public pure {
        assertEq(
            MerchantPay.InvoiceCreated.selector,
            keccak256("InvoiceCreated(uint256,address,address,uint256,uint64,bytes32)")
        );
        assertEq(MerchantPay.InvoiceCancelled.selector, keccak256("InvoiceCancelled(uint256)"));
        assertEq(
            MerchantPay.Paid.selector,
            keccak256("Paid(uint256,address,address,uint256,bytes32,uint256,uint256,uint256,uint256)")
        );
        assertEq(MerchantPay.Refunded.selector, keccak256("Refunded(uint256,uint256,uint256)"));
        assertEq(MerchantPay.RelayFeeSet.selector, keccak256("RelayFeeSet(uint256,address)"));
        assertEq(MerchantPay.MarketSet.selector, keccak256("MarketSet(address)"));
        assertEq(MerchantPay.Swept.selector, keccak256("Swept(address,uint256)"));
    }

    function test_CapitalMarketEventTopicsAreFrozen() public pure {
        assertEq(
            CapitalMarket.OfferListed.selector,
            keccak256("OfferListed(uint256,address,uint8,uint256,uint256,uint256,uint16,uint64,uint64)")
        );
        assertEq(CapitalMarket.OfferCancelled.selector, keccak256("OfferCancelled(uint256)"));
        assertEq(CapitalMarket.Funded.selector, keccak256("Funded(uint256,address,uint256,uint256)"));
        assertEq(CapitalMarket.Distributed.selector, keccak256("Distributed(uint256,uint256,uint256,uint256)"));
        assertEq(CapitalMarket.LienAdded.selector, keccak256("LienAdded(address,uint256,uint16)"));
        assertEq(CapitalMarket.Settled.selector, keccak256("Settled(uint256)"));
        assertEq(CapitalMarket.PushFailed.selector, keccak256("PushFailed(uint256,address,uint256)"));
        assertEq(CapitalMarket.OwedWithdrawn.selector, keccak256("OwedWithdrawn(address,uint256)"));
    }

    function test_ClaimTokenAndRegistryEventTopicsAreFrozen() public pure {
        assertEq(IClaimToken.ClaimStateSet.selector, keccak256("ClaimStateSet(uint256,uint64,bool)"));
        assertEq(
            IERC7943MultiToken.ForcedTransfer.selector,
            0xa7f01abbf5b7ec7bac7fb74feb5c1f54af9e430f18a33681c1b9149875339a45 // ERC-7943 (contracts_prep §1)
        );
        assertEq(IERC7943MultiToken.Frozen.selector, 0x7b0c29e799ed468266b4d070c03070137a95cb869c5eb7c18063fb7b1a7a09c5);
        assertEq(IInvestorRegistry.EligibilitySet.selector, keccak256("EligibilitySet(address,uint64)"));
    }
}
