// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {AMMFixture} from "./utils/AMMFixture.sol";
import {MetaSwapV2Pair} from "../../src/amm/v2/MetaSwapV2Pair.sol";
import {IMetaSwapV2Pair} from "../../src/amm/v2/interfaces/IMetaSwapV2Pair.sol";
import {IMetaSwapV2Callee} from "../../src/amm/v2/interfaces/IMetaSwapV2Callee.sol";
import {MetaSwapV2OracleLibrary} from "../../src/amm/v2/libraries/MetaSwapV2OracleLibrary.sol";
import {TestERC20} from "../../src/amm/tokens/TestERC20.sol";

contract FlashBorrower is IMetaSwapV2Callee {
    bool public repay;
    uint256 public seenAmount0;

    function setRepay(bool r) external {
        repay = r;
    }

    function uniswapV2Call(address, uint256 amount0, uint256, bytes calldata data) external {
        seenAmount0 = amount0;
        address token0 = IMetaSwapV2Pair(msg.sender).token0();
        if (repay) {
            // repay principal + 0.3% fee (rounded up)
            uint256 fee = (amount0 * 3) / 997 + 1;
            TestERC20(token0).transfer(msg.sender, amount0 + fee);
        }
        abi.decode(data, (uint256));
    }
}

contract V2PairTest is AMMFixture {
    MetaSwapV2Pair internal pair;
    address internal t0;
    address internal t1;

    event Sync(uint112 reserve0, uint112 reserve1);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    function setUp() public {
        setUpAMM();
        pair = MetaSwapV2Pair(v2Factory.createPair(address(tokenB), address(tokenA)));
        t0 = address(tokenA);
        t1 = address(tokenB);
    }

    function _addLiquidity(uint256 a0, uint256 a1) internal returns (uint256 liq) {
        tokenA.transfer(address(pair), a0);
        tokenB.transfer(address(pair), a1);
        liq = pair.mint(address(this));
    }

    function test_factory_createPair_sortsAndRegisters() public view {
        assertEq(pair.token0(), t0);
        assertEq(pair.token1(), t1);
        assertEq(pair.factory(), address(v2Factory));
        assertEq(v2Factory.getPair(t0, t1), address(pair));
        assertEq(v2Factory.getPair(t1, t0), address(pair));
        assertEq(v2Factory.allPairsLength(), 1);
        assertEq(v2Factory.allPairs(0), address(pair));
        assertEq(pair.name(), "MetaSwap V2");
        assertEq(pair.symbol(), "MS-V2");
        assertEq(pair.decimals(), 18);
    }

    function test_factory_createPair_emitsAndIsCreate2() public {
        TestERC20 x = new TestERC20("X", "X", 18, 0);
        (address a, address b) = address(x) < address(tokenC) ? (address(x), address(tokenC)) : (address(tokenC), address(x));
        address expected = vm.computeCreate2Address(
            keccak256(abi.encodePacked(a, b)), v2Factory.pairCodeHash(), address(v2Factory)
        );
        vm.expectEmit(true, true, false, true);
        emit PairCreated(a, b, expected, 2);
        address p = v2Factory.createPair(address(tokenC), address(x));
        assertEq(p, expected);
    }

    function test_factory_createPair_reverts() public {
        vm.expectRevert("MetaSwapV2: PAIR_EXISTS");
        v2Factory.createPair(t0, t1);
        vm.expectRevert("MetaSwapV2: IDENTICAL_ADDRESSES");
        v2Factory.createPair(t0, t0);
        vm.expectRevert("MetaSwapV2: ZERO_ADDRESS");
        v2Factory.createPair(address(0), t0);
    }

    function test_factory_feeToSetterAuth() public {
        vm.expectRevert("MetaSwapV2: FORBIDDEN");
        v2Factory.setFeeTo(alice);
        vm.prank(feeSetter);
        v2Factory.setFeeTo(alice);
        assertEq(v2Factory.feeTo(), alice);
        vm.prank(feeSetter);
        v2Factory.setFeeToSetter(bob);
        assertEq(v2Factory.feeToSetter(), bob);
        vm.expectRevert("MetaSwapV2: FORBIDDEN");
        vm.prank(feeSetter);
        v2Factory.setFeeTo(bob);
    }

    function test_mint_initial() public {
        uint256 a0 = 1e18;
        uint256 a1 = 4e18;
        tokenA.transfer(address(pair), a0);
        tokenB.transfer(address(pair), a1);
        vm.expectEmit(false, false, false, true, address(pair));
        emit Sync(uint112(a0), uint112(a1));
        uint256 liq = pair.mint(address(this));
        // sqrt(1e18 * 4e18) = 2e18
        assertEq(liq, 2e18 - 1000);
        assertEq(pair.totalSupply(), 2e18);
        assertEq(pair.balanceOf(address(0)), 1000);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, a0);
        assertEq(r1, a1);
    }

    function test_mint_proportional_takesMin() public {
        _addLiquidity(1e18, 4e18);
        uint256 ts = pair.totalSupply();
        // unbalanced deposit: liquidity is the min of the two ratios
        uint256 liq = _addLiquidity(1e18, 8e18);
        assertEq(liq, ts); // min(1e18*ts/1e18, 8e18*ts/4e18) = ts
    }

    function test_mint_revertsInsufficient() public {
        tokenA.transfer(address(pair), 1000);
        tokenB.transfer(address(pair), 1000);
        vm.expectRevert(); // sqrt(1e6)=1000 - 1000 = 0 -> INSUFFICIENT_LIQUIDITY_MINTED
        pair.mint(address(this));
    }

    function test_burn_returnsProRata() public {
        uint256 liq = _addLiquidity(3e18, 3e18);
        uint256 bal0 = tokenA.balanceOf(address(this));
        uint256 bal1 = tokenB.balanceOf(address(this));
        pair.transfer(address(pair), liq);
        (uint256 out0, uint256 out1) = pair.burn(address(this));
        assertEq(out0, 3e18 - 1000);
        assertEq(out1, 3e18 - 1000);
        assertEq(tokenA.balanceOf(address(this)) - bal0, out0);
        assertEq(tokenB.balanceOf(address(this)) - bal1, out1);
        assertEq(pair.totalSupply(), 1000);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 1000);
        assertEq(r1, 1000);
    }

    /// Swap test cases from Uniswap V2's test-suite: [swapAmount, token0Amount, token1Amount, expectedOutputAmount]
    function test_swap_getInputPriceCases() public {
        uint256[4][7] memory cases = [
            [uint256(1e18), 5e18, 10e18, 1662497915624478906],
            [uint256(1e18), 10e18, 5e18, 453305446940074565],
            [uint256(2e18), 5e18, 10e18, 2851015155847869602],
            [uint256(2e18), 10e18, 5e18, 831248957812239453],
            [uint256(1e18), 10e18, 10e18, 906610893880149131],
            [uint256(1e18), 100e18, 100e18, 987158034397061298],
            [uint256(1e18), 1000e18, 1000e18, 996006981039903216]
        ];
        for (uint256 i = 0; i < cases.length; i++) {
            uint256 snap = vm.snapshotState();
            _addLiquidity(cases[i][1], cases[i][2]);
            tokenA.transfer(address(pair), cases[i][0]);
            vm.expectRevert("MetaSwapV2: K");
            pair.swap(0, cases[i][3] + 1, address(this), "");
            pair.swap(0, cases[i][3], address(this), "");
            vm.revertToState(snap);
        }
    }

    function test_swap_token0_matchesFormula_andUpdatesReserves() public {
        _addLiquidity(5e18, 10e18);
        uint256 amountIn = 1e18;
        uint256 expected = _v2AmountOut(amountIn, 5e18, 10e18);
        assertEq(expected, 1662497915624478906);
        tokenA.transfer(address(pair), amountIn);
        uint256 before = tokenB.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(pair));
        emit Swap(address(this), amountIn, 0, 0, expected, alice);
        pair.swap(0, expected, alice, "");
        assertEq(tokenB.balanceOf(alice) - before, expected);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 6e18);
        assertEq(r1, 10e18 - expected);
    }

    function test_swap_token1() public {
        _addLiquidity(5e18, 10e18);
        uint256 amountIn = 1e18;
        uint256 expected = _v2AmountOut(amountIn, 10e18, 5e18);
        assertEq(expected, 453305446940074565);
        tokenB.transfer(address(pair), amountIn);
        pair.swap(expected, 0, address(this), "");
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 5e18 - expected);
        assertEq(r1, 11e18);
    }

    function test_swap_reverts() public {
        _addLiquidity(5e18, 10e18);
        vm.expectRevert("MetaSwapV2: INSUFFICIENT_OUTPUT_AMOUNT");
        pair.swap(0, 0, address(this), "");
        vm.expectRevert("MetaSwapV2: INSUFFICIENT_LIQUIDITY");
        pair.swap(5e18, 0, address(this), "");
        vm.expectRevert("MetaSwapV2: INVALID_TO");
        pair.swap(1, 0, t0, "");
        vm.expectRevert("MetaSwapV2: INSUFFICIENT_INPUT_AMOUNT");
        pair.swap(1, 0, address(this), "");
    }

    function testFuzz_swap_kInvariantNeverDecreases(uint96 r0, uint96 r1, uint96 amountIn, bool zeroForOne) public {
        vm.assume(r0 > 1e6 && r1 > 1e6 && amountIn > 1e3);
        _addLiquidity(r0, r1);
        uint256 kBefore = uint256(r0) * r1;
        (uint256 rin, uint256 rout) = zeroForOne ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 out = _v2AmountOut(amountIn, rin, rout);
        vm.assume(out > 0);
        if (zeroForOne) {
            tokenA.transfer(address(pair), amountIn);
            pair.swap(0, out, address(this), "");
        } else {
            tokenB.transfer(address(pair), amountIn);
            pair.swap(out, 0, address(this), "");
        }
        (uint112 n0, uint112 n1,) = pair.getReserves();
        assertGe(uint256(n0) * n1, kBefore);
    }

    function test_flashSwap_repaid_and_unpaidReverts() public {
        _addLiquidity(100e18, 100e18);
        FlashBorrower borrower = new FlashBorrower();
        tokenA.transfer(address(borrower), 1e18);
        vm.expectRevert("MetaSwapV2: INSUFFICIENT_INPUT_AMOUNT");
        pair.swap(10e18, 0, address(borrower), abi.encode(uint256(1)));
        borrower.setRepay(true);
        pair.swap(10e18, 0, address(borrower), abi.encode(uint256(1)));
        assertEq(borrower.seenAmount0(), 10e18);
        (uint112 r0,,) = pair.getReserves();
        assertGt(r0, 100e18); // fee stayed in the pool
    }

    function test_feeOn_mintsOneSixthOfGrowthToFeeTo() public {
        vm.prank(feeSetter);
        v2Factory.setFeeTo(bob);
        _addLiquidity(1000e18, 1000e18);
        uint256 amountIn = 1e18;
        uint256 out = _v2AmountOut(amountIn, 1000e18, 1000e18);
        tokenB.transfer(address(pair), amountIn);
        pair.swap(out, 0, address(this), "");
        (uint112 r0, uint112 r1,) = pair.getReserves();
        uint256 rootK = _sqrt(uint256(r0) * r1);
        uint256 rootKLast = _sqrt(pair.kLast());
        uint256 expectedFee = pair.totalSupply() * (rootK - rootKLast) / (rootK * 5 + rootKLast);
        // burn everything except locked liquidity triggers _mintFee
        uint256 liq = pair.balanceOf(address(this));
        pair.transfer(address(pair), liq);
        pair.burn(address(this));
        uint256 feeLiq = pair.balanceOf(bob);
        assertGt(feeLiq, 0);
        assertEq(feeLiq, expectedFee); // 1/6 of the sqrt(k) growth, per the V2 whitepaper
        assertEq(pair.kLast(), 0 + uint256(_r0()) * _r1());
    }

    function _r0() internal view returns (uint112 r) {
        (r,,) = pair.getReserves();
    }

    function _r1() internal view returns (uint112 r) {
        (, r,) = pair.getReserves();
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function test_feeOff_noProtocolMint() public {
        _addLiquidity(1000e18, 1000e18);
        tokenB.transfer(address(pair), 1e18);
        pair.swap(_v2AmountOut(1e18, 1000e18, 1000e18), 0, address(this), "");
        pair.transfer(address(pair), pair.balanceOf(address(this)));
        pair.burn(address(this));
        assertEq(pair.totalSupply(), 1000);
        assertEq(pair.kLast(), 0);
    }

    function test_twap_cumulativePrices() public {
        _addLiquidity(3e18, 6e18); // price0 = 2, price1 = 0.5
        (,, uint32 ts0) = pair.getReserves();
        assertEq(pair.price0CumulativeLast(), 0);
        vm.warp(block.timestamp + 10);
        pair.sync();
        // UQ112x112: price0 = r1/r0 * 2^112
        assertEq(pair.price0CumulativeLast(), (uint256(2) << 112) * 10);
        assertEq(pair.price1CumulativeLast(), (uint256(1) << 111) * 10);
        (,, uint32 ts1) = pair.getReserves();
        assertEq(ts1 - ts0, 10);

        // counterfactual cumulative prices via the oracle library match what sync() would write
        vm.warp(block.timestamp + 7);
        (uint256 c0, uint256 c1, uint32 t) = MetaSwapV2OracleLibrary.currentCumulativePrices(address(pair));
        assertEq(t, uint32(block.timestamp));
        pair.sync();
        assertEq(c0, pair.price0CumulativeLast());
        assertEq(c1, pair.price1CumulativeLast());

        // average price over the window equals the constant spot price
        uint256 avg0 = (c0 - 0) / 17;
        assertEq(avg0 >> 112, 2);
    }

    function test_twap_accumulatorWrapsUnchecked() public {
        tokenB.mint(address(this), 2 ** 112);
        _addLiquidity(1, 2 ** 111);
        // huge price: r1/r0 = 2^111 -> per-second increment 2^223; (2^32-1)s * 4 overflows uint256.
        // The pair uses `unchecked` arithmetic exactly like the original 0.5.16 code (overflow is desired).
        uint256 expected;
        bool wrapped;
        uint256 perSecond = uint256(2 ** 111) << 112;
        for (uint256 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + (2 ** 32 - 1));
            pair.sync();
            uint256 prev = expected;
            unchecked {
                expected += perSecond * (2 ** 32 - 1);
            }
            if (expected < prev) wrapped = true;
            assertEq(pair.price0CumulativeLast(), expected);
        }
        assertTrue(wrapped);
    }

    function test_skim_and_sync() public {
        _addLiquidity(1e18, 1e18);
        tokenA.transfer(address(pair), 5e17);
        uint256 before = tokenA.balanceOf(alice);
        pair.skim(alice);
        assertEq(tokenA.balanceOf(alice) - before, 5e17);
        tokenB.transfer(address(pair), 3e17);
        pair.sync();
        (, uint112 r1,) = pair.getReserves();
        assertEq(r1, 13e17);
    }

    function test_reserveOverflowReverts() public {
        tokenA.mint(address(this), 2 ** 113);
        tokenA.transfer(address(pair), uint256(type(uint112).max) + 1);
        tokenB.transfer(address(pair), 1e18);
        vm.expectRevert("MetaSwapV2: OVERFLOW");
        pair.mint(address(this));
    }

    function test_lpPermit() public {
        _addLiquidity(1e18, 1e18);
        (address owner, uint256 pk) = makeAddrAndKey("lpOwner");
        pair.transfer(owner, 1e17);
        uint256 deadline = block.timestamp + 100;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                pair.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(pair.PERMIT_TYPEHASH(), owner, bob, 1e17, 0, deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        pair.permit(owner, bob, 1e17, deadline, v, r, s);
        assertEq(pair.allowance(owner, bob), 1e17);
        assertEq(pair.nonces(owner), 1);
        vm.expectRevert("MetaSwapV2: INVALID_SIGNATURE");
        pair.permit(owner, bob, 1e17, deadline, v, r, s);
        vm.warp(deadline + 1);
        vm.expectRevert("MetaSwapV2: EXPIRED");
        pair.permit(owner, bob, 1e17, deadline, v, r, s);
    }

    function test_lpTransferFrom_maxAllowanceNotDecremented() public {
        _addLiquidity(1e18, 1e18);
        pair.approve(alice, type(uint256).max);
        vm.prank(alice);
        pair.transferFrom(address(this), bob, 1e17);
        assertEq(pair.allowance(address(this), alice), type(uint256).max);
        pair.approve(alice, 1e17);
        vm.prank(alice);
        pair.transferFrom(address(this), bob, 4e16);
        assertEq(pair.allowance(address(this), alice), 6e16);
        assertEq(pair.balanceOf(bob), 14e16);
    }

    function test_initialize_onlyFactory() public {
        vm.expectRevert("MetaSwapV2: FORBIDDEN");
        pair.initialize(t0, t1);
    }
}
