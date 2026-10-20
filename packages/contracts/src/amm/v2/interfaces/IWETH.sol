// SPDX-License-Identifier: GPL-3.0
// Ported from Uniswap/v2-periphery/contracts/interfaces/IWETH.sol for MetaSwap.
pragma solidity >=0.8.0;

interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
    function withdraw(uint256) external;
}
