// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {AMMFixture} from "./utils/AMMFixture.sol";
import {IV3SwapRouter} from "../../src/amm/v3/interfaces/IV3SwapRouter.sol";
import {IV2SwapRouter} from "../../src/amm/v3/interfaces/IV2SwapRouter.sol";
import {IQuoterV2} from "../../src/amm/v3/interfaces/IQuoterV2.sol";
import {ITickLens} from "../../src/amm/v3/interfaces/ITickLens.sol";
import {IPeripheryPayments} from "../../src/amm/v3/interfaces/IPeripheryPayments.sol";
import {IPeripheryPaymentsExtended} from "../../src/amm/v3/interfaces/IPeripheryPaymentsExtended.sol";
import {IMetaSwapV3Pool} from "../../src/amm/v3/interfaces/IMetaSwapV3Pool.sol";
import {TickMath} from "../../src/amm/v3/libraries/TickMath.sol";
import {Constants} from "../../src/amm/v3/libraries/Constants.sol";

contract V3RouterTest is AMMFixture {
    uint24 internal constant FEE = 3000;
    IMetaSwapV3Pool internal poolAB;
    IMetaSwapV3Pool internal poolBC;
    IMetaSwapV3Pool internal poolAW;

    function setUp() public {
        setUpAMM();
        poolAB = _createPoolV3(address(tokenA), address(tokenB), FEE, SQRT_1_1);
        poolBC = _createPoolV3(address(tokenB), address(tokenC), FEE, SQRT_1_1);
        poolAW = _createPoolV3(address(tokenA), address(weth), FEE, SQRT_1_1);
        (int24 lo, int24 hi) = _fullRange(60);
        _mintV3(address(this), address(tokenA), address(tokenB), FEE, lo, hi, 1000e18, 1000e18);
        _mintV3(address(this), address(tokenA), address(tokenB), FEE, -600, 600, 1000e18, 1000e18);
        _mintV3(address(this), address(tokenA), address(tokenB), FEE, -1800, -600, 0, 500e18);
        _mintV3(address(this), address(tokenB), address(tokenC), FEE, lo, hi, 1000e18, 1000e18);
        _mintV3(address(this), address(tokenB), address(tokenC), FEE, -120, 120, 300e18, 300e18);
        _mintV3(address(this), address(tokenA), address(weth), FEE, lo, hi, 1000e18, 1000e18);
    }

    function _exactInSingle(address tin, address tout, uint256 amountIn, address recipient)
        internal
        pure
        returns (IV3SwapRouter.ExactInputSingleParams memory)
    {
        return IV3SwapRouter.ExactInputSingleParams(tin, tout, FEE, recipient, amountIn, 0, 0);
    }

    // ------------------------------------------------------------ exact input

    function test_exactInputSingle_matchesQuoter() public {
        (uint256 quoted, uint160 pAfter, uint32 crossed,) = quoter.quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams(address(tokenA), address(tokenB), 50e18, FEE, 0)
        );
        uint256 before = tokenB.balanceOf(alice);
        vm.prank(alice);
        uint256 out = router.exactInputSingle(_exactInSingle(address(tokenA), address(tokenB), 50e18, alice));
        assertEq(out, quoted);
        assertEq(tokenB.balanceOf(alice) - before, out);
        (uint160 sqrtP,,,,,,) = poolAB.slot0();
        assertEq(sqrtP, pAfter);
        assertGe(crossed, 0);
    }

    function test_exactInputSingle_crossesTicks_quoterCountsThem() public {
        // 1500 of tokenA pushes the price below -600 and into/through the [-1800,-600] range
        (uint256 quoted,, uint32 crossed,) = quoter.quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams(address(tokenA), address(tokenB), 1500e18, FEE, 0)
        );
        assertGt(crossed, 0);
        uint256 out = router.exactInputSingle(_exactInSingle(address(tokenA), address(tokenB), 1500e18, address(this)));
        assertEq(out, quoted);
        (, int24 tick,,,,,) = poolAB.slot0();
        assertLt(tick, -600);
    }

    function test_exactInputSingle_slippageReverts() public {
        (uint256 quoted,,,) = quoter.quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams(address(tokenA), address(tokenB), 1e18, FEE, 0)
        );
        IV3SwapRouter.ExactInputSingleParams memory p = _exactInSingle(address(tokenA), address(tokenB), 1e18, alice);
        p.amountOutMinimum = quoted + 1;
        vm.expectRevert("Too little received");
        router.exactInputSingle(p);
    }

    function test_exactInput_multihop_matchesQuoter() public {
        bytes memory path = _encodePath(address(tokenA), FEE, address(tokenB), FEE, address(tokenC));
        (uint256 quoted, uint160[] memory prices, uint32[] memory crossed,) = quoter.quoteExactInput(path, 10e18);
        assertEq(prices.length, 2);
        assertEq(crossed.length, 2);
        uint256 before = tokenC.balanceOf(bob);
        uint256 out = router.exactInput(IV3SwapRouter.ExactInputParams(path, bob, 10e18, quoted));
        assertEq(out, quoted);
        assertEq(tokenC.balanceOf(bob) - before, quoted);
        (uint160 pAB,,,,,,) = poolAB.slot0();
        (uint160 pBC,,,,,,) = poolBC.slot0();
        assertEq(pAB, prices[0]);
        assertEq(pBC, prices[1]);
    }

    // ------------------------------------------------------------ exact output

    function test_exactOutputSingle_matchesQuoter() public {
        (uint256 quotedIn,,,) = quoter.quoteExactOutputSingle(
            IQuoterV2.QuoteExactOutputSingleParams(address(tokenB), address(tokenA), 7e18, FEE, 0)
        );
        uint256 balB = tokenB.balanceOf(alice);
        uint256 balA = tokenA.balanceOf(alice);
        vm.prank(alice);
        uint256 amountIn = router.exactOutputSingle(
            IV3SwapRouter.ExactOutputSingleParams(address(tokenB), address(tokenA), FEE, alice, 7e18, quotedIn, 0)
        );
        assertEq(amountIn, quotedIn);
        assertEq(balB - tokenB.balanceOf(alice), amountIn);
        assertEq(tokenA.balanceOf(alice) - balA, 7e18);

        vm.expectRevert("Too much requested");
        router.exactOutputSingle(
            IV3SwapRouter.ExactOutputSingleParams(address(tokenB), address(tokenA), FEE, alice, 7e18, 7e18, 0)
        );
    }

    function test_exactOutput_multihop_matchesQuoter() public {
        // exact output paths are encoded in reverse: tokenOut first
        bytes memory path = _encodePath(address(tokenC), FEE, address(tokenB), FEE, address(tokenA));
        (uint256 quotedIn,,,) = quoter.quoteExactOutput(path, 3e18);
        uint256 balA = tokenA.balanceOf(address(this));
        uint256 balC = tokenC.balanceOf(bob);
        uint256 amountIn = router.exactOutput(IV3SwapRouter.ExactOutputParams(path, bob, 3e18, quotedIn));
        assertEq(amountIn, quotedIn);
        assertEq(balA - tokenA.balanceOf(address(this)), amountIn);
        assertEq(tokenC.balanceOf(bob) - balC, 3e18);
    }

    // ------------------------------------------------------------ ETH handling + multicall

    function test_ethIn_exactInputSingle() public {
        uint256 ethBefore = alice.balance;
        uint256 wethBefore = weth.balanceOf(alice);
        vm.prank(alice);
        uint256 out = router.exactInputSingle{value: 1 ether}(_exactInSingle(address(weth), address(tokenA), 1 ether, alice));
        assertGt(out, 0);
        assertEq(ethBefore - alice.balance, 1 ether);
        assertEq(weth.balanceOf(alice), wethBefore);
    }

    function test_ethIn_exactOutput_refundETH_viaMulticallWithDeadline() public {
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            IV3SwapRouter.exactOutputSingle,
            (IV3SwapRouter.ExactOutputSingleParams(address(weth), address(tokenA), FEE, alice, 1e18, 2 ether, 0))
        );
        calls[1] = abi.encodeCall(IPeripheryPayments.refundETH, ());
        uint256 ethBefore = alice.balance;
        vm.prank(alice);
        router.multicall{value: 2 ether}(block.timestamp, calls);
        uint256 spent = ethBefore - alice.balance;
        assertGt(spent, 1e18);
        assertLt(spent, 1.01e18);
        assertEq(address(router).balance, 0);

        vm.prank(alice);
        vm.expectRevert("Transaction too old");
        router.multicall{value: 2 ether}(block.timestamp - 1, calls);
    }

    function test_ethOut_unwrapWETH9() public {
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            IV3SwapRouter.exactInputSingle,
            (IV3SwapRouter.ExactInputSingleParams(address(tokenA), address(weth), FEE, Constants.ADDRESS_THIS, 5e18, 0, 0))
        );
        calls[1] = abi.encodeWithSignature("unwrapWETH9(uint256,address)", uint256(1), bob);
        uint256 ethBefore = bob.balance;
        router.multicall(calls);
        assertGt(bob.balance - ethBefore, 4.9e18);
        assertEq(weth.balanceOf(address(router)), 0);
    }

    function test_sweepToken_and_msgSenderRecipient() public {
        // swap to the router (ADDRESS_THIS) and sweep to msg.sender
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            IV3SwapRouter.exactInputSingle,
            (IV3SwapRouter.ExactInputSingleParams(address(tokenA), address(tokenB), FEE, Constants.ADDRESS_THIS, 1e18, 0, 0))
        );
        calls[1] = abi.encodeWithSignature("sweepToken(address,uint256)", address(tokenB), uint256(1));
        uint256 before = tokenB.balanceOf(alice);
        vm.prank(alice);
        router.multicall(calls);
        assertGt(tokenB.balanceOf(alice), before);
        assertEq(tokenB.balanceOf(address(router)), 0);

        // MSG_SENDER recipient placeholder
        before = tokenB.balanceOf(bob);
        vm.prank(bob);
        router.exactInputSingle(_exactInSingle(address(tokenA), address(tokenB), 1e18, Constants.MSG_SENDER));
        assertGt(tokenB.balanceOf(bob), before);
    }

    function test_callbackOnlyFromPool() public {
        bytes memory data = abi.encode(
            _encodePath(address(tokenA), FEE, address(tokenB)), address(this)
        );
        vm.prank(alice);
        vm.expectRevert();
        router.uniswapV3SwapCallback(1e18, -1e18, data);
    }

    function test_missingPoolReverts() public {
        vm.expectRevert(bytes("PNF"));
        router.exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams(address(tokenA), address(tokenC), 500, alice, 1e18, 0, 0)
        );
    }

    // ------------------------------------------------------------ V2 through SwapRouter02

    function test_v2SwapsViaSwapRouter02() public {
        _addV2(address(this), address(tokenA), address(tokenB), 100e18, 100e18);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        uint256 expected = _v2AmountOut(1e18, 100e18, 100e18);
        uint256 before = tokenB.balanceOf(alice);
        vm.prank(alice);
        uint256 out = router.swapExactTokensForTokens(1e18, expected, path, alice);
        assertEq(out, expected);
        assertEq(tokenB.balanceOf(alice) - before, expected);

        vm.prank(alice);
        uint256 amountIn = router.swapTokensForExactTokens(1e18, type(uint256).max, path, alice);
        assertGt(amountIn, 1e18);

        vm.prank(alice);
        vm.expectRevert("Too little received");
        router.swapExactTokensForTokens(1e18, 1e18, path, alice);
    }

    // ------------------------------------------------------------ TickLens

    function test_tickLens_populatedTicksInWord() public view {
        // tick -600 -> compressed -10 -> word -1; ticks 600 -> word 0
        ITickLens.PopulatedTick[] memory word0 = tickLens.getPopulatedTicksInWord(address(poolAB), 0);
        ITickLens.PopulatedTick[] memory wordM1 = tickLens.getPopulatedTicksInWord(address(poolAB), -1);
        // word 0 contains tick 600 (compressed 10); word -1 contains -600 and -1800
        assertEq(word0.length, 1);
        assertEq(word0[0].tick, 600);
        assertEq(wordM1.length, 2);
        int24 total;
        for (uint256 i = 0; i < wordM1.length; i++) {
            (uint128 gross, int128 net,,,,,,) = poolAB.ticks(wordM1[i].tick);
            assertEq(wordM1[i].liquidityGross, gross);
            assertEq(wordM1[i].liquidityNet, net);
            total += wordM1[i].tick;
        }
        assertEq(total, -600 - 1800);
        // the full-range ticks live far away in their own words
        (int24 lo,) = _fullRange(60);
        int16 loWord = int16((lo / 60) >> 8);
        ITickLens.PopulatedTick[] memory wordLo = tickLens.getPopulatedTicksInWord(address(poolAB), loWord);
        assertEq(wordLo.length, 1);
        assertEq(wordLo[0].tick, lo);
    }

    // ------------------------------------------------------------ fuzz: quoter == execution

    function testFuzz_quoterEqualsSwap(uint96 amountIn, bool zeroForOne) public {
        amountIn = uint96(bound(amountIn, 1e9, 2000e18));
        (address tin, address tout) = zeroForOne ? (address(tokenA), address(tokenB)) : (address(tokenB), address(tokenA));
        (uint256 quoted,,,) =
            quoter.quoteExactInputSingle(IQuoterV2.QuoteExactInputSingleParams(tin, tout, amountIn, FEE, 0));
        uint256 out = router.exactInputSingle(_exactInSingle(tin, tout, amountIn, address(this)));
        assertEq(out, quoted);
    }
}
