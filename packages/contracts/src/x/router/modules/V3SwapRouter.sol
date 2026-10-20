// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;
// Ported from Uniswap/universal-router/contracts/modules/uniswap/v3/V3SwapRouter.sol for MetaSwap
// MetaSwap change: pools are resolved with `IMetaSwapV3Factory.getPool` instead of CREATE2 address math, and the
// swap callback is authenticated by `factory.getPool(tokenIn, tokenOut, fee) == msg.sender`.

import {IMetaSwapV3Pool} from "@metaswap/amm/v3/interfaces/IMetaSwapV3Pool.sol";
import {IMetaSwapV3Factory} from "@metaswap/amm/v3/interfaces/IMetaSwapV3Factory.sol";
import {IMetaSwapV3SwapCallback} from "@metaswap/amm/v3/interfaces/callback/IMetaSwapV3SwapCallback.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {V3Path} from "../libraries/V3Path.sol";
import {BytesLib} from "../libraries/BytesLib.sol";
import {Constants} from "../libraries/Constants.sol";
import {Permit2Payments} from "./Permit2Payments.sol";

/// @title Router for MetaSwap v3 Trades
abstract contract V3SwapRouter is Permit2Payments, IMetaSwapV3SwapCallback {
    using V3Path for bytes;
    using BytesLib for bytes;
    using SafeCast for uint256;

    error V3InvalidSwap();
    error V3TooLittleReceived();
    error V3TooMuchRequested();
    error V3InvalidAmountOut();
    error V3InvalidCaller();
    error V3PoolNotFound();

    /// @dev The minimum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MIN_TICK)
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;

    /// @dev The maximum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MAX_TICK)
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    /// @dev Transient storage slot caching the max input of an exact-output swap (default: unlimited).
    ///  uint256(keccak256("MetaSwapUniversalRouter.maxAmountIn")) - 1
    bytes32 private constant MAX_AMOUNT_IN_SLOT = 0x2b1e8c1f9d3b3a0e0d7e6c41f5a9b6d7c8e1f2a3b4c5d6e7f8091a2b3c4d5e6f;

    function _getMaxAmountIn() private view returns (uint256 maxAmountIn) {
        bytes32 slot = MAX_AMOUNT_IN_SLOT;
        assembly {
            maxAmountIn := tload(slot)
        }
        // stored bit-inverted so that an unset slot (0) reads as "unlimited"
        maxAmountIn = ~maxAmountIn;
    }

    function _setMaxAmountIn(uint256 maxAmountIn) private {
        bytes32 slot = MAX_AMOUNT_IN_SLOT;
        uint256 inverted = ~maxAmountIn;
        assembly {
            tstore(slot, inverted)
        }
    }

    /// @inheritdoc IMetaSwapV3SwapCallback
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (amount0Delta <= 0 && amount1Delta <= 0) revert V3InvalidSwap(); // swaps entirely within 0-liquidity regions are not supported
        (, address payer) = abi.decode(data, (bytes, address));
        bytes calldata path = data.toBytes(0);

        // because exact output swaps are executed in reverse order, in this case tokenOut is actually tokenIn
        (address tokenIn, uint24 fee, address tokenOut) = path.decodeFirstPool();

        if (_poolFor(tokenIn, tokenOut, fee) != msg.sender) revert V3InvalidCaller();

        (bool isExactInput, uint256 amountToPay) = amount0Delta > 0
            ? (tokenIn < tokenOut, uint256(amount0Delta))
            : (tokenOut < tokenIn, uint256(amount1Delta));

        if (isExactInput) {
            // Pay the pool (msg.sender)
            payOrPermit2Transfer(tokenIn, payer, msg.sender, amountToPay);
        } else {
            // either initiate the next swap or pay
            if (path.hasMultiplePools()) {
                // this is an intermediate step so the payer is actually this contract
                path = path.skipToken();
                _swap(-amountToPay.toInt256(), msg.sender, path, payer, false);
            } else {
                if (amountToPay > _getMaxAmountIn()) revert V3TooMuchRequested();
                // note that because exact output swaps are executed in reverse order, tokenOut is actually tokenIn
                payOrPermit2Transfer(tokenOut, payer, msg.sender, amountToPay);
            }
        }
    }

    /// @notice Performs a MetaSwap v3 exact input swap
    /// @param recipient The recipient of the output tokens
    /// @param amountIn The amount of input tokens for the trade (CONTRACT_BALANCE = router's balance)
    /// @param amountOutMinimum The minimum desired amount of output tokens
    /// @param path The path of the trade as a bytes string (tokenIn | fee | tokenOut ...)
    /// @param payer The address that will be paying the input
    function v3SwapExactInput(
        address recipient,
        uint256 amountIn,
        uint256 amountOutMinimum,
        bytes calldata path,
        address payer
    ) internal {
        // use amountIn == Constants.CONTRACT_BALANCE as a flag to swap the entire balance of the contract
        if (amountIn == Constants.CONTRACT_BALANCE) {
            address tokenIn = path.decodeFirstToken();
            amountIn = ERC20(tokenIn).balanceOf(address(this));
        }

        uint256 amountOut;
        while (true) {
            bool hasMultiplePools = path.hasMultiplePools();

            // the outputs of prior swaps become the inputs to subsequent ones
            (int256 amount0Delta, int256 amount1Delta, bool zeroForOne) = _swap(
                amountIn.toInt256(),
                hasMultiplePools ? address(this) : recipient, // for intermediate swaps, this contract custodies
                path.getFirstPool(), // only the first pool is needed
                payer, // for intermediate swaps, this contract custodies
                true
            );

            amountIn = uint256(-(zeroForOne ? amount1Delta : amount0Delta));

            // decide whether to continue or terminate
            if (hasMultiplePools) {
                payer = address(this);
                path = path.skipToken();
            } else {
                amountOut = amountIn;
                break;
            }
        }

        if (amountOut < amountOutMinimum) revert V3TooLittleReceived();
    }

    /// @notice Performs a MetaSwap v3 exact output swap
    /// @param recipient The recipient of the output tokens
    /// @param amountOut The amount of output tokens to receive for the trade
    /// @param amountInMaximum The maximum desired amount of input tokens
    /// @param path The path of the trade as a bytes string, REVERSED (tokenOut | fee | tokenIn ...)
    /// @param payer The address that will be paying the input
    function v3SwapExactOutput(
        address recipient,
        uint256 amountOut,
        uint256 amountInMaximum,
        bytes calldata path,
        address payer
    ) internal {
        _setMaxAmountIn(amountInMaximum);
        (int256 amount0Delta, int256 amount1Delta, bool zeroForOne) =
            _swap(-amountOut.toInt256(), recipient, path, payer, false);

        uint256 amountOutReceived = zeroForOne ? uint256(-amount1Delta) : uint256(-amount0Delta);

        if (amountOutReceived != amountOut) revert V3InvalidAmountOut();

        _setMaxAmountIn(type(uint256).max);
    }

    /// @dev Performs a single swap for both exactIn and exactOut
    /// For exactIn, `amount` is `amountIn`. For exactOut, `amount` is `-amountOut`
    function _swap(int256 amount, address recipient, bytes calldata path, address payer, bool isExactIn)
        private
        returns (int256 amount0Delta, int256 amount1Delta, bool zeroForOne)
    {
        (address tokenIn, uint24 fee, address tokenOut) = path.decodeFirstPool();

        zeroForOne = isExactIn ? tokenIn < tokenOut : tokenOut < tokenIn;

        (amount0Delta, amount1Delta) = IMetaSwapV3Pool(_poolFor(tokenIn, tokenOut, fee)).swap(
            recipient,
            zeroForOne,
            amount,
            (zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1),
            abi.encode(path, payer)
        );
    }

    function _poolFor(address tokenA, address tokenB, uint24 fee) private view returns (address pool) {
        pool = IMetaSwapV3Factory(V3_FACTORY).getPool(tokenA, tokenB, fee);
        if (pool == address(0)) revert V3PoolNotFound();
    }
}
