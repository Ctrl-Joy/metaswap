// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "../../src/amm/v3/libraries/TickMath.sol";
import {SqrtPriceMath} from "../../src/amm/v3/libraries/SqrtPriceMath.sol";
import {FullMath} from "../../src/amm/v3/libraries/FullMath.sol";
import {SwapMath} from "../../src/amm/v3/libraries/SwapMath.sol";
import {LiquidityMath} from "../../src/amm/v3/libraries/LiquidityMath.sol";
import {LiquidityAmounts} from "../../src/amm/v3/libraries/LiquidityAmounts.sol";
import {BitMath} from "../../src/amm/v3/libraries/BitMath.sol";
import {MetaSwapConfig} from "../../script/lib/MetaSwapConfig.sol";

/// @dev External wrapper so reverts from library code can be asserted with expectRevert.
contract MathHarness {
    function getSqrtRatioAtTick(int24 t) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(t);
    }

    function getTickAtSqrtRatio(uint160 p) external pure returns (int24) {
        return TickMath.getTickAtSqrtRatio(p);
    }

    function mulDiv(uint256 a, uint256 b, uint256 d) external pure returns (uint256) {
        return FullMath.mulDiv(a, b, d);
    }
}

contract V3MathFuzzTest is Test {
    MathHarness internal h = new MathHarness();

    // ------------------------------------------------------------ TickMath

    function test_tickMath_knownValues() public view {
        assertEq(h.getSqrtRatioAtTick(0), 79228162514264337593543950336);
        assertEq(h.getSqrtRatioAtTick(TickMath.MIN_TICK), TickMath.MIN_SQRT_RATIO);
        assertEq(h.getSqrtRatioAtTick(TickMath.MAX_TICK), TickMath.MAX_SQRT_RATIO);
        assertEq(h.getTickAtSqrtRatio(TickMath.MIN_SQRT_RATIO), TickMath.MIN_TICK);
        assertEq(h.getTickAtSqrtRatio(TickMath.MAX_SQRT_RATIO - 1), TickMath.MAX_TICK - 1);
    }

    function test_tickMath_boundsRevert() public {
        vm.expectRevert();
        h.getSqrtRatioAtTick(TickMath.MAX_TICK + 1);
        vm.expectRevert();
        h.getSqrtRatioAtTick(TickMath.MIN_TICK - 1);
        vm.expectRevert();
        h.getTickAtSqrtRatio(TickMath.MAX_SQRT_RATIO);
        vm.expectRevert();
        h.getTickAtSqrtRatio(TickMath.MIN_SQRT_RATIO - 1);
    }

    function testFuzz_tickMath_roundTripTick(int24 tick) public pure {
        tick = int24(bound(tick, TickMath.MIN_TICK, TickMath.MAX_TICK - 1));
        uint160 p = TickMath.getSqrtRatioAtTick(tick);
        assertEq(TickMath.getTickAtSqrtRatio(p), tick);
    }

    function testFuzz_tickMath_roundTripPrice(uint160 p) public pure {
        p = uint160(bound(p, TickMath.MIN_SQRT_RATIO, TickMath.MAX_SQRT_RATIO - 1));
        int24 tick = TickMath.getTickAtSqrtRatio(p);
        assertLe(TickMath.getSqrtRatioAtTick(tick), p);
        if (tick < TickMath.MAX_TICK) assertGt(TickMath.getSqrtRatioAtTick(tick + 1), p);
    }

    function testFuzz_tickMath_monotonic(int24 a, int24 b) public pure {
        a = int24(bound(a, TickMath.MIN_TICK, TickMath.MAX_TICK));
        b = int24(bound(b, TickMath.MIN_TICK, TickMath.MAX_TICK));
        vm.assume(a < b);
        assertLt(TickMath.getSqrtRatioAtTick(a), TickMath.getSqrtRatioAtTick(b));
    }

    // ------------------------------------------------------------ FullMath

    function testFuzz_fullMath_matchesNative(uint128 a, uint128 b, uint256 d) public pure {
        vm.assume(d > 0);
        uint256 exact = uint256(a) * uint256(b);
        assertEq(FullMath.mulDiv(a, b, d), exact / d);
        assertEq(FullMath.mulDivRoundingUp(a, b, d), exact / d + (exact % d > 0 ? 1 : 0));
    }

    function testFuzz_fullMath_512bitIdentity(uint256 x, uint256 y) public pure {
        vm.assume(y > 0);
        // x * y / y == x even though x * y overflows 256 bits
        assertEq(FullMath.mulDiv(x, y, y), x);
    }

    function testFuzz_fullMath_phantomOverflow(uint256 a, uint256 b, uint256 d) public pure {
        // compare against a 512-bit-safe computation for cases where the result fits
        a = bound(a, 1, type(uint256).max);
        b = bound(b, 1, type(uint256).max);
        d = bound(d, 1, type(uint256).max);
        // ensure result fits: require a <= d (then a*b/d <= b)
        vm.assume(a <= d);
        uint256 r = FullMath.mulDiv(a, b, d);
        assertLe(r, b);
        // r*d <= a*b < (r+1)*d  checked via mulDiv identities
        uint256 back = FullMath.mulDiv(r, d, b);
        assertLe(back, a);
    }

    function test_fullMath_overflowReverts() public {
        vm.expectRevert();
        h.mulDiv(type(uint256).max, type(uint256).max, 1);
        vm.expectRevert();
        h.mulDiv(1, 1, 0);
    }

    // ------------------------------------------------------------ SqrtPriceMath / SwapMath

    function testFuzz_sqrtPriceMath_inputRoundTrip(uint160 p, uint128 liquidity, uint96 amountIn, bool zeroForOne)
        public
        pure
    {
        p = uint160(bound(p, TickMath.getSqrtRatioAtTick(-200000), TickMath.getSqrtRatioAtTick(200000)));
        liquidity = uint128(bound(liquidity, 1e12, type(uint96).max));
        vm.assume(amountIn > 0);
        uint160 next = SqrtPriceMath.getNextSqrtPriceFromInput(p, liquidity, amountIn, zeroForOne);
        if (zeroForOne) {
            assertLe(next, p);
            // the amount required to move the price there never exceeds the provided input
            assertLe(SqrtPriceMath.getAmount0Delta(next, p, liquidity, true), amountIn);
        } else {
            assertGe(next, p);
            assertLe(SqrtPriceMath.getAmount1Delta(p, next, liquidity, true), amountIn);
        }
    }

    function testFuzz_sqrtPriceMath_outputRoundTrip(uint160 p, uint128 liquidity, uint64 amountOut, bool zeroForOne)
        public
        pure
    {
        p = uint160(bound(p, TickMath.getSqrtRatioAtTick(-100000), TickMath.getSqrtRatioAtTick(100000)));
        liquidity = uint128(bound(liquidity, 1e20, type(uint96).max));
        vm.assume(amountOut > 0);
        // cannot take out more than half of what the curve holds on that side (beyond that it reverts by design)
        uint256 available = zeroForOne
            ? SqrtPriceMath.getAmount1Delta(TickMath.MIN_SQRT_RATIO, p, liquidity, false)
            : SqrtPriceMath.getAmount0Delta(p, TickMath.MAX_SQRT_RATIO, liquidity, false);
        vm.assume(amountOut < available / 2);
        uint160 next = SqrtPriceMath.getNextSqrtPriceFromOutput(p, liquidity, amountOut, zeroForOne);
        if (zeroForOne) {
            assertGe(SqrtPriceMath.getAmount1Delta(next, p, liquidity, false), amountOut);
        } else {
            assertGe(SqrtPriceMath.getAmount0Delta(p, next, liquidity, false), amountOut);
        }
    }

    function testFuzz_amountDeltas_roundingUpGeDown(uint160 a, uint160 b, uint128 liquidity) public pure {
        a = uint160(bound(a, TickMath.MIN_SQRT_RATIO, TickMath.MAX_SQRT_RATIO));
        b = uint160(bound(b, TickMath.MIN_SQRT_RATIO, TickMath.MAX_SQRT_RATIO));
        uint256 up0 = SqrtPriceMath.getAmount0Delta(a, b, liquidity, true);
        uint256 down0 = SqrtPriceMath.getAmount0Delta(a, b, liquidity, false);
        assertGe(up0, down0);
        assertLe(up0 - down0, 1);
        uint256 up1 = SqrtPriceMath.getAmount1Delta(a, b, liquidity, true);
        uint256 down1 = SqrtPriceMath.getAmount1Delta(a, b, liquidity, false);
        assertGe(up1, down1);
        assertLe(up1 - down1, 1);
    }

    function testFuzz_swapStep_exactInNeverExceedsRemaining(
        uint160 current,
        uint160 target,
        uint128 liquidity,
        uint96 remaining,
        uint24 fee
    ) public pure {
        current = uint160(bound(current, TickMath.MIN_SQRT_RATIO, TickMath.MAX_SQRT_RATIO - 1));
        target = uint160(bound(target, TickMath.MIN_SQRT_RATIO, TickMath.MAX_SQRT_RATIO - 1));
        fee = uint24(bound(fee, 0, 999_999));
        vm.assume(remaining > 0 && current != target);
        (uint160 next, uint256 amountIn, uint256 amountOut, uint256 feeAmount) =
            SwapMath.computeSwapStep(current, target, liquidity, int256(uint256(remaining)), fee);
        assertLe(amountIn + feeAmount, remaining);
        bool zeroForOne = current >= target;
        if (zeroForOne) {
            assertLe(next, current);
            assertGe(next, target);
        } else {
            assertGe(next, current);
            assertLe(next, target);
        }
        // never pays out more than the curve allows
        if (zeroForOne) assertLe(amountOut, SqrtPriceMath.getAmount1Delta(next, current, liquidity, false));
        else assertLe(amountOut, SqrtPriceMath.getAmount0Delta(current, next, liquidity, false));
    }

    // ------------------------------------------------------------ misc

    function testFuzz_liquidityMath_addDelta(uint128 x, int128 y) public pure {
        int256 r = int256(uint256(x)) + int256(y);
        vm.assume(r >= 0 && r <= int256(uint256(type(uint128).max)));
        assertEq(LiquidityMath.addDelta(x, y), uint128(uint256(r)));
    }

    function testFuzz_bitMath(uint256 x) public pure {
        vm.assume(x > 0);
        uint8 msb = BitMath.mostSignificantBit(x);
        assertTrue(x >= (uint256(1) << msb));
        if (msb < 255) assertTrue(x < (uint256(1) << (msb + 1)));
        uint8 lsb = BitMath.leastSignificantBit(x);
        assertTrue(x & (uint256(1) << lsb) != 0);
        assertEq(x & ((uint256(1) << lsb) - 1), 0);
    }

    function testFuzz_liquidityAmounts_roundTrip(int24 lower, int24 upper, uint96 a0, uint96 a1) public pure {
        lower = int24(bound(lower, -100000, 99000));
        upper = int24(bound(upper, int256(lower) + 10, 100000));
        uint160 pa = TickMath.getSqrtRatioAtTick(lower);
        uint160 pb = TickMath.getSqrtRatioAtTick(upper);
        uint160 p = TickMath.getSqrtRatioAtTick(0);
        uint128 L = LiquidityAmounts.getLiquidityForAmounts(p, pa, pb, a0, a1);
        (uint256 n0, uint256 n1) = LiquidityAmounts.getAmountsForLiquidity(p, pa, pb, L);
        assertLe(n0, a0);
        assertLe(n1, a1);
    }

    // ------------------------------------------------------------ seed price helper (script/lib)

    function test_seedSqrtPrice_decimalsAndOrdering() public pure {
        // WETH (18 dec, $3000) as token0, mUSDC (6 dec, $1) as token1: raw price = 3000 * 1e6 / 1e18 = 3e-9
        uint160 p = MetaSwapConfig.sqrtPriceX96(3000e6, 18, 1e6, 6);
        int24 tick = TickMath.getTickAtSqrtRatio(p);
        // tick = floor(log_1.0001(price))
        assertEq(tick, -196257); // ln(3e-9)/ln(1.0001) = -196256.35
        // mUSDC as token0, WETH as token1: raw price = 1e18 / (3000 * 1e6)
        uint160 q = MetaSwapConfig.sqrtPriceX96(1e6, 6, 3000e6, 18);
        assertEq(TickMath.getTickAtSqrtRatio(q), 196256);
        // stablecoin pair with different decimals: mDAI(18)/mUSDC(6)
        assertEq(TickMath.getTickAtSqrtRatio(MetaSwapConfig.sqrtPriceX96(1e6, 18, 1e6, 6)), -276325);
        // 1:1 same decimals
        assertEq(MetaSwapConfig.sqrtPriceX96(1e6, 18, 1e6, 18), 79228162514264337593543950336);
    }

    function test_seedHelpers_ticks() public pure {
        assertEq(MetaSwapConfig.minUsableTick(60), -887220);
        assertEq(MetaSwapConfig.maxUsableTick(60), 887220);
        assertEq(MetaSwapConfig.floorTick(-61, 60), -120);
        assertEq(MetaSwapConfig.floorTick(61, 60), 60);
        assertEq(MetaSwapConfig.floorTick(-60, 60), -60);
        assertEq(MetaSwapConfig.usdToAmount(10_000e6, 3000e6, 18), 3333333333333333333);
        assertEq(MetaSwapConfig.usdToAmount(10_000e6, 1e6, 6), 10_000e6);
    }
}
