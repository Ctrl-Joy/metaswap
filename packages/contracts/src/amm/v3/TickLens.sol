// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-periphery/contracts/lens/TickLens.sol for MetaSwap
pragma solidity ^0.8.26;
pragma abicoder v2;

import './interfaces/IMetaSwapV3Pool.sol';

import './interfaces/ITickLens.sol';

/// @title Tick Lens contract
contract TickLens is ITickLens {
    /// @inheritdoc ITickLens
    function getPopulatedTicksInWord(address pool, int16 tickBitmapIndex)
        public
        view
        override
        returns (PopulatedTick[] memory populatedTicks)
    {
        // fetch bitmap
        uint256 bitmap = IMetaSwapV3Pool(pool).tickBitmap(tickBitmapIndex);
        unchecked {
            // calculate the number of populated ticks
            uint256 numberOfPopulatedTicks;
            for (uint256 i = 0; i < 256; i++) {
                if (bitmap & (1 << i) > 0) numberOfPopulatedTicks++;
            }

            // fetch populated tick data
            int24 tickSpacing = IMetaSwapV3Pool(pool).tickSpacing();
            populatedTicks = new PopulatedTick[](numberOfPopulatedTicks);
            for (uint256 i = 0; i < 256; i++) {
                if (bitmap & (1 << i) > 0) {
                    int24 populatedTick = ((int24(tickBitmapIndex) << 8) + int24(uint24(i))) * tickSpacing;
                    (uint128 liquidityGross, int128 liquidityNet, , , , , , ) = IMetaSwapV3Pool(pool).ticks(
                        populatedTick
                    );
                    populatedTicks[--numberOfPopulatedTicks] = PopulatedTick({
                        tick: populatedTick,
                        liquidityNet: liquidityNet,
                        liquidityGross: liquidityGross
                    });
                }
            }
        }
    }
}
