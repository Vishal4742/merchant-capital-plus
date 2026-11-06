// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC3009} from "@openzeppelin/contracts/interfaces/draft-IERC3009.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Demo seed script (SRS CON-8): tops the demo wallets up from the team wallet and reclaims their USDT
///         between demo runs (G5). Deployer key only: script wallets sign, the deployer submits, so the payers never
///         need WBT (CON-4). Keys come from .env and are never logged.
///         fund:    forge script script/Seed.s.sol --sig "fund()"    --rpc-url whitechain [--broadcast]
///         reclaim: forge script script/Seed.s.sol --sig "reclaim()" --rpc-url whitechain [--broadcast]
///         CUSTOMER=<browser guest wallet> is required for fund(): in UI runs it pays AT-1/AT-4/AT-5/AT-7 (batch 009, Q5).
///         It is never reclaimed (its key lives in the browser).
contract Seed is Script {
    IERC20 constant USDT = IERC20(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    bytes32 constant TRANSFER_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint256 constant WINDOW = 15 minutes;

    // ÷100 demo amounts (human 23:58); AT-1/AT-2 keep their 25 USDT sale.
    uint256 public constant MERCHANT_USDT = 1e6; // the 0.10 fee when AT-2 refunds AT-1's full 25
    uint256 public constant MERCHANT_WBT = 0.02 ether; // its own txs: createInvoice, listAdvance, approve, refund
    uint256 public constant INVESTOR_A_USDT = 69e6; // AT-3 advance 10 + AT-6 share of 60 face (≈ 58.84)
    uint256 public constant INVESTOR_B_USDT = 40e6; // AT-6 share of 40 face (≈ 39.23)
    uint256 public constant DEBTOR_USDT = 0; // batch 009 (Q5): /pay signs with the browser guest, so the guest pays AT-7
    // AT-4 5 + AT-5 ≈ 50 + 1, then AT-7's 100 invoice + 0.10 fee; AT-1's 25 is refunded in AT-2.
    // INVESTOR_A_USDT stays 69: the pack's 58 needs the advance to repay 11 before AT-6 (a 0.16 margin).
    uint256 public constant CUSTOMER_USDT = 156_100_000;

    struct Target {
        address wallet;
        uint256 usdt;
        uint256 wbt;
    }

    error TeamWalletShort(uint256 usdtShort, uint256 wbtShort);
    /// @notice fund() needs CUSTOMER, the browser guest wallet that pays in UI runs.
    error CustomerRequired();
    /// @notice CUSTOMER is the team wallet or a script wallet (the team's would go unfunded; a script one is reclaimed).
    error CustomerIsAScriptWallet();

    function fund() external {
        _fund(vm.envUint("DEPLOYER_PRIVATE_KEY"), _demoTargets());
    }

    function reclaim() external {
        _reclaim(vm.envUint("DEPLOYER_PRIVATE_KEY"), _scriptWalletKeys());
    }

    /// @notice USDT and WBT still missing to bring every target up to its amount (wallets above target count as 0).
    function shortfall(Target[] memory t) public view returns (uint256 usdt, uint256 wbt) {
        for (uint256 i; i < t.length; ++i) {
            uint256 usdtHeld = USDT.balanceOf(t[i].wallet);
            uint256 wbtHeld = t[i].wallet.balance;
            if (usdtHeld < t[i].usdt) usdt += t[i].usdt - usdtHeld;
            if (wbtHeld < t[i].wbt) wbt += t[i].wbt - wbtHeld;
        }
    }

    /// @notice EIP-712 digest of the USDT TransferWithAuthorization a script wallet signs for reclaim.
    function transferDigest(address from, address to, uint256 value, uint256 validBefore, bytes32 nonce)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(TRANSFER_TYPEHASH, from, to, value, 0, validBefore, nonce));
        return MessageHashUtils.toTypedDataHash(IERC20Permit(address(USDT)).DOMAIN_SEPARATOR(), structHash);
    }

    /// @dev Checks the whole shortfall first, so a short team wallet moves nothing; then tops up, never above target.
    function _fund(uint256 deployerKey, Target[] memory t) internal {
        address team = vm.addr(deployerKey);
        (uint256 usdtNeed, uint256 wbtNeed) = shortfall(t);
        uint256 usdtHave = USDT.balanceOf(team);
        uint256 wbtHave = team.balance;
        if (usdtHave < usdtNeed || wbtHave < wbtNeed) {
            revert TeamWalletShort(
                usdtHave < usdtNeed ? usdtNeed - usdtHave : 0, wbtHave < wbtNeed ? wbtNeed - wbtHave : 0
            );
        }
        vm.startBroadcast(deployerKey);
        for (uint256 i; i < t.length; ++i) {
            uint256 usdtHeld = USDT.balanceOf(t[i].wallet);
            uint256 wbtHeld = t[i].wallet.balance;
            if (usdtHeld < t[i].usdt) {
                require(USDT.transfer(t[i].wallet, t[i].usdt - usdtHeld), "USDT transfer failed");
            }
            if (wbtHeld < t[i].wbt) {
                (bool sent,) = payable(t[i].wallet).call{value: t[i].wbt - wbtHeld}("");
                require(sent, "WBT transfer failed");
            }
        }
        vm.stopBroadcast();
        for (uint256 i; i < t.length; ++i) {
            console.log(t[i].wallet, USDT.balanceOf(t[i].wallet), t[i].wallet.balance);
        }
    }

    /// @dev Each wallet signs its whole balance over to the team wallet; the deployer submits, so the wallet spends no gas.
    function _reclaim(uint256 deployerKey, uint256[] memory walletKeys) internal {
        address team = vm.addr(deployerKey);
        uint256 validBefore = block.timestamp + WINDOW;
        for (uint256 i; i < walletKeys.length; ++i) {
            address from = vm.addr(walletKeys[i]);
            uint256 balance = USDT.balanceOf(from);
            if (balance == 0) continue;
            bytes32 nonce = keccak256(abi.encode("mcplus.seed.reclaim", from, block.timestamp, balance));
            (uint8 v, bytes32 r, bytes32 s) =
                vm.sign(walletKeys[i], transferDigest(from, team, balance, validBefore, nonce));
            vm.broadcast(deployerKey);
            IERC3009(address(USDT)).transferWithAuthorization(from, team, balance, 0, validBefore, nonce, v, r, s);
        }
    }

    function _demoTargets() internal view returns (Target[] memory t) {
        address customer = vm.envOr("CUSTOMER", address(0));
        if (customer == address(0)) revert CustomerRequired();
        if (customer == vm.addr(vm.envUint("DEPLOYER_PRIVATE_KEY"))) revert CustomerIsAScriptWallet();
        uint256[] memory scriptKeys = _scriptWalletKeys();
        for (uint256 i; i < scriptKeys.length; ++i) {
            if (customer == vm.addr(scriptKeys[i])) revert CustomerIsAScriptWallet();
        }
        t = new Target[](5);
        t[0] = Target(_walletOf("DEMO_MERCHANT_PRIVATE_KEY"), MERCHANT_USDT, MERCHANT_WBT);
        t[1] = Target(_walletOf("DEMO_INVESTOR_A_PRIVATE_KEY"), INVESTOR_A_USDT, 0);
        t[2] = Target(_walletOf("DEMO_INVESTOR_B_PRIVATE_KEY"), INVESTOR_B_USDT, 0);
        t[3] = Target(_walletOf("DEMO_DEBTOR_PRIVATE_KEY"), DEBTOR_USDT, 0);
        t[4] = Target(customer, CUSTOMER_USDT, 0);
    }

    function _scriptWalletKeys() internal view returns (uint256[] memory k) {
        k = new uint256[](5);
        k[0] = vm.envUint("DEMO_MERCHANT_PRIVATE_KEY");
        k[1] = vm.envUint("DEMO_INVESTOR_A_PRIVATE_KEY");
        k[2] = vm.envUint("DEMO_INVESTOR_B_PRIVATE_KEY");
        k[3] = vm.envUint("DEMO_DEBTOR_PRIVATE_KEY");
        k[4] = vm.envUint("PAYER_PRIVATE_KEY");
    }

    function _walletOf(string memory keyName) internal view returns (address) {
        return vm.addr(vm.envUint(keyName));
    }
}
