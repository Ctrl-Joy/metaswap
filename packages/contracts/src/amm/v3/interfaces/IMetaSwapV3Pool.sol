// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol for MetaSwap
pragma solidity ^0.8.26;

import {IMetaSwapV3PoolImmutables} from './pool/IMetaSwapV3PoolImmutables.sol';
import {IMetaSwapV3PoolState} from './pool/IMetaSwapV3PoolState.sol';
import {IMetaSwapV3PoolDerivedState} from './pool/IMetaSwapV3PoolDerivedState.sol';
import {IMetaSwapV3PoolActions} from './pool/IMetaSwapV3PoolActions.sol';
import {IMetaSwapV3PoolOwnerActions} from './pool/IMetaSwapV3PoolOwnerActions.sol';
import {IMetaSwapV3PoolErrors} from './pool/IMetaSwapV3PoolErrors.sol';
import {IMetaSwapV3PoolEvents} from './pool/IMetaSwapV3PoolEvents.sol';

/// @title The interface for a MetaSwap V3 Pool
/// @notice A Uniswap pool facilitates swapping and automated market making between any two assets that strictly conform
/// to the ERC20 specification
/// @dev The pool interface is broken up into many smaller pieces
interface IMetaSwapV3Pool is
    IMetaSwapV3PoolImmutables,
    IMetaSwapV3PoolState,
    IMetaSwapV3PoolDerivedState,
    IMetaSwapV3PoolActions,
    IMetaSwapV3PoolOwnerActions,
    IMetaSwapV3PoolErrors,
    IMetaSwapV3PoolEvents
{

}
