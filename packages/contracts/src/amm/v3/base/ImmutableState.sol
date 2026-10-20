// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/swap-router-contracts/contracts/base/ImmutableState.sol for MetaSwap
pragma solidity ^0.8.26;

import '../interfaces/IImmutableState.sol';

/// @title Immutable state
/// @notice Immutable state used by the swap router
abstract contract ImmutableState is IImmutableState {
    /// @inheritdoc IImmutableState
    address public immutable override factoryV2;
    /// @inheritdoc IImmutableState
    address public immutable override positionManager;

    constructor(address _factoryV2, address _positionManager) {
        factoryV2 = _factoryV2;
        positionManager = _positionManager;
    }
}
