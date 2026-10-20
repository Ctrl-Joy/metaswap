// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;
// Ported from Uniswap/UniswapX/src/sample-executors/SwapRouter02Executor.sol for MetaSwap

import {Owned} from "solmate/src/auth/Owned.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {WETH} from "solmate/src/tokens/WETH.sol";
import {ISwapRouter02} from "@metaswap/amm/v3/interfaces/ISwapRouter02.sol";
import {IPeripheryImmutableState} from "@metaswap/amm/v3/interfaces/IPeripheryImmutableState.sol";
import {IReactorCallback} from "../interfaces/IReactorCallback.sol";
import {IReactor} from "../interfaces/IReactor.sol";
import {CurrencyLibrary} from "../lib/CurrencyLibrary.sol";
import {ResolvedOrder, SignedOrder} from "../base/ReactorStructs.sol";

/// @notice A fill contract that uses MetaSwap SwapRouter02 (V2 + V3 routes) to execute trades
/// @dev callbackData = abi.encode(address[] tokensToApproveForSwapRouter02, address[] tokensToApproveForReactor,
///  bytes[] multicallData). `multicallData` is passed to `SwapRouter02.multicall(type(uint256).max, data)`, so a
///  filler can use any SwapRouter02 call: exactInputSingle / exactInput / exactOutput* (V3) and
///  swapExactTokensForTokens / swapTokensForExactTokens (V2), plus unwrapWETH9 for native outputs.
contract SwapRouter02Executor is IReactorCallback, Owned {
    using SafeTransferLib for ERC20;
    using CurrencyLibrary for address;

    /// @notice thrown if reactorCallback is called with a non-whitelisted filler
    error CallerNotWhitelisted();
    /// @notice thrown if reactorCallback is called by an address other than the reactor
    error MsgSenderNotReactor();

    ISwapRouter02 public immutable swapRouter02;
    address public immutable whitelistedCaller;
    IReactor public immutable reactor;
    WETH public immutable weth;

    modifier onlyWhitelistedCaller() {
        if (msg.sender != whitelistedCaller) {
            revert CallerNotWhitelisted();
        }
        _;
    }

    modifier onlyReactor() {
        if (msg.sender != address(reactor)) {
            revert MsgSenderNotReactor();
        }
        _;
    }

    constructor(address _whitelistedCaller, IReactor _reactor, address _owner, ISwapRouter02 _swapRouter02)
        Owned(_owner)
    {
        whitelistedCaller = _whitelistedCaller;
        reactor = _reactor;
        swapRouter02 = _swapRouter02;
        weth = WETH(payable(IPeripheryImmutableState(address(_swapRouter02)).WETH9()));
    }

    /// @notice assume that we already have all output tokens
    function execute(SignedOrder calldata order, bytes calldata callbackData) external onlyWhitelistedCaller {
        reactor.executeWithCallback(order, callbackData);
    }

    /// @notice assume that we already have all output tokens
    function executeBatch(SignedOrder[] calldata orders, bytes calldata callbackData) external onlyWhitelistedCaller {
        reactor.executeBatchWithCallback(orders, callbackData);
    }

    /// @notice fill UniswapX-style orders using SwapRouter02
    /// @param callbackData It has the below encoded:
    /// address[] memory tokensToApproveForSwapRouter02: Max approve these tokens to swapRouter02
    /// address[] memory tokensToApproveForReactor: Max approve these tokens to reactor
    /// bytes[] memory multicallData: Pass into swapRouter02.multicall()
    function reactorCallback(ResolvedOrder[] calldata, bytes calldata callbackData) external onlyReactor {
        (
            address[] memory tokensToApproveForSwapRouter02,
            address[] memory tokensToApproveForReactor,
            bytes[] memory multicallData
        ) = abi.decode(callbackData, (address[], address[], bytes[]));

        unchecked {
            for (uint256 i = 0; i < tokensToApproveForSwapRouter02.length; i++) {
                ERC20(tokensToApproveForSwapRouter02[i]).safeApprove(address(swapRouter02), type(uint256).max);
            }

            for (uint256 i = 0; i < tokensToApproveForReactor.length; i++) {
                ERC20(tokensToApproveForReactor[i]).safeApprove(address(reactor), type(uint256).max);
            }
        }

        swapRouter02.multicall(type(uint256).max, multicallData);

        // transfer any native balance to the reactor
        // it will refund any excess
        if (address(this).balance > 0) {
            CurrencyLibrary.transferNative(address(reactor), address(this).balance);
        }
    }

    /// @notice This function can be used to convert ERC20s to ETH that remains in this contract
    /// @param tokensToApprove Max approve these tokens to swapRouter02
    /// @param multicallData Pass into swapRouter02.multicall()
    function multicall(ERC20[] calldata tokensToApprove, bytes[] calldata multicallData) external onlyOwner {
        for (uint256 i = 0; i < tokensToApprove.length; i++) {
            tokensToApprove[i].safeApprove(address(swapRouter02), type(uint256).max);
        }
        swapRouter02.multicall(type(uint256).max, multicallData);
    }

    /// @notice Unwraps the contract's WETH9 balance and sends it to the recipient as ETH. Can only be called by owner.
    /// @param recipient The address receiving ETH
    function unwrapWETH(address recipient) external onlyOwner {
        uint256 balanceWETH = weth.balanceOf(address(this));

        weth.withdraw(balanceWETH);
        SafeTransferLib.safeTransferETH(recipient, address(this).balance);
    }

    /// @notice Transfer all ETH in this contract to the recipient. Can only be called by owner.
    /// @param recipient The recipient of the ETH
    function withdrawETH(address recipient) external onlyOwner {
        SafeTransferLib.safeTransferETH(recipient, address(this).balance);
    }

    /// @notice MetaSwap addition: transfer this contract's whole balance of `token` to `recipient` (owner only).
    /// @param token The ERC20 to withdraw
    /// @param recipient The recipient of the tokens
    function withdrawERC20(ERC20 token, address recipient) external onlyOwner {
        token.safeTransfer(recipient, token.balanceOf(address(this)));
    }

    /// @notice Necessary for this contract to receive ETH when calling unwrapWETH()
    receive() external payable {}
}
