// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/swap-router-contracts/contracts/interfaces/ISwapRouter02.sol for MetaSwap
pragma solidity ^0.8.26;
pragma abicoder v2;

import '../interfaces/ISelfPermit.sol';

import './IV2SwapRouter.sol';
import './IV3SwapRouter.sol';
import './IMulticallExtended.sol';

/// @title Router token swapping functionality
interface ISwapRouter02 is IV2SwapRouter, IV3SwapRouter, IMulticallExtended, ISelfPermit {

}
