// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {IMetaSwapV3Factory} from "./interfaces/IMetaSwapV3Factory.sol";
import {IMetaSwapV3Pool} from "./interfaces/IMetaSwapV3Pool.sol";
import {PositionURI} from "./libraries/PositionURI.sol";

/// @title PositionDescriptor
/// @notice Builds the on-chain MetaSwap tokenURI (JSON + SVG) for NonfungiblePositionManager positions.
/// @dev Deployed by the NonfungiblePositionManager constructor (keeps the manager under the 24KB code limit),
///      so it needs no separate deployment or configuration.
contract PositionDescriptor {
    function tokenURI(INonfungiblePositionManager positionManager, uint256 tokenId)
        external
        view
        returns (string memory)
    {
        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            ,
            ,
            ,
        ) = positionManager.positions(tokenId);
        address pool = IMetaSwapV3Factory(positionManager.factory()).getPool(token0, token1, fee);
        (, int24 tickCurrent,,,,,) = IMetaSwapV3Pool(pool).slot0();
        return PositionURI.tokenURI(
            PositionURI.Params({
                tokenId: tokenId,
                pool: pool,
                token0: token0,
                token1: token1,
                fee: fee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                tickCurrent: tickCurrent,
                liquidity: liquidity
            })
        );
    }
}
