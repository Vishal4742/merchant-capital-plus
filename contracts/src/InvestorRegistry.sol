// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IInvestorRegistry} from "./interfaces/IInvestorRegistry.sol";

/// @title InvestorRegistry: who may hold and trade claims
/// @notice The compliance admin lists each investor with an expiry; ClaimToken asks `isEligible` on every mint and
///         transfer, so a revocation applies at once. (SRS FR-KYC-1)
/// @dev ponytail: owner list only; EAS attestations (FR-KYC-2/3) come in a later phase behind the same `isEligible`.
contract InvestorRegistry is IInvestorRegistry, Ownable {
    mapping(address investor => uint64 expiry) public expiryOf;

    error ZeroAddress();

    constructor(address owner_) Ownable(owner_) {}

    /// @inheritdoc IInvestorRegistry
    function isEligible(address investor) external view returns (bool) {
        // forge-lint: disable-next-line(block-timestamp) KYC expiries are days away; seconds of drift don't matter
        return expiryOf[investor] > block.timestamp;
    }

    /// @inheritdoc IInvestorRegistry
    function setEligible(address investor, uint64 expiry) external onlyOwner {
        if (investor == address(0)) revert ZeroAddress();
        expiryOf[investor] = expiry;
        emit EligibilitySet(investor, expiry);
    }
}
