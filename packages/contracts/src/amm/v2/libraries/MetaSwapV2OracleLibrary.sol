// SPDX-License-Identifier: GPL-3.0
// Ported from Uniswap/v2-periphery/contracts/libraries/UniswapV2OracleLibrary.sol for MetaSwap.
// Changes: Solidity 0.8 with `unchecked` wrapping where the original relied on overflow; FixedPoint.fraction
// replaced by the equivalent UQ112x112 encode/uqdiv used by the pair itself.
pragma solidity ^0.8.0;

import {IMetaSwapV2Pair} from "../interfaces/IMetaSwapV2Pair.sol";
import {UQ112x112} from "./UQ112x112.sol";

// library with helper methods for oracles that are concerned with computing average prices
library MetaSwapV2OracleLibrary {
    using UQ112x112 for uint224;

    // helper function that returns the current block timestamp within the range of uint32, i.e. [0, 2**32 - 1]
    function currentBlockTimestamp() internal view returns (uint32) {
        return uint32(block.timestamp % 2 ** 32);
    }

    // produces the cumulative price using counterfactuals to save gas and avoid a call to sync.
    function currentCumulativePrices(address pair)
        internal
        view
        returns (uint256 price0Cumulative, uint256 price1Cumulative, uint32 blockTimestamp)
    {
        blockTimestamp = currentBlockTimestamp();
        price0Cumulative = IMetaSwapV2Pair(pair).price0CumulativeLast();
        price1Cumulative = IMetaSwapV2Pair(pair).price1CumulativeLast();

        // if time has elapsed since the last update on the pair, mock the accumulated price values
        (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) = IMetaSwapV2Pair(pair).getReserves();
        if (blockTimestampLast != blockTimestamp) {
            unchecked {
                // subtraction overflow is desired
                uint32 timeElapsed = blockTimestamp - blockTimestampLast;
                // addition overflow is desired
                // counterfactual
                price0Cumulative += uint256(UQ112x112.encode(reserve1).uqdiv(reserve0)) * timeElapsed;
                // counterfactual
                price1Cumulative += uint256(UQ112x112.encode(reserve0).uqdiv(reserve1)) * timeElapsed;
            }
        }
    }
}
