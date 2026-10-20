// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-periphery/contracts/libraries/CallbackValidation.sol for MetaSwap
// Changes: the expected pool is resolved through `factory.getPool` (see PoolAddress) and the callback is only
// accepted when `msg.sender == pool`.
pragma solidity ^0.8.26;

import '../interfaces/IMetaSwapV3Pool.sol';
import '../interfaces/IMetaSwapV3Factory.sol';
import './PoolAddress.sol';

/// @notice Provides validation for callbacks from MetaSwap V3 Pools
library CallbackValidation {
    /// @notice Returns the address of a valid MetaSwap V3 Pool
    /// @param factory The contract address of the MetaSwap V3 factory
    /// @param tokenA The contract address of either token0 or token1
    /// @param tokenB The contract address of the other token
    /// @param fee The fee collected upon every swap in the pool, denominated in hundredths of a bip
    /// @return pool The V3 pool contract address
    function verifyCallback(
        address factory,
        address tokenA,
        address tokenB,
        uint24 fee
    ) internal view returns (IMetaSwapV3Pool pool) {
        return verifyCallback(factory, PoolAddress.getPoolKey(tokenA, tokenB, fee));
    }

    /// @notice Returns the address of a valid MetaSwap V3 Pool
    /// @param factory The contract address of the MetaSwap V3 factory
    /// @param poolKey The identifying key of the V3 pool
    /// @return pool The V3 pool contract address
    function verifyCallback(address factory, PoolAddress.PoolKey memory poolKey)
        internal
        view
        returns (IMetaSwapV3Pool pool)
    {
        pool = IMetaSwapV3Pool(IMetaSwapV3Factory(factory).getPool(poolKey.token0, poolKey.token1, poolKey.fee));
        require(address(pool) != address(0) && msg.sender == address(pool));
    }
}
