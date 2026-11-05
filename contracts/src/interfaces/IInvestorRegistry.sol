// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Investor eligibility (SRS FR-KYC-1): an owner-managed list with an expiry per investor.
interface IInvestorRegistry {
    event EligibilitySet(address indexed investor, uint64 expiry);

    /// @notice True while `investor` is on the list and its expiry is in the future. Never reverts.
    function isEligible(address investor) external view returns (bool);

    /// @notice Owner only. `expiry == 0` removes the investor.
    function setEligible(address investor, uint64 expiry) external;
}
