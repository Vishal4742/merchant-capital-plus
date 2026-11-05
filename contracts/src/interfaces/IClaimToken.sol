// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice What CapitalMarket needs from ClaimToken (ERC-1155 claim ids; 1 unit = 0.000001 USDT owed to the holder).
interface IClaimToken {
    event ClaimStateSet(uint256 indexed id, uint64 lockFrom, bool frozen);

    /// @notice Market only. Respects the receiver's eligibility and the 8-holder cap.
    function mint(address to, uint256 id, uint256 amount) external;

    /// @notice Market only. Never blocked (settlement must always go through); lowers frozen amounts first if needed.
    function burn(address from, uint256 id, uint256 amount) external;

    /// @notice Market only. Transfers revert from `lockFrom` (0 = no lock) and while `frozen`.
    function setClaimState(uint256 id, uint64 lockFrom, bool frozen) external;

    /// @notice Current holders of `id` with a non-zero balance (at most 8).
    function holdersOf(uint256 id) external view returns (address[] memory);

    function totalSupply(uint256 id) external view returns (uint256);

    function balanceOf(address account, uint256 id) external view returns (uint256);

    function LOCK_WINDOW() external view returns (uint64);
}
