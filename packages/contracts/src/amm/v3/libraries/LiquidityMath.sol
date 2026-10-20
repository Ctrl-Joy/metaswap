// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-core/contracts/libraries/LiquidityMath.sol (main branch) for MetaSwap.
// Changes: Solidity 0.8 - wrapping arithmetic made explicit with `unchecked`, and int128.min handled without
// overflowing on negation. (The 0.8 pool inlines this logic; the library is kept for periphery/tests.)
pragma solidity ^0.8.26;

/// @title Math library for liquidity
library LiquidityMath {
    /// @notice Add a signed liquidity delta to liquidity and revert if it overflows or underflows
    /// @param x The liquidity before change
    /// @param y The delta by which liquidity should be changed
    /// @return z The liquidity delta
    function addDelta(uint128 x, int128 y) internal pure returns (uint128 z) {
        unchecked {
            if (y < 0) {
                uint128 sub = uint128(-(y + 1)) + 1;
                require((z = x - sub) < x, 'LS');
            } else {
                require((z = x + uint128(y)) >= x, 'LA');
            }
        }
    }
}
