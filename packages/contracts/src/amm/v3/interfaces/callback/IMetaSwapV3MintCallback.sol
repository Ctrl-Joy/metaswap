// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-core/contracts/interfaces/callback/IUniswapV3MintCallback.sol for MetaSwap
pragma solidity ^0.8.26;

/// @title Callback for IMetaSwapV3PoolActions#mint
/// @notice Any contract that calls IMetaSwapV3PoolActions#mint must implement this interface
interface IMetaSwapV3MintCallback {
    /// @notice Called to `msg.sender` after minting liquidity to a position from IMetaSwapV3Pool#mint.
    /// @dev In the implementation you must pay the pool tokens owed for the minted liquidity.
    /// The caller of this method must be checked to be a MetaSwapV3Pool deployed by the canonical MetaSwapV3Factory.
    /// @param amount0Owed The amount of token0 due to the pool for the minted liquidity
    /// @param amount1Owed The amount of token1 due to the pool for the minted liquidity
    /// @param data Any data passed through by the caller via the IMetaSwapV3PoolActions#mint call
    function uniswapV3MintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata data
    ) external;
}
