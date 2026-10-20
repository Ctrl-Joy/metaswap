// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {XFixture} from "./utils/XFixture.sol";
import {IMetaSwapV2Pair} from "@metaswap/amm/v2/interfaces/IMetaSwapV2Pair.sol";
import {IAllowanceTransfer} from "@metaswap/x/permit2/interfaces/IAllowanceTransfer.sol";
import {IMetaSwapUniversalRouter} from "@metaswap/x/router/interfaces/IMetaSwapUniversalRouter.sol";
import {Commands} from "@metaswap/x/router/libraries/Commands.sol";
import {Constants} from "@metaswap/x/router/libraries/Constants.sol";
import {V2SwapRouter} from "@metaswap/x/router/modules/V2SwapRouter.sol";
import {V3SwapRouter} from "@metaswap/x/router/modules/V3SwapRouter.sol";
import {Payments} from "@metaswap/x/router/modules/Payments.sol";

contract UniversalRouterTest is XFixture {
    address constant MSG_SENDER = address(1);
    address constant ADDRESS_THIS = address(2);
    uint256 constant CONTRACT_BALANCE = 1 << 255;

    address feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        vm.warp(1_700_000_000);
        setUpAMM();
        tokenA.transfer(alice, 1_000 ether);
        tokenB.transfer(alice, 1_000 ether);
        tokenC.transfer(alice, 1_000 ether);
        vm.deal(alice, 100 ether);
        // one-time ERC20 approval of Permit2
        vm.startPrank(alice);
        tokenA.approve(address(permit2), type(uint256).max);
        tokenB.approve(address(permit2), type(uint256).max);
        tokenC.approve(address(permit2), type(uint256).max);
        weth.approve(address(permit2), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ helpers

    function _approveRouter(address token) internal {
        vm.prank(alice);
        permit2.approve(token, address(router), type(uint160).max, uint48(block.timestamp + 1 days));
    }

    function _exec(bytes memory commands, bytes[] memory inputs) internal {
        vm.prank(alice);
        router.execute(commands, inputs, block.timestamp + 60);
    }

    function _path(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2);
        p[0] = a;
        p[1] = b;
    }

    function _v2Out(address pairToken0, address pairToken1, address tokenIn, uint256 amountIn)
        internal
        view
        returns (uint256)
    {
        IMetaSwapV2Pair pair = IMetaSwapV2Pair(v2Factory.getPair(pairToken0, pairToken1));
        (uint112 r0, uint112 r1,) = pair.getReserves();
        (uint256 rIn, uint256 rOut) = tokenIn == pair.token0() ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 inWithFee = amountIn * 997;
        return (inWithFee * rOut) / (rIn * 1000 + inWithFee);
    }

    // ------------------------------------------------------------ V2

    function test_v2ExactIn() public {
        _approveRouter(address(tokenA));
        uint256 amountIn = 10 ether;
        uint256 expected = _v2Out(address(tokenA), address(tokenB), address(tokenA), amountIn);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, amountIn, expected, _path(address(tokenA), address(tokenB)), true);
        uint256 bBefore = tokenB.balanceOf(alice);
        uint256 aBefore = tokenA.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.V2_SWAP_EXACT_IN)), inputs);
        assertEq(tokenB.balanceOf(alice) - bBefore, expected);
        assertEq(aBefore - tokenA.balanceOf(alice), amountIn);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function test_v2ExactIn_multihop() public {
        _approveRouter(address(tokenA));
        address[] memory path = new address[](3);
        (path[0], path[1], path[2]) = (address(tokenA), address(tokenB), address(tokenC));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 5 ether, 4.9 ether, path, true);
        uint256 cBefore = tokenC.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.V2_SWAP_EXACT_IN)), inputs);
        uint256 got = tokenC.balanceOf(alice) - cBefore;
        assertGt(got, 4.9 ether);
        assertLt(got, 5 ether);
    }

    function test_v2ExactOut() public {
        _approveRouter(address(tokenA));
        uint256 amountOut = 10 ether;
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, amountOut, 10.1 ether, _path(address(tokenA), address(tokenB)), true);
        uint256 bBefore = tokenB.balanceOf(alice);
        uint256 aBefore = tokenA.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.V2_SWAP_EXACT_OUT)), inputs);
        assertEq(tokenB.balanceOf(alice) - bBefore, amountOut);
        uint256 spent = aBefore - tokenA.balanceOf(alice);
        assertGt(spent, amountOut);
        assertLe(spent, 10.1 ether);
    }

    function test_v2ExactIn_slippageReverts() public {
        _approveRouter(address(tokenA));
        uint256 expected = _v2Out(address(tokenA), address(tokenB), address(tokenA), 10 ether);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 10 ether, expected + 1, _path(address(tokenA), address(tokenB)), true);
        vm.prank(alice);
        vm.expectRevert(V2SwapRouter.V2TooLittleReceived.selector);
        router.execute(abi.encodePacked(uint8(Commands.V2_SWAP_EXACT_IN)), inputs, block.timestamp);
    }

    function test_v2ExactOut_tooMuchRequestedReverts() public {
        _approveRouter(address(tokenA));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 10 ether, 10 ether, _path(address(tokenA), address(tokenB)), true);
        vm.prank(alice);
        vm.expectRevert(V2SwapRouter.V2TooMuchRequested.selector);
        router.execute(abi.encodePacked(uint8(Commands.V2_SWAP_EXACT_OUT)), inputs, block.timestamp);
    }

    function test_v2MissingPairReverts() public {
        _approveRouter(address(tokenA));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 1 ether, 0, _path(address(tokenA), address(tokenC)), true);
        vm.prank(alice);
        vm.expectRevert(V2SwapRouter.V2PairNotFound.selector);
        router.execute(abi.encodePacked(uint8(Commands.V2_SWAP_EXACT_IN)), inputs, block.timestamp);
    }

    // ------------------------------------------------------------ V3

    function test_v3ExactIn_single() public {
        _approveRouter(address(tokenA));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 10 ether, 9.9 ether, abi.encodePacked(address(tokenA), FEE, address(tokenB)), true);
        uint256 bBefore = tokenB.balanceOf(alice);
        uint256 aBefore = tokenA.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.V3_SWAP_EXACT_IN)), inputs);
        uint256 got = tokenB.balanceOf(alice) - bBefore;
        assertEq(aBefore - tokenA.balanceOf(alice), 10 ether);
        // 0.3% fee on a deep 1:1 pool
        assertApproxEqRel(got, 9.97 ether, 0.001e18);
    }

    function test_v3ExactIn_multihop() public {
        _approveRouter(address(tokenA));
        bytes memory path = abi.encodePacked(address(tokenA), FEE, address(tokenB), FEE, address(tokenC));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 10 ether, 9.9 ether, path, true);
        uint256 cBefore = tokenC.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.V3_SWAP_EXACT_IN)), inputs);
        uint256 got = tokenC.balanceOf(alice) - cBefore;
        assertApproxEqRel(got, 9.94 ether, 0.001e18);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function test_v3ExactOut_single() public {
        _approveRouter(address(tokenA));
        // exact-out paths are reversed: tokenOut first
        bytes memory path = abi.encodePacked(address(tokenB), FEE, address(tokenA));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 10 ether, 10.1 ether, path, true);
        uint256 bBefore = tokenB.balanceOf(alice);
        uint256 aBefore = tokenA.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.V3_SWAP_EXACT_OUT)), inputs);
        assertEq(tokenB.balanceOf(alice) - bBefore, 10 ether);
        uint256 spent = aBefore - tokenA.balanceOf(alice);
        assertGt(spent, 10 ether);
        assertLe(spent, 10.1 ether);
    }

    function test_v3ExactOut_multihop() public {
        _approveRouter(address(tokenA));
        bytes memory path = abi.encodePacked(address(tokenC), FEE, address(tokenB), FEE, address(tokenA));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 10 ether, 10.2 ether, path, true);
        uint256 cBefore = tokenC.balanceOf(alice);
        uint256 aBefore = tokenA.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.V3_SWAP_EXACT_OUT)), inputs);
        assertEq(tokenC.balanceOf(alice) - cBefore, 10 ether);
        uint256 spent = aBefore - tokenA.balanceOf(alice);
        assertApproxEqRel(spent, 10.06 ether, 0.001e18);
    }

    function test_v3ExactOut_tooMuchRequestedReverts() public {
        _approveRouter(address(tokenA));
        bytes memory path = abi.encodePacked(address(tokenB), FEE, address(tokenA));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 10 ether, 10 ether, path, true);
        vm.prank(alice);
        vm.expectRevert(V3SwapRouter.V3TooMuchRequested.selector);
        router.execute(abi.encodePacked(uint8(Commands.V3_SWAP_EXACT_OUT)), inputs, block.timestamp);
    }

    function test_v3ExactIn_slippageReverts() public {
        _approveRouter(address(tokenA));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 10 ether, 10 ether, abi.encodePacked(address(tokenA), FEE, address(tokenB)), true);
        vm.prank(alice);
        vm.expectRevert(V3SwapRouter.V3TooLittleReceived.selector);
        router.execute(abi.encodePacked(uint8(Commands.V3_SWAP_EXACT_IN)), inputs, block.timestamp);
    }

    function test_v3Callback_rejectsNonPool() public {
        bytes memory path = abi.encodePacked(address(tokenA), FEE, address(tokenB));
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(V3SwapRouter.V3InvalidCaller.selector);
        router.uniswapV3SwapCallback(1 ether, 0, abi.encode(path, alice));
    }

    // ------------------------------------------------------------ mixed / ETH / permit / payments

    function test_mixedV2ThenV3() public {
        _approveRouter(address(tokenA));
        // V2 A->B into the router, then V3 B->C using the router's whole B balance
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(ADDRESS_THIS, 10 ether, 0, _path(address(tokenA), address(tokenB)), true);
        inputs[1] = abi.encode(MSG_SENDER, CONTRACT_BALANCE, 9.9 ether, abi.encodePacked(address(tokenB), FEE, address(tokenC)), false);
        uint256 cBefore = tokenC.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.V2_SWAP_EXACT_IN), uint8(Commands.V3_SWAP_EXACT_IN)), inputs);
        uint256 got = tokenC.balanceOf(alice) - cBefore;
        assertApproxEqRel(got, 9.94 ether, 0.001e18);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function test_ethIn_wrapThenSwap() public {
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(ADDRESS_THIS, CONTRACT_BALANCE);
        inputs[1] = abi.encode(MSG_SENDER, CONTRACT_BALANCE, 0.99 ether, abi.encodePacked(address(weth), FEE, address(tokenA)), false);
        uint256 aBefore = tokenA.balanceOf(alice);
        uint256 ethBefore = alice.balance;
        vm.prank(alice);
        router.execute{value: 1 ether}(
            abi.encodePacked(uint8(Commands.WRAP_ETH), uint8(Commands.V3_SWAP_EXACT_IN)), inputs, block.timestamp
        );
        assertEq(ethBefore - alice.balance, 1 ether);
        assertApproxEqRel(tokenA.balanceOf(alice) - aBefore, 0.997 ether, 0.001e18);
        assertEq(address(router).balance, 0);
        assertEq(weth.balanceOf(address(router)), 0);
    }

    function test_ethOut_swapThenUnwrap() public {
        _approveRouter(address(tokenB));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(ADDRESS_THIS, 2 ether, 0, _path(address(tokenB), address(weth)), true);
        inputs[1] = abi.encode(MSG_SENDER, 1.99 ether);
        uint256 ethBefore = alice.balance;
        _exec(abi.encodePacked(uint8(Commands.V2_SWAP_EXACT_IN), uint8(Commands.UNWRAP_WETH)), inputs);
        uint256 got = alice.balance - ethBefore;
        assertEq(got, _v2OutAfter(2 ether));
        assertEq(weth.balanceOf(address(router)), 0);
    }

    function _v2OutAfter(uint256 amountIn) internal pure returns (uint256) {
        // pair was 100k/100k before the swap
        uint256 inWithFee = amountIn * 997;
        return (inWithFee * 100_000 ether) / (100_000 ether * 1000 + inWithFee);
    }

    function test_ethOut_unwrapMinimumReverts() public {
        _approveRouter(address(tokenB));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(ADDRESS_THIS, 2 ether, 0, _path(address(tokenB), address(weth)), true);
        inputs[1] = abi.encode(MSG_SENDER, 2 ether);
        vm.prank(alice);
        vm.expectRevert(Payments.InsufficientETH.selector);
        router.execute(abi.encodePacked(uint8(Commands.V2_SWAP_EXACT_IN), uint8(Commands.UNWRAP_WETH)), inputs, block.timestamp);
    }

    function test_permit2PermitAndSwapInOneExecute() public {
        // no prior Permit2 allowance: the user signs a PermitSingle for the router
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(address(tokenA), uint160(10 ether), 0, address(router));
        bytes memory sig = _signPermitSingle(alicePk, p);
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(MSG_SENDER, 10 ether, 9.9 ether, abi.encodePacked(address(tokenA), FEE, address(tokenB)), true);
        uint256 bBefore = tokenB.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.PERMIT2_PERMIT), uint8(Commands.V3_SWAP_EXACT_IN)), inputs);
        assertGt(tokenB.balanceOf(alice) - bBefore, 9.9 ether);
        (uint160 remaining,, uint48 nonce) = permit2.allowance(alice, address(tokenA), address(router));
        assertEq(remaining, 0);
        assertEq(nonce, 1);
    }

    function test_permit2Permit_replayFailsUnlessAllowRevert() public {
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(address(tokenA), uint160(10 ether), 0, address(router));
        bytes memory sig = _signPermitSingle(alicePk, p);
        permit2.permit(alice, p, sig); // someone front-runs the permit
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(p, sig);
        vm.prank(alice);
        vm.expectRevert(); // ExecutionFailed(0, InvalidNonce)
        router.execute(abi.encodePacked(uint8(Commands.PERMIT2_PERMIT)), inputs, block.timestamp);
        // with FLAG_ALLOW_REVERT the command is skipped
        vm.prank(alice);
        router.execute(abi.encodePacked(uint8(Commands.PERMIT2_PERMIT) | 0x80), inputs, block.timestamp);
    }

    function test_permit2TransferFromThenV2AlreadyPaid() public {
        _approveRouter(address(tokenA));
        address pair = v2Factory.getPair(address(tokenA), address(tokenB));
        uint256 expected = _v2Out(address(tokenA), address(tokenB), address(tokenA), 3 ether);
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(address(tokenA), pair, uint160(3 ether));
        inputs[1] = abi.encode(MSG_SENDER, 0, expected, _path(address(tokenA), address(tokenB)), true); // 0 = ALREADY_PAID
        uint256 bBefore = tokenB.balanceOf(alice);
        _exec(abi.encodePacked(uint8(Commands.PERMIT2_TRANSFER_FROM), uint8(Commands.V2_SWAP_EXACT_IN)), inputs);
        assertEq(tokenB.balanceOf(alice) - bBefore, expected);
    }

    function test_payPortionFeeThenSweep() public {
        _approveRouter(address(tokenA));
        bytes[] memory inputs = new bytes[](3);
        inputs[0] = abi.encode(ADDRESS_THIS, 100 ether, 0, abi.encodePacked(address(tokenA), FEE, address(tokenB)), true);
        inputs[1] = abi.encode(address(tokenB), feeRecipient, uint256(25)); // 0.25% interface fee
        inputs[2] = abi.encode(address(tokenB), MSG_SENDER, 98 ether);
        uint256 bBefore = tokenB.balanceOf(alice);
        _exec(
            abi.encodePacked(uint8(Commands.V3_SWAP_EXACT_IN), uint8(Commands.PAY_PORTION), uint8(Commands.SWEEP)),
            inputs
        );
        uint256 fee = tokenB.balanceOf(feeRecipient);
        uint256 user = tokenB.balanceOf(alice) - bBefore;
        assertGt(fee, 0);
        assertEq(fee, ((fee + user) * 25) / 10_000);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function test_payPortionInvalidBips() public {
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(tokenB), feeRecipient, uint256(10_001));
        vm.prank(alice);
        vm.expectRevert(Payments.InvalidBips.selector);
        router.execute(abi.encodePacked(uint8(Commands.PAY_PORTION)), inputs, block.timestamp);
    }

    function test_transferCommand() public {
        _approveRouter(address(tokenA));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(address(tokenA), ADDRESS_THIS, uint160(4 ether));
        inputs[1] = abi.encode(address(tokenA), feeRecipient, uint256(4 ether));
        _exec(abi.encodePacked(uint8(Commands.PERMIT2_TRANSFER_FROM), uint8(Commands.TRANSFER)), inputs);
        assertEq(tokenA.balanceOf(feeRecipient), 4 ether);
    }

    function test_sweepMinimumReverts() public {
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(tokenB), MSG_SENDER, 1);
        vm.prank(alice);
        vm.expectRevert(Payments.InsufficientToken.selector);
        router.execute(abi.encodePacked(uint8(Commands.SWEEP)), inputs, block.timestamp);
    }

    function test_deadlineReverts() public {
        _approveRouter(address(tokenA));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 1 ether, 0, abi.encodePacked(address(tokenA), FEE, address(tokenB)), true);
        vm.prank(alice);
        vm.expectRevert(IMetaSwapUniversalRouter.TransactionDeadlinePassed.selector);
        router.execute(abi.encodePacked(uint8(Commands.V3_SWAP_EXACT_IN)), inputs, block.timestamp - 1);
    }

    function test_lengthMismatchAndInvalidCommand() public {
        bytes[] memory inputs = new bytes[](1);
        vm.prank(alice);
        vm.expectRevert(IMetaSwapUniversalRouter.LengthMismatch.selector);
        router.execute(hex"0000", inputs, block.timestamp);

        inputs[0] = "";
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("InvalidCommandType(uint256)", uint256(0x10)));
        router.execute(hex"10", inputs, block.timestamp);
    }

    function test_balanceCheck() public {
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(alice, address(tokenA), 1_000_001 ether);
        vm.prank(alice);
        vm.expectRevert();
        router.execute(abi.encodePacked(uint8(Commands.BALANCE_CHECK_ERC20)), inputs, block.timestamp);
        inputs[0] = abi.encode(alice, address(tokenA), 1 ether);
        vm.prank(alice);
        router.execute(abi.encodePacked(uint8(Commands.BALANCE_CHECK_ERC20)), inputs, block.timestamp);
    }

    function test_rejectsPlainEth() public {
        vm.prank(alice);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_payerIsUserRequiresPermit2Allowance() public {
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(MSG_SENDER, 1 ether, 0, abi.encodePacked(address(tokenA), FEE, address(tokenB)), true);
        vm.prank(alice);
        vm.expectRevert(); // AllowanceExpired(0)
        router.execute(abi.encodePacked(uint8(Commands.V3_SWAP_EXACT_IN)), inputs, block.timestamp);
    }
}
