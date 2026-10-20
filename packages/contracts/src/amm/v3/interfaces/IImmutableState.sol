// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/swap-router-contracts/contracts/interfaces/IImmutableState.sol for MetaSwap
pragma solidity ^0.8.26;

/// @title Immutable state
/// @notice Functions that return immutable state of the router
interface IImmutableState {
    /// @return Returns the address of the MetaSwap V2 factory
    function factoryV2() external view returns (address);

    /// @return Returns the address of MetaSwap V3 NFT position manager
    function positionManager() external view returns (address);
}
