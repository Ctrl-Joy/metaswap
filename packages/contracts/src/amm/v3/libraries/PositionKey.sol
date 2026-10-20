// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-periphery/contracts/libraries/PositionKey.sol for MetaSwap
pragma solidity ^0.8.26;

library PositionKey {
    /// @dev Returns the key of the position in the core library
    function compute(
        address owner,
        int24 tickLower,
        int24 tickUpper
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner, tickLower, tickUpper));
    }
}
