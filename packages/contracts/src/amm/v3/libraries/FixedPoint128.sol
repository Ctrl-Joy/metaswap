// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-core/contracts/libraries/FixedPoint128.sol for MetaSwap
pragma solidity ^0.8.26;

/// @title FixedPoint128
/// @notice A library for handling binary fixed point numbers, see https://en.wikipedia.org/wiki/Q_(number_format)
library FixedPoint128 {
    uint256 internal constant Q128 = 0x100000000000000000000000000000000;
}
