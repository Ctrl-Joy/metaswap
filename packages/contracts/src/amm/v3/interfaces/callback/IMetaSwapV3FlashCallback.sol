// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol for MetaSwap
pragma solidity ^0.8.26;

/// @title Callback for IMetaSwapV3PoolActions#flash
/// @notice Any contract that calls IMetaSwapV3PoolActions#flash must implement this interface
interface IMetaSwapV3FlashCallback {
    /// @notice Called to `msg.sender` after transferring to the recipient from IMetaSwapV3Pool#flash.
    /// @dev In the implementation you must repay the pool the tokens sent by flash plus the computed fee amounts.
    /// The caller of this method must be checked to be a MetaSwapV3Pool deployed by the canonical MetaSwapV3Factory.
    /// @param fee0 The fee amount in token0 due to the pool by the end of the flash
    /// @param fee1 The fee amount in token1 due to the pool by the end of the flash
    /// @param data Any data passed through by the caller via the IMetaSwapV3PoolActions#flash call
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external;
}
