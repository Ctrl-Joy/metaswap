// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from Uniswap/v3-periphery/contracts/base/PeripheryValidation.sol for MetaSwap
pragma solidity ^0.8.26;

import './BlockTimestamp.sol';

abstract contract PeripheryValidation is BlockTimestamp {
    modifier checkDeadline(uint256 deadline) {
        require(_blockTimestamp() <= deadline, 'Transaction too old');
        _;
    }
}
