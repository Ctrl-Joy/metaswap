// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;
// Ported from Uniswap/universal-router/contracts/UniversalRouter.sol for MetaSwap

import {Dispatcher} from "./base/Dispatcher.sol";
import {RouterParameters, RouterImmutables} from "./base/RouterImmutables.sol";
import {Commands} from "./libraries/Commands.sol";
import {IMetaSwapUniversalRouter} from "./interfaces/IMetaSwapUniversalRouter.sol";

/// @title MetaSwap UniversalRouter
/// @notice Command-based router for MetaSwap V2 + V3 liquidity. Users approve Permit2 once per token and then
///  sign a Permit2 `PermitSingle` (command PERMIT2_PERMIT) per swap; the router pulls input tokens via
///  Permit2 `transferFrom` on behalf of `msg.sender` (payerIsUser = true) or spends router-held funds.
contract MetaSwapUniversalRouter is IMetaSwapUniversalRouter, Dispatcher {
    constructor(address permit2, address weth9, address v2Factory, address v3Factory)
        RouterImmutables(RouterParameters({permit2: permit2, weth9: weth9, v2Factory: v2Factory, v3Factory: v3Factory}))
    {}

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert TransactionDeadlinePassed();
        _;
    }

    /// @notice To receive ETH from WETH (unwrap)
    receive() external payable {
        if (msg.sender != address(WETH9)) revert InvalidEthSender();
    }

    /// @inheritdoc IMetaSwapUniversalRouter
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable
        checkDeadline(deadline)
    {
        execute(commands, inputs);
    }

    /// @inheritdoc Dispatcher
    function execute(bytes calldata commands, bytes[] calldata inputs)
        public
        payable
        override(Dispatcher, IMetaSwapUniversalRouter)
        isNotLocked
    {
        bool success;
        bytes memory output;
        uint256 numCommands = commands.length;
        if (inputs.length != numCommands) revert LengthMismatch();

        // loop through all given commands, execute them and pass along outputs as defined
        for (uint256 commandIndex = 0; commandIndex < numCommands; commandIndex++) {
            bytes1 command = commands[commandIndex];

            bytes calldata input = inputs[commandIndex];

            (success, output) = dispatch(command, input);

            if (!success && successRequired(command)) {
                revert ExecutionFailed({commandIndex: commandIndex, message: output});
            }
        }
    }

    function successRequired(bytes1 command) internal pure returns (bool) {
        return command & Commands.FLAG_ALLOW_REVERT == 0;
    }
}
