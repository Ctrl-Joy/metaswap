// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;
// Ported from Uniswap/universal-router/contracts/modules/uniswap/v2/V2SwapRouter.sol (+ UniswapV2Library) for MetaSwap
// MetaSwap change: pairs are resolved with `IMetaSwapV2Factory.getPair` instead of CREATE2 address math.

import {IMetaSwapV2Pair} from "@metaswap/amm/v2/interfaces/IMetaSwapV2Pair.sol";
import {IMetaSwapV2Factory} from "@metaswap/amm/v2/interfaces/IMetaSwapV2Factory.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {Constants} from "../libraries/Constants.sol";
import {Permit2Payments} from "./Permit2Payments.sol";

/// @title Router for MetaSwap v2 Trades
abstract contract V2SwapRouter is Permit2Payments {
    error V2TooLittleReceived();
    error V2TooMuchRequested();
    error V2InvalidPath();
    error V2PairNotFound();
    error V2InvalidReserves();

    /// @notice Returns the pair for tokenA/tokenB and the sorted token0
    function _pairAndToken0For(address tokenA, address tokenB) private view returns (address pair, address token0) {
        token0 = tokenA < tokenB ? tokenA : tokenB;
        pair = IMetaSwapV2Factory(V2_FACTORY).getPair(tokenA, tokenB);
        if (pair == address(0)) revert V2PairNotFound();
    }

    /// @notice Returns the pair and its reserves ordered as (reserveIn, reserveOut) for tokenIn -> tokenOut
    function _pairAndReservesFor(address tokenIn, address tokenOut)
        private
        view
        returns (address pair, uint256 reserveIn, uint256 reserveOut)
    {
        address token0;
        (pair, token0) = _pairAndToken0For(tokenIn, tokenOut);
        (uint256 reserve0, uint256 reserve1,) = IMetaSwapV2Pair(pair).getReserves();
        (reserveIn, reserveOut) = tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    /// @notice Given an input asset amount returns the maximum output amount of the other asset (0.30% fee)
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        private
        pure
        returns (uint256 amountOut)
    {
        if (reserveIn == 0 || reserveOut == 0) revert V2InvalidReserves();
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /// @notice Returns the input amount needed for a desired output amount in a single-hop trade (0.30% fee)
    function _getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        private
        pure
        returns (uint256 amountIn)
    {
        if (reserveIn == 0 || reserveOut == 0) revert V2InvalidReserves();
        if (amountOut >= reserveOut) revert V2InvalidReserves();
        uint256 numerator = reserveIn * amountOut * 1000;
        uint256 denominator = (reserveOut - amountOut) * 997;
        amountIn = (numerator / denominator) + 1;
    }

    /// @notice Returns the input amount needed for a desired output amount in a multi-hop trade
    function _getAmountInMultihop(uint256 amountOut, address[] calldata path)
        private
        view
        returns (uint256 amount, address pair)
    {
        amount = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            uint256 reserveIn;
            uint256 reserveOut;
            (pair, reserveIn, reserveOut) = _pairAndReservesFor(path[i - 1], path[i]);
            amount = _getAmountIn(amount, reserveIn, reserveOut);
        }
    }

    function _v2Swap(address[] calldata path, address recipient, address pair) private {
        unchecked {
            if (path.length < 2) revert V2InvalidPath();

            // cached to save on duplicate operations
            (address token0,) = _sortTokens(path[0], path[1]);
            uint256 finalPairIndex = path.length - 1;
            uint256 penultimatePairIndex = finalPairIndex - 1;
            for (uint256 i; i < finalPairIndex; i++) {
                // MetaSwap: per-hop amount math split into _hopAmounts (no via-ir in this build)
                (uint256 amount0Out, uint256 amount1Out) = _hopAmounts(pair, path[i], token0);
                address nextPair;
                (nextPair, token0) = i < penultimatePairIndex
                    ? _pairAndToken0For(path[i + 1], path[i + 2])
                    : (recipient, address(0));
                IMetaSwapV2Pair(pair).swap(amount0Out, amount1Out, nextPair, new bytes(0));
                pair = nextPair;
            }
        }
    }

    /// @dev computes the pair output for the input tokens already sent to it (supports fee-on-transfer tokens)
    function _hopAmounts(address pair, address input, address token0)
        private
        view
        returns (uint256 amount0Out, uint256 amount1Out)
    {
        (uint256 reserve0, uint256 reserve1,) = IMetaSwapV2Pair(pair).getReserves();
        (uint256 reserveInput, uint256 reserveOutput) = input == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        uint256 amountInput = ERC20(input).balanceOf(pair) - reserveInput;
        uint256 amountOutput = _getAmountOut(amountInput, reserveInput, reserveOutput);
        (amount0Out, amount1Out) = input == token0 ? (uint256(0), amountOutput) : (amountOutput, uint256(0));
    }

    function _sortTokens(address tokenA, address tokenB) private pure returns (address token0, address token1) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    /// @notice Performs a MetaSwap v2 exact input swap
    /// @param recipient The recipient of the output tokens
    /// @param amountIn The amount of input tokens for the trade (0 = ALREADY_PAID: the first pair already holds them)
    /// @param amountOutMinimum The minimum desired amount of output tokens
    /// @param path The path of the trade as an array of token addresses
    /// @param payer The address that will be paying the input
    function v2SwapExactInput(
        address recipient,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address[] calldata path,
        address payer
    ) internal {
        if (path.length < 2) revert V2InvalidPath();
        (address firstPair,) = _pairAndToken0For(path[0], path[1]);
        if (
            amountIn != Constants.ALREADY_PAID // amountIn of 0 to signal that the pair already has the tokens
        ) {
            payOrPermit2Transfer(path[0], payer, firstPair, amountIn);
        }

        ERC20 tokenOut = ERC20(path[path.length - 1]);
        uint256 balanceBefore = tokenOut.balanceOf(recipient);

        _v2Swap(path, recipient, firstPair);

        uint256 amountOut = tokenOut.balanceOf(recipient) - balanceBefore;
        if (amountOut < amountOutMinimum) revert V2TooLittleReceived();
    }

    /// @notice Performs a MetaSwap v2 exact output swap
    /// @param recipient The recipient of the output tokens
    /// @param amountOut The amount of output tokens to receive for the trade
    /// @param amountInMaximum The maximum desired amount of input tokens
    /// @param path The path of the trade as an array of token addresses
    /// @param payer The address that will be paying the input
    function v2SwapExactOutput(
        address recipient,
        uint256 amountOut,
        uint256 amountInMaximum,
        address[] calldata path,
        address payer
    ) internal {
        if (path.length < 2) revert V2InvalidPath();
        (uint256 amountIn, address firstPair) = _getAmountInMultihop(amountOut, path);
        if (amountIn > amountInMaximum) revert V2TooMuchRequested();

        payOrPermit2Transfer(path[0], payer, firstPair, amountIn);
        _v2Swap(path, recipient, firstPair);
    }
}
