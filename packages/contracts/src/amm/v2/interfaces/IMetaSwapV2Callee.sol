// SPDX-License-Identifier: GPL-3.0
// Ported from Uniswap/v2-core/contracts/interfaces/IUniswapV2Callee.sol for MetaSwap.
// The callback keeps its original name `uniswapV2Call` so existing flash-swap tooling works unchanged.
pragma solidity >=0.8.0;

interface IMetaSwapV2Callee {
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}
