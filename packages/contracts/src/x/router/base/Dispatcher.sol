// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;
// Ported from Uniswap/universal-router/contracts/base/Dispatcher.sol for MetaSwap
// Supported commands: see ../libraries/Commands.sol. Input encodings are the classic UniversalRouter ones
// (no trailing minHopPriceX36 array), e.g. V3_SWAP_EXACT_IN = (address,uint256,uint256,bytes,bool).

import {V2SwapRouter} from "../modules/V2SwapRouter.sol";
import {V3SwapRouter} from "../modules/V3SwapRouter.sol";
import {Payments} from "../modules/Payments.sol";
import {BytesLib} from "../libraries/BytesLib.sol";
import {Constants} from "../libraries/Constants.sol";
import {Commands} from "../libraries/Commands.sol";
import {LockAndMsgSender} from "./LockAndMsgSender.sol";
import {IAllowanceTransfer} from "../../permit2/interfaces/IAllowanceTransfer.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";

/// @title Decodes and Executes Commands
/// @notice Called by the MetaSwapUniversalRouter contract to efficiently decode and execute a singular command
abstract contract Dispatcher is V2SwapRouter, V3SwapRouter, LockAndMsgSender {
    using BytesLib for bytes;

    error InvalidCommandType(uint256 commandType);
    error BalanceTooLow();

    /// @notice Executes encoded commands along with provided inputs.
    /// @param commands A set of concatenated commands, each 1 byte in length
    /// @param inputs An array of byte strings containing abi encoded inputs for each command
    function execute(bytes calldata commands, bytes[] calldata inputs) public payable virtual;

    /// @notice Decodes and executes the given command with the given inputs
    /// @param commandType The command type to execute
    /// @param inputs The inputs to execute the command with
    /// @dev 2 masks are used to enable use of a nested-if statement in execution for efficiency reasons
    /// @return success True on success of the command, false on failure
    /// @return output The outputs or error messages, if any, from the command
    function dispatch(bytes1 commandType, bytes calldata inputs) internal returns (bool success, bytes memory output) {
        uint256 command = uint8(commandType & Commands.COMMAND_TYPE_MASK);

        success = true;

        // 0x00 <= command < 0x21
        if (command < Commands.EXECUTE_SUB_PLAN) {
            // 0x00 <= command < 0x08
            if (command < Commands.V2_SWAP_EXACT_IN) {
                if (command == Commands.V3_SWAP_EXACT_IN) {
                    // equivalent: abi.decode(inputs, (address, uint256, uint256, bytes, bool))
                    address recipient;
                    uint256 amountIn;
                    uint256 amountOutMin;
                    bool payerIsUser;
                    assembly {
                        recipient := calldataload(inputs.offset)
                        amountIn := calldataload(add(inputs.offset, 0x20))
                        amountOutMin := calldataload(add(inputs.offset, 0x40))
                        // 0x60 offset is the path, decoded below
                        payerIsUser := calldataload(add(inputs.offset, 0x80))
                    }
                    bytes calldata path = inputs.toBytes(3);
                    address payer = payerIsUser ? msgSender() : address(this);
                    v3SwapExactInput(map(recipient), amountIn, amountOutMin, path, payer);
                } else if (command == Commands.V3_SWAP_EXACT_OUT) {
                    // equivalent: abi.decode(inputs, (address, uint256, uint256, bytes, bool))
                    address recipient;
                    uint256 amountOut;
                    uint256 amountInMax;
                    bool payerIsUser;
                    assembly {
                        recipient := calldataload(inputs.offset)
                        amountOut := calldataload(add(inputs.offset, 0x20))
                        amountInMax := calldataload(add(inputs.offset, 0x40))
                        // 0x60 offset is the path, decoded below
                        payerIsUser := calldataload(add(inputs.offset, 0x80))
                    }
                    bytes calldata path = inputs.toBytes(3);
                    address payer = payerIsUser ? msgSender() : address(this);
                    v3SwapExactOutput(map(recipient), amountOut, amountInMax, path, payer);
                } else if (command == Commands.PERMIT2_TRANSFER_FROM) {
                    // equivalent: abi.decode(inputs, (address, address, uint160))
                    address token;
                    address recipient;
                    uint160 amount;
                    assembly {
                        token := calldataload(inputs.offset)
                        recipient := calldataload(add(inputs.offset, 0x20))
                        amount := calldataload(add(inputs.offset, 0x40))
                    }
                    permit2TransferFrom(token, msgSender(), map(recipient), amount);
                } else if (command == Commands.PERMIT2_PERMIT_BATCH) {
                    (IAllowanceTransfer.PermitBatch memory permitBatch, bytes memory data) =
                        abi.decode(inputs, (IAllowanceTransfer.PermitBatch, bytes));
                    // a reverting permit (e.g. front-run with the same signature) only fails if not allowed to revert
                    (success, output) = address(PERMIT2).call(
                        abi.encodeWithSignature(
                            "permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)",
                            msgSender(),
                            permitBatch,
                            data
                        )
                    );
                } else if (command == Commands.SWEEP) {
                    // equivalent:  abi.decode(inputs, (address, address, uint256))
                    address token;
                    address recipient;
                    uint256 amountMin;
                    assembly {
                        token := calldataload(inputs.offset)
                        recipient := calldataload(add(inputs.offset, 0x20))
                        amountMin := calldataload(add(inputs.offset, 0x40))
                    }
                    Payments.sweep(token, map(recipient), amountMin);
                } else if (command == Commands.TRANSFER) {
                    // equivalent:  abi.decode(inputs, (address, address, uint256))
                    address token;
                    address recipient;
                    uint256 value;
                    assembly {
                        token := calldataload(inputs.offset)
                        recipient := calldataload(add(inputs.offset, 0x20))
                        value := calldataload(add(inputs.offset, 0x40))
                    }
                    Payments.pay(token, map(recipient), value);
                } else if (command == Commands.PAY_PORTION) {
                    // equivalent:  abi.decode(inputs, (address, address, uint256))
                    address token;
                    address recipient;
                    uint256 bips;
                    assembly {
                        token := calldataload(inputs.offset)
                        recipient := calldataload(add(inputs.offset, 0x20))
                        bips := calldataload(add(inputs.offset, 0x40))
                    }
                    Payments.payPortion(token, map(recipient), bips);
                } else {
                    // placeholder area for command 0x07
                    revert InvalidCommandType(command);
                }
            } else {
                // 0x08 <= command < 0x10
                if (command == Commands.V2_SWAP_EXACT_IN) {
                    // equivalent: abi.decode(inputs, (address, uint256, uint256, address[], bool))
                    address recipient;
                    uint256 amountIn;
                    uint256 amountOutMin;
                    bool payerIsUser;
                    assembly {
                        recipient := calldataload(inputs.offset)
                        amountIn := calldataload(add(inputs.offset, 0x20))
                        amountOutMin := calldataload(add(inputs.offset, 0x40))
                        // 0x60 offset is the path, decoded below
                        payerIsUser := calldataload(add(inputs.offset, 0x80))
                    }
                    address[] calldata path = inputs.toAddressArray(3);
                    address payer = payerIsUser ? msgSender() : address(this);
                    v2SwapExactInput(map(recipient), amountIn, amountOutMin, path, payer);
                } else if (command == Commands.V2_SWAP_EXACT_OUT) {
                    // equivalent: abi.decode(inputs, (address, uint256, uint256, address[], bool))
                    address recipient;
                    uint256 amountOut;
                    uint256 amountInMax;
                    bool payerIsUser;
                    assembly {
                        recipient := calldataload(inputs.offset)
                        amountOut := calldataload(add(inputs.offset, 0x20))
                        amountInMax := calldataload(add(inputs.offset, 0x40))
                        // 0x60 offset is the path, decoded below
                        payerIsUser := calldataload(add(inputs.offset, 0x80))
                    }
                    address[] calldata path = inputs.toAddressArray(3);
                    address payer = payerIsUser ? msgSender() : address(this);
                    v2SwapExactOutput(map(recipient), amountOut, amountInMax, path, payer);
                } else if (command == Commands.PERMIT2_PERMIT) {
                    // equivalent: abi.decode(inputs, (IAllowanceTransfer.PermitSingle, bytes))
                    (IAllowanceTransfer.PermitSingle memory permitSingle, bytes memory data) =
                        abi.decode(inputs, (IAllowanceTransfer.PermitSingle, bytes));
                    // a reverting permit (e.g. front-run with the same signature) only fails if not allowed to revert
                    (success, output) = address(PERMIT2).call(
                        abi.encodeWithSignature(
                            "permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)",
                            msgSender(),
                            permitSingle,
                            data
                        )
                    );
                } else if (command == Commands.WRAP_ETH) {
                    // equivalent: abi.decode(inputs, (address, uint256))
                    address recipient;
                    uint256 amountMin;
                    assembly {
                        recipient := calldataload(inputs.offset)
                        amountMin := calldataload(add(inputs.offset, 0x20))
                    }
                    Payments.wrapETH(map(recipient), amountMin);
                } else if (command == Commands.UNWRAP_WETH) {
                    // equivalent: abi.decode(inputs, (address, uint256))
                    address recipient;
                    uint256 amountMin;
                    assembly {
                        recipient := calldataload(inputs.offset)
                        amountMin := calldataload(add(inputs.offset, 0x20))
                    }
                    Payments.unwrapWETH9(map(recipient), amountMin);
                } else if (command == Commands.PERMIT2_TRANSFER_FROM_BATCH) {
                    IAllowanceTransfer.AllowanceTransferDetails[] calldata batchDetails;
                    (uint256 length, uint256 offset) = inputs.toLengthOffset(0);
                    assembly {
                        batchDetails.length := length
                        batchDetails.offset := offset
                    }
                    permit2TransferFrom(batchDetails, msgSender());
                } else if (command == Commands.BALANCE_CHECK_ERC20) {
                    // equivalent: abi.decode(inputs, (address, address, uint256))
                    address owner;
                    address token;
                    uint256 minBalance;
                    assembly {
                        owner := calldataload(inputs.offset)
                        token := calldataload(add(inputs.offset, 0x20))
                        minBalance := calldataload(add(inputs.offset, 0x40))
                    }
                    success = (ERC20(token).balanceOf(map(owner)) >= minBalance);
                    if (!success) output = abi.encodePacked(BalanceTooLow.selector);
                } else {
                    // placeholder area for command 0x0f
                    revert InvalidCommandType(command);
                }
            }
        } else if (command == Commands.EXECUTE_SUB_PLAN) {
            (bytes calldata _commands, bytes[] calldata _inputs) = (inputs.toBytes(0), inputs.toBytesArray(1));
            (success, output) = (address(this)).call(abi.encodeCall(Dispatcher.execute, (_commands, _inputs)));
        } else {
            revert InvalidCommandType(command);
        }
    }

    /// @notice Calculates the recipient address for a command
    /// @param recipient The recipient or recipient-flag for the command
    /// @return output The resultant recipient for the command
    function map(address recipient) internal view returns (address) {
        if (recipient == Constants.MSG_SENDER) {
            return msgSender();
        } else if (recipient == Constants.ADDRESS_THIS) {
            return address(this);
        } else {
            return recipient;
        }
    }
}
