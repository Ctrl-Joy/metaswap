// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;
// Ported from Uniswap/universal-router/contracts/base/RouterImmutables.sol (+ UniswapImmutables, PaymentsImmutables) for MetaSwap

import {IPermit2} from "../../permit2/interfaces/IPermit2.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";

/// @notice Constructor parameters of the MetaSwap UniversalRouter
struct RouterParameters {
    address permit2;
    address weth9;
    address v2Factory;
    address v3Factory;
}

/// @title Router Immutable Storage contract
/// @notice Used along with the `RouterParameters` struct for ease of cross-chain deployment
/// @dev MetaSwap: pools and pairs are looked up through the factories (`getPool` / `getPair`)
///  instead of CREATE2 init-code-hash math, so redeploying AMM bytecode never breaks routing.
contract RouterImmutables {
    /// @notice WETH9 address
    IWETH9 public immutable WETH9;

    /// @notice Permit2 address
    IPermit2 public immutable PERMIT2;

    /// @notice The MetaSwap V2 factory
    address public immutable V2_FACTORY;

    /// @notice The MetaSwap V3 factory
    address public immutable V3_FACTORY;

    constructor(RouterParameters memory params) {
        PERMIT2 = IPermit2(params.permit2);
        WETH9 = IWETH9(params.weth9);
        V2_FACTORY = params.v2Factory;
        V3_FACTORY = params.v3Factory;
    }
}
