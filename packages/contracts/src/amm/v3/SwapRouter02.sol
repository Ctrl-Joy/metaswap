// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/swap-router-contracts/contracts/SwapRouter02.sol for MetaSwap
pragma solidity ^0.8.26;
pragma abicoder v2;

import './base/SelfPermit.sol';
import './base/PeripheryImmutableState.sol';

import './interfaces/ISwapRouter02.sol';
import './V2SwapRouter.sol';
import './V3SwapRouter.sol';
import './base/MulticallExtended.sol';

/// @title MetaSwap V2 and V3 Swap Router (SwapRouter02 surface without ApproveAndCall)
contract SwapRouter02 is ISwapRouter02, V2SwapRouter, V3SwapRouter, MulticallExtended, SelfPermit {
    constructor(
        address _factoryV2,
        address factoryV3,
        address _positionManager,
        address _WETH9
    ) ImmutableState(_factoryV2, _positionManager) PeripheryImmutableState(factoryV3, _WETH9) {}
}
