// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;
// Ported from Uniswap/UniswapX/src/reactors/ExclusiveDutchOrderReactor.sol for MetaSwap

import {BaseReactor} from "./BaseReactor.sol";
import {IPermit2} from "../../permit2/interfaces/IPermit2.sol";
import {ExclusivityLib} from "../lib/ExclusivityLib.sol";
import {Permit2Lib} from "../lib/Permit2Lib.sol";
import {DutchDecayLib} from "../lib/DutchDecayLib.sol";
import {ExclusiveDutchOrderLib, ExclusiveDutchOrder, DutchOutput, DutchInput} from "../lib/ExclusiveDutchOrderLib.sol";
import {SignedOrder, ResolvedOrder} from "../base/ReactorStructs.sol";

/// @notice Reactor for exclusive dutch orders
/// @dev The output (or input) amount decays linearly from start to end between decayStartTime and decayEndTime.
///  Until decayStartTime the exclusiveFiller (if set) has exclusive rights; other fillers must improve
///  every output by exclusivityOverrideBps (or cannot fill at all if it is 0).
contract ExclusiveDutchOrderReactor is BaseReactor {
    using Permit2Lib for ResolvedOrder;
    using ExclusiveDutchOrderLib for ExclusiveDutchOrder;
    using DutchDecayLib for DutchOutput[];
    using DutchDecayLib for DutchInput;
    using ExclusivityLib for ResolvedOrder;

    /// @notice thrown when an order's deadline is before its end time
    error DeadlineBeforeEndTime();

    /// @notice thrown when an order's inputs and outputs both decay
    error InputAndOutputDecay();

    constructor(IPermit2 _permit2, address _protocolFeeOwner) BaseReactor(_permit2, _protocolFeeOwner) {}

    /// @inheritdoc BaseReactor
    function _resolve(SignedOrder calldata signedOrder)
        internal
        view
        virtual
        override
        returns (ResolvedOrder memory resolvedOrder)
    {
        ExclusiveDutchOrder memory order = abi.decode(signedOrder.order, (ExclusiveDutchOrder));
        // hash the order _before_ overriding amounts, as this is the hash the user would have signed
        bytes32 orderHash = order.hash();

        _validateOrder(order);

        resolvedOrder = ResolvedOrder({
            info: order.info,
            input: order.input.decay(order.decayStartTime, order.decayEndTime),
            outputs: order.outputs.decay(order.decayStartTime, order.decayEndTime),
            sig: signedOrder.sig,
            hash: orderHash
        });
        resolvedOrder.handleExclusiveOverride(order.exclusiveFiller, order.decayStartTime, order.exclusivityOverrideBps);
    }

    /// @inheritdoc BaseReactor
    function transferInputTokens(ResolvedOrder memory order, address to) internal override {
        permit2.permitWitnessTransferFrom(
            order.toPermit(),
            order.transferDetails(to),
            order.info.swapper,
            order.hash,
            ExclusiveDutchOrderLib.PERMIT2_ORDER_TYPE,
            order.sig
        );
    }

    /// @notice validate the dutch order fields
    /// - deadline must be greater than or equal than decayEndTime
    /// - decayEndTime must be greater than or equal to decayStartTime
    /// - if there's input decay, outputs must not decay
    /// @dev Throws if the order is invalid
    function _validateOrder(ExclusiveDutchOrder memory order) internal pure {
        if (order.info.deadline < order.decayEndTime) {
            revert DeadlineBeforeEndTime();
        }

        if (order.decayEndTime < order.decayStartTime) {
            revert DutchDecayLib.EndTimeBeforeStartTime();
        }

        if (order.input.startAmount != order.input.endAmount) {
            unchecked {
                for (uint256 i = 0; i < order.outputs.length; i++) {
                    if (order.outputs[i].startAmount != order.outputs[i].endAmount) {
                        revert InputAndOutputDecay();
                    }
                }
            }
        }
    }
}
