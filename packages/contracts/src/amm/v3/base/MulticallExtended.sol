// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/swap-router-contracts/contracts/base/MulticallExtended.sol for MetaSwap
pragma solidity ^0.8.26;
pragma abicoder v2;

import '../base/Multicall.sol';

import '../interfaces/IMulticallExtended.sol';
import '../base/PeripheryValidationExtended.sol';

/// @title Multicall
/// @notice Enables calling multiple methods in a single call to the contract
abstract contract MulticallExtended is IMulticallExtended, Multicall, PeripheryValidationExtended {
    /// @inheritdoc IMulticallExtended
    function multicall(uint256 deadline, bytes[] calldata data)
        external
        payable
        override
        checkDeadline(deadline)
        returns (bytes[] memory)
    {
        return multicall(data);
    }

    /// @inheritdoc IMulticallExtended
    function multicall(bytes32 previousBlockhash, bytes[] calldata data)
        external
        payable
        override
        checkPreviousBlockhash(previousBlockhash)
        returns (bytes[] memory)
    {
        return multicall(data);
    }
}
