// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-periphery/contracts/base/PoolInitializer.sol for MetaSwap
pragma solidity ^0.8.26;

import '../interfaces/IMetaSwapV3Factory.sol';
import '../interfaces/IMetaSwapV3Pool.sol';

import './PeripheryImmutableState.sol';
import '../interfaces/IPoolInitializer.sol';

/// @title Creates and initializes V3 Pools
abstract contract PoolInitializer is IPoolInitializer, PeripheryImmutableState {
    /// @inheritdoc IPoolInitializer
    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable override returns (address pool) {
        require(token0 < token1);
        pool = IMetaSwapV3Factory(factory).getPool(token0, token1, fee);

        if (pool == address(0)) {
            pool = IMetaSwapV3Factory(factory).createPool(token0, token1, fee);
            IMetaSwapV3Pool(pool).initialize(sqrtPriceX96);
        } else {
            (uint160 sqrtPriceX96Existing, , , , , , ) = IMetaSwapV3Pool(pool).slot0();
            if (sqrtPriceX96Existing == 0) {
                IMetaSwapV3Pool(pool).initialize(sqrtPriceX96);
            }
        }
    }
}
