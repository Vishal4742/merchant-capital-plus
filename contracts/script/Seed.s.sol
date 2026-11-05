// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script} from "forge-std/Script.sol";

/// RED skeleton for batch 004-P2-seed: targets and types, no behaviour yet.
contract Seed is Script {
    uint256 public constant MERCHANT_USDT = 1e6;
    uint256 public constant MERCHANT_WBT = 0.02 ether;
    uint256 public constant INVESTOR_A_USDT = 69e6;
    uint256 public constant INVESTOR_B_USDT = 40e6;
    uint256 public constant DEBTOR_USDT = 100e6;
    uint256 public constant CUSTOMER_USDT = 56e6;

    struct Target {
        address wallet;
        uint256 usdt;
        uint256 wbt;
    }

    error TeamWalletShort(uint256 usdtShort, uint256 wbtShort);

    function shortfall(Target[] memory) public view returns (uint256, uint256) {}

    function transferDigest(address, address, uint256, uint256, bytes32) public view returns (bytes32) {}

    function _fund(uint256, Target[] memory) internal {}

    function _reclaim(uint256, uint256[] memory) internal {}
}
