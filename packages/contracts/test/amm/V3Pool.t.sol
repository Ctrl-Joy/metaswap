// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {AMMFixture} from "./utils/AMMFixture.sol";
import {IMetaSwapV3Pool} from "../../src/amm/v3/interfaces/IMetaSwapV3Pool.sol";
import {IMetaSwapV3MintCallback} from "../../src/amm/v3/interfaces/callback/IMetaSwapV3MintCallback.sol";
import {IMetaSwapV3SwapCallback} from "../../src/amm/v3/interfaces/callback/IMetaSwapV3SwapCallback.sol";
import {IMetaSwapV3FlashCallback} from "../../src/amm/v3/interfaces/callback/IMetaSwapV3FlashCallback.sol";
import {TickMath} from "../../src/amm/v3/libraries/TickMath.sol";
import {SqrtPriceMath} from "../../src/amm/v3/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "../../src/amm/v3/libraries/LiquidityAmounts.sol";
import {FullMath} from "../../src/amm/v3/libraries/FullMath.sol";
import {FixedPoint128} from "../../src/amm/v3/libraries/FixedPoint128.sol";
import {TestERC20} from "../../src/amm/tokens/TestERC20.sol";

contract V3PoolTest is AMMFixture, IMetaSwapV3MintCallback, IMetaSwapV3SwapCallback, IMetaSwapV3FlashCallback {
    IMetaSwapV3Pool internal pool;
    address internal t0;
    address internal t1;
    int24 internal constant SPACING = 60;
    uint24 internal constant FEE = 3000;

    bool internal flashRepay;

    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );

    function setUp() public {
        setUpAMM();
        t0 = address(tokenA);
        t1 = address(tokenB);
        pool = IMetaSwapV3Pool(v3Factory.createPool(t1, t0, FEE));
    }

    // ------------------------------------------------------------ callbacks (paid by this contract)

    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external {
        require(msg.sender == address(pool), "bad caller");
        if (amount0Owed > 0) TestERC20(t0).transfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) TestERC20(t1).transfer(msg.sender, amount1Owed);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        require(msg.sender == address(pool), "bad caller");
        if (amount0Delta > 0) TestERC20(t0).transfer(msg.sender, uint256(amount0Delta));
        if (amount1Delta > 0) TestERC20(t1).transfer(msg.sender, uint256(amount1Delta));
    }

    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external {
        (uint256 a0, uint256 a1) = abi.decode(data, (uint256, uint256));
        if (flashRepay) {
            TestERC20(t0).transfer(msg.sender, a0 + fee0);
            TestERC20(t1).transfer(msg.sender, a1 + fee1);
        }
    }

    // ------------------------------------------------------------ helpers

    function _swapExactIn(bool zeroForOne, uint256 amountIn) internal returns (int256 a0, int256 a1) {
        (a0, a1) = pool.swap(
            address(this),
            zeroForOne,
            int256(amountIn),
            zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
            ""
        );
    }

    function _tick() internal view returns (int24 tick) {
        (, tick,,,,,) = pool.slot0();
    }

    function _sqrtP() internal view returns (uint160 p) {
        (p,,,,,,) = pool.slot0();
    }

    function _owed(address owner, int24 lower, int24 upper) internal view returns (uint128 o0, uint128 o1) {
        (,,, o0, o1) = pool.positions(keccak256(abi.encodePacked(owner, lower, upper)));
    }

    // ------------------------------------------------------------ factory

    function test_factory_feeTiers() public view {
        assertEq(v3Factory.feeAmountTickSpacing(100), 1);
        assertEq(v3Factory.feeAmountTickSpacing(500), 10);
        assertEq(v3Factory.feeAmountTickSpacing(3000), 60);
        assertEq(v3Factory.feeAmountTickSpacing(10000), 200);
        assertEq(v3Factory.owner(), address(this));
    }

    function test_factory_createPool() public {
        assertEq(v3Factory.getPool(t0, t1, FEE), address(pool));
        assertEq(v3Factory.getPool(t1, t0, FEE), address(pool));
        assertEq(pool.token0(), t0);
        assertEq(pool.token1(), t1);
        assertEq(pool.fee(), FEE);
        assertEq(pool.tickSpacing(), SPACING);
        assertEq(pool.factory(), address(v3Factory));
        vm.expectRevert();
        v3Factory.createPool(t0, t1, FEE);
        vm.expectRevert();
        v3Factory.createPool(t0, t1, 1234); // fee not enabled
        vm.expectRevert();
        v3Factory.createPool(t0, t0, 500);
        address p100 = v3Factory.createPool(t0, t1, 100);
        assertEq(IMetaSwapV3Pool(p100).tickSpacing(), 1);
    }

    function test_factory_enableFeeAmount_ownerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        v3Factory.enableFeeAmount(2500, 50);
        v3Factory.enableFeeAmount(2500, 50);
        assertEq(v3Factory.feeAmountTickSpacing(2500), 50);
        vm.expectRevert();
        v3Factory.enableFeeAmount(2500, 50);
        v3Factory.setOwner(alice);
        assertEq(v3Factory.owner(), alice);
    }

    // ------------------------------------------------------------ initialize / mint / burn

    function test_initialize() public {
        uint160 p = TickMath.getSqrtRatioAtTick(1200);
        pool.initialize(p);
        (uint160 sqrtP, int24 tick,, uint16 card, uint16 cardNext,, bool unlocked) = pool.slot0();
        assertEq(sqrtP, p);
        assertEq(tick, 1200);
        assertEq(card, 1);
        assertEq(cardNext, 1);
        assertTrue(unlocked);
        vm.expectRevert();
        pool.initialize(p);
    }

    function test_mint_amountsMatchSqrtPriceMath() public {
        pool.initialize(SQRT_1_1);
        uint128 L = 1e21;
        // in range
        (uint256 a0, uint256 a1) = pool.mint(alice, -600, 600, L, "");
        assertEq(a0, SqrtPriceMath.getAmount0Delta(SQRT_1_1, TickMath.getSqrtRatioAtTick(600), L, true));
        assertEq(a1, SqrtPriceMath.getAmount1Delta(TickMath.getSqrtRatioAtTick(-600), SQRT_1_1, L, true));
        assertEq(pool.liquidity(), L);
        // above current price -> token0 only, no active liquidity change
        (a0, a1) = pool.mint(alice, 600, 1200, L, "");
        assertGt(a0, 0);
        assertEq(a1, 0);
        // below current price -> token1 only
        (a0, a1) = pool.mint(alice, -1200, -600, L, "");
        assertEq(a0, 0);
        assertGt(a1, 0);
        assertEq(pool.liquidity(), L);
        (uint128 gross, int128 net,,,,,, bool init) = pool.ticks(600);
        assertEq(gross, 2 * L);
        assertEq(net, 0); // upper of first (-L) + lower of second (+L)
        assertTrue(init);
    }

    function test_mint_reverts() public {
        vm.expectRevert(); // not initialized (locked)
        pool.mint(alice, -60, 60, 1e18, "");
        pool.initialize(SQRT_1_1);
        vm.expectRevert(); // tick not multiple of spacing
        pool.mint(alice, -61, 60, 1e18, "");
        vm.expectRevert(); // zero liquidity
        pool.mint(alice, -60, 60, 0, "");
        vm.expectRevert(); // lower >= upper
        pool.mint(alice, 60, -60, 1e18, "");
    }

    function test_burn_and_collect() public {
        pool.initialize(SQRT_1_1);
        (uint256 m0, uint256 m1) = pool.mint(alice, -600, 600, 1e21, "");
        vm.startPrank(alice);
        (uint256 b0, uint256 b1) = pool.burn(-600, 600, 1e21);
        // burns round down, mints round up
        assertApproxEqAbs(b0, m0, 1);
        assertApproxEqAbs(b1, m1, 1);
        (uint128 o0, uint128 o1) = _owed(alice, -600, 600);
        assertEq(o0, b0);
        assertEq(o1, b1);
        uint256 before0 = tokenA.balanceOf(bob);
        (uint128 c0, uint128 c1) = pool.collect(bob, -600, 600, type(uint128).max, type(uint128).max);
        vm.stopPrank();
        assertEq(c0, b0);
        assertEq(c1, b1);
        assertEq(tokenA.balanceOf(bob) - before0, b0);
        assertEq(pool.liquidity(), 0);
        (uint128 gross,,,,,,,) = pool.ticks(-600);
        assertEq(gross, 0);
    }

    // ------------------------------------------------------------ swaps

    function test_swap_exactIn_withinRange_matchesSwapMath() public {
        pool.initialize(SQRT_1_1);
        uint128 L = 1e24;
        pool.mint(alice, -6000, 6000, L, "");
        uint256 amountIn = 1e18;
        uint256 afterFee = amountIn * (1e6 - FEE) / 1e6;
        uint160 expectedP = SqrtPriceMath.getNextSqrtPriceFromInput(SQRT_1_1, L, afterFee, true);
        uint256 expectedOut = SqrtPriceMath.getAmount1Delta(expectedP, SQRT_1_1, L, false);
        (int256 a0, int256 a1) = _swapExactIn(true, amountIn);
        assertEq(a0, int256(amountIn));
        assertEq(-a1, int256(expectedOut));
        // price within 1 wei of the analytical result (fee rounding)
        assertApproxEqAbs(_sqrtP(), expectedP, 1);
    }

    function test_swap_exactOut() public {
        pool.initialize(SQRT_1_1);
        pool.mint(alice, -6000, 6000, 1e24, "");
        (int256 a0, int256 a1) = pool.swap(address(this), false, -int256(5e17), TickMath.MAX_SQRT_RATIO - 1, "");
        assertEq(a0, -5e17);
        assertGt(a1, 5e17); // paid more than received (fee + price impact)
    }

    function test_swap_priceLimit() public {
        pool.initialize(SQRT_1_1);
        pool.mint(alice, -6000, 6000, 1e24, "");
        uint160 limit = TickMath.getSqrtRatioAtTick(-60);
        pool.swap(address(this), true, int256(1e30), limit, "");
        assertEq(_sqrtP(), limit);
        vm.expectRevert(); // limit on the wrong side
        pool.swap(address(this), true, 1e18, TickMath.getSqrtRatioAtTick(60), "");
    }

    function test_swap_crossesInitializedTicks() public {
        pool.initialize(SQRT_1_1);
        uint128 wide = 1e21;
        uint128 narrow = 5e21;
        pool.mint(alice, -6000, 6000, wide, "");
        pool.mint(bob, -120, 120, narrow, "");
        assertEq(pool.liquidity(), wide + narrow);

        // big token0 -> token1 swap pushes price below -120: narrow liquidity is crossed out
        _swapExactIn(true, 50e18);
        int24 tick = _tick();
        assertLt(tick, -120);
        assertEq(pool.liquidity(), wide);
        // feeGrowthOutside flipped at the crossed tick
        (,, uint256 fgo0,,,,,) = pool.ticks(-120);
        assertGt(fgo0, 0);

        // swap back across both ticks of the narrow range and above it
        _swapExactIn(false, 200e18);
        assertGt(_tick(), 120);
        assertEq(pool.liquidity(), wide);

        // back into the narrow range
        pool.swap(address(this), true, 1e30, TickMath.getSqrtRatioAtTick(0), "");
        // landing exactly on a tick boundary while moving down leaves tick = boundary - 1
        assertEq(_tick(), -1);
        assertEq(_sqrtP(), TickMath.getSqrtRatioAtTick(0));
        assertEq(pool.liquidity(), wide + narrow);
    }

    function test_swap_emitsEvent() public {
        pool.initialize(SQRT_1_1);
        pool.mint(alice, -600, 600, 1e22, "");
        vm.expectEmit(true, true, false, false, address(pool));
        emit Swap(address(this), bob, 0, 0, 0, 0, 0);
        pool.swap(bob, true, 1e15, TickMath.MIN_SQRT_RATIO + 1, "");
    }

    function test_fees_accrueOnlyToInRangePositions() public {
        pool.initialize(SQRT_1_1);
        uint128 L = 1e22;
        pool.mint(alice, -600, 600, L, ""); // in range
        pool.mint(bob, 600, 1200, L, ""); // out of range (above)
        pool.mint(address(this), -1200, 1200, L, ""); // in range, same liquidity as alice

        uint256 amountIn = 1e18;
        _swapExactIn(true, amountIn);

        // poke positions to update tokensOwed
        vm.prank(alice);
        pool.burn(-600, 600, 0);
        vm.prank(bob);
        pool.burn(600, 1200, 0);
        pool.burn(-1200, 1200, 0);

        (uint128 aliceFee0, uint128 aliceFee1) = _owed(alice, -600, 600);
        (uint128 bobFee0, uint128 bobFee1) = _owed(bob, 600, 1200);
        (uint128 meFee0,) = _owed(address(this), -1200, 1200);

        uint256 totalFee = amountIn * FEE / 1e6; // fee in token0
        assertEq(bobFee0, 0);
        assertEq(bobFee1, 0);
        assertEq(aliceFee1, 0); // only token0 paid in
        // two in-range positions with equal liquidity split the fee
        assertApproxEqAbs(aliceFee0, totalFee / 2, 2);
        assertApproxEqAbs(meFee0, totalFee / 2, 2);
        assertEq(pool.feeGrowthGlobal0X128(), FullMath.mulDiv(totalFee, FixedPoint128.Q128, 2 * L));

        // collect pays out the fee
        vm.prank(alice);
        (uint128 c0,) = pool.collect(alice, -600, 600, type(uint128).max, type(uint128).max);
        assertEq(c0, aliceFee0);
    }

    function test_protocolFee() public {
        pool.initialize(SQRT_1_1);
        pool.mint(alice, -600, 600, 1e22, "");
        vm.prank(alice);
        vm.expectRevert();
        pool.setFeeProtocol(4, 4);
        pool.setFeeProtocol(4, 4); // 1/4 of swap fees
        _swapExactIn(true, 1e18);
        (uint128 p0, uint128 p1) = pool.protocolFees();
        assertEq(p0, uint128((uint256(1e18) * FEE / 1e6) / 4));
        assertEq(p1, 0);
        uint256 before = tokenA.balanceOf(bob);
        pool.collectProtocol(bob, type(uint128).max, type(uint128).max);
        // collectProtocol leaves 1 wei in the slot to save gas
        assertEq(tokenA.balanceOf(bob) - before, p0 - 1);
    }

    // ------------------------------------------------------------ oracle

    function test_oracle_observe_timeWeightedTick() public {
        pool.initialize(SQRT_1_1);
        pool.mint(alice, -60000, 60000, 1e22, "");
        pool.increaseObservationCardinalityNext(10);
        (,,,, uint16 cardNext,,) = pool.slot0();
        assertEq(cardNext, 10);

        vm.warp(block.timestamp + 100); // 100s at tick 0
        _swapExactIn(true, 3e20);
        int24 tick1 = _tick();
        assertLt(tick1, 0);
        vm.warp(block.timestamp + 50); // 50s at tick1

        uint32[] memory ago = new uint32[](3);
        ago[0] = 150;
        ago[1] = 50;
        ago[2] = 0;
        (int56[] memory tickCum, uint160[] memory secPerLiq) = pool.observe(ago);
        // [150s ago .. 50s ago] the tick was 0; [50s ago .. now] it was tick1
        assertEq(tickCum[1] - tickCum[0], 0);
        assertEq(tickCum[2] - tickCum[1], int56(tick1) * 50);
        int24 twap = int24((tickCum[2] - tickCum[0]) / 150);
        assertEq(twap, int24((int56(tick1) * 50) / 150));
        assertGt(secPerLiq[2], secPerLiq[0]);

        vm.expectRevert(); // older than the oldest observation
        ago[0] = 10_000;
        pool.observe(ago);
    }

    function test_snapshotCumulativesInside() public {
        pool.initialize(SQRT_1_1);
        pool.mint(alice, -600, 600, 1e22, "");
        (, , uint32 s0) = pool.snapshotCumulativesInside(-600, 600);
        vm.warp(block.timestamp + 42);
        (, , uint32 s1) = pool.snapshotCumulativesInside(-600, 600);
        assertEq(s1 - s0, 42);
    }

    // ------------------------------------------------------------ flash

    function test_flash() public {
        pool.initialize(SQRT_1_1);
        pool.mint(alice, -600, 600, 1e22, "");
        vm.expectRevert(); // not repaid
        pool.flash(address(this), 1e18, 1e18, abi.encode(uint256(1e18), uint256(1e18)));
        flashRepay = true;
        pool.flash(address(this), 1e18, 2e18, abi.encode(uint256(1e18), uint256(2e18)));
        // fee = amount * fee / 1e6 rounded up, credited as fee growth to LPs
        uint256 fee0 = uint256(1e18) * FEE / 1e6;
        assertEq(pool.feeGrowthGlobal0X128(), FullMath.mulDiv(fee0, FixedPoint128.Q128, 1e22));
    }

    function test_reentrancyLock_noDelegateCall() public {
        pool.initialize(SQRT_1_1);
        // delegatecall into the pool's mutators is blocked by NoDelegateCall
        (bool ok,) = address(pool).delegatecall(
            abi.encodeWithSelector(pool.swap.selector, address(this), true, int256(1), TickMath.MIN_SQRT_RATIO + 1, "")
        );
        assertFalse(ok);
    }
}
