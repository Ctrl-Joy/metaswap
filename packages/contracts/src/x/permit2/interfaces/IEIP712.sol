// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// Ported from Uniswap/permit2/src/interfaces/IEIP712.sol for MetaSwap

interface IEIP712 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
