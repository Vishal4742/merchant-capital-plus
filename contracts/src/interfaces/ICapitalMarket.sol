// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice What MerchantPay needs from CapitalMarket.
interface ICapitalMarket {
    /// @notice MerchantPay only, after it has transferred `net` to the market: pays the financed invoice's holders
    ///         first, then the merchant's advance lien, then the rest to the merchant. Returns what went to holders.
    function onPayment(address merchant, uint256 invoiceId, uint256 gross, uint256 net, uint256 paymentId)
        external
        returns (uint256 toInvestors);

    /// @notice True if a payment to `merchant` (for `invoiceId`, 0 for a sale) owes anything to claim holders.
    function hasClaimsOn(address merchant, uint256 invoiceId) external view returns (bool);

    /// @notice True once an invoice's claim has been funded (it can no longer be cancelled).
    function isFinanced(uint256 invoiceId) external view returns (bool);
}
