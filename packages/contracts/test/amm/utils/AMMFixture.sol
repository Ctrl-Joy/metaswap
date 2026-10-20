// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {WETH9} from "../../../src/amm/tokens/WETH9.sol";
import {TestERC20} from "../../../src/amm/tokens/TestERC20.sol";
import {MetaSwapV2Factory} from "../../../src/amm/v2/MetaSwapV2Factory.sol";
import {MetaSwapV2Router02} from "../../../src/amm/v2/MetaSwapV2Router02.sol";
import {IMetaSwapV2Pair} from "../../../src/amm/v2/interfaces/IMetaSwapV2Pair.sol";
import {MetaSwapV3Factory} from "../../../src/amm/v3/MetaSwapV3Factory.sol";
import {NonfungiblePositionManager} from "../../../src/amm/v3/NonfungiblePositionManager.sol";
import {INonfungiblePositionManager} from "../../../src/amm/v3/interfaces/INonfungiblePositionManager.sol";
import {SwapRouter02} from "../../../src/amm/v3/SwapRouter02.sol";
import {QuoterV2} from "../../../src/amm/v3/QuoterV2.sol";
import {TickLens} from "../../../src/amm/v3/TickLens.sol";
import {IMetaSwapV3Pool} from "../../../src/amm/v3/interfaces/IMetaSwapV3Pool.sol";
import {TickMath} from "../../../src/amm/v3/libraries/TickMath.sol";

/// @notice Deploys the full MetaSwap AMM stack for tests.
abstract contract AMMFixture is Test {
    WETH9 internal weth;
    TestERC20 internal tokenA;
    TestERC20 internal tokenB;
    TestERC20 internal tokenC;

    MetaSwapV2Factory internal v2Factory;
    MetaSwapV2Router02 internal v2Router;
    MetaSwapV3Factory internal v3Factory;
    NonfungiblePositionManager internal npm;
    SwapRouter02 internal router;
    QuoterV2 internal quoter;
    TickLens internal tickLens;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal feeSetter = makeAddr("feeSetter");

    uint160 internal constant SQRT_1_1 = 79228162514264337593543950336; // 2^96

    function setUpAMM() internal {
        vm.warp(1_700_000_000);
        weth = new WETH9();
        tokenA = new TestERC20("Token A", "TKA", 18, 1000e18);
        tokenB = new TestERC20("Token B", "TKB", 18, 1000e18);
        tokenC = new TestERC20("Token C", "TKC", 18, 1000e18);
        // keep tokenA < tokenB < tokenC by address for predictable ordering
        _sort3();

        v2Factory = new MetaSwapV2Factory(feeSetter);
        v2Router = new MetaSwapV2Router02(address(v2Factory), address(weth));
        v3Factory = new MetaSwapV3Factory();
        npm = new NonfungiblePositionManager(address(v3Factory), address(weth));
        router = new SwapRouter02(address(v2Factory), address(v3Factory), address(npm), address(weth));
        quoter = new QuoterV2(address(v3Factory), address(weth));
        tickLens = new TickLens();

        address[3] memory users = [address(this), alice, bob];
        for (uint256 i = 0; i < users.length; i++) {
            _fund(users[i]);
        }
    }

    function _sort3() private {
        TestERC20[3] memory t = [tokenA, tokenB, tokenC];
        for (uint256 i = 0; i < 3; i++) {
            for (uint256 j = i + 1; j < 3; j++) {
                if (address(t[j]) < address(t[i])) (t[i], t[j]) = (t[j], t[i]);
            }
        }
        (tokenA, tokenB, tokenC) = (t[0], t[1], t[2]);
    }

    function _fund(address user) internal {
        tokenA.mint(user, 1e30);
        tokenB.mint(user, 1e30);
        tokenC.mint(user, 1e30);
        vm.deal(user, 1e24);
        vm.startPrank(user);
        weth.deposit{value: 1e23}();
        address[4] memory spenders = [address(v2Router), address(npm), address(router), address(this)];
        for (uint256 i = 0; i < spenders.length; i++) {
            tokenA.approve(spenders[i], type(uint256).max);
            tokenB.approve(spenders[i], type(uint256).max);
            tokenC.approve(spenders[i], type(uint256).max);
            weth.approve(spenders[i], type(uint256).max);
        }
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- V3 helpers

    function _createPoolV3(address t0, address t1, uint24 fee, uint160 sqrtPriceX96) internal returns (IMetaSwapV3Pool) {
        if (t0 > t1) (t0, t1) = (t1, t0);
        return IMetaSwapV3Pool(npm.createAndInitializePoolIfNecessary(t0, t1, fee, sqrtPriceX96));
    }

    function _mintV3(
        address owner,
        address t0,
        address t1,
        uint24 fee,
        int24 lower,
        int24 upper,
        uint256 amount0,
        uint256 amount1
    ) internal returns (uint256 tokenId, uint128 liquidity, uint256 used0, uint256 used1) {
        if (t0 > t1) {
            (t0, t1) = (t1, t0);
            (amount0, amount1) = (amount1, amount0);
        }
        vm.prank(owner);
        (tokenId, liquidity, used0, used1) = npm.mint(
            INonfungiblePositionManager.MintParams({
                token0: t0,
                token1: t1,
                fee: fee,
                tickLower: lower,
                tickUpper: upper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: owner,
                deadline: block.timestamp
            })
        );
    }

    function _fullRange(int24 spacing) internal pure returns (int24 lower, int24 upper) {
        lower = (TickMath.MIN_TICK / spacing) * spacing;
        upper = (TickMath.MAX_TICK / spacing) * spacing;
    }

    function _encodePath(address a, uint24 f1, address b) internal pure returns (bytes memory) {
        return abi.encodePacked(a, f1, b);
    }

    function _encodePath(address a, uint24 f1, address b, uint24 f2, address c) internal pure returns (bytes memory) {
        return abi.encodePacked(a, f1, b, f2, c);
    }

    // ---------------------------------------------------------------- V2 helpers

    function _addV2(address user, address a, address b, uint256 amountA, uint256 amountB)
        internal
        returns (IMetaSwapV2Pair pair, uint256 liquidity)
    {
        vm.prank(user);
        (,, liquidity) = v2Router.addLiquidity(a, b, amountA, amountB, 0, 0, user, block.timestamp);
        pair = IMetaSwapV2Pair(v2Factory.getPair(a, b));
    }

    function _v2AmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 997;
        return amountInWithFee * reserveOut / (reserveIn * 1000 + amountInWithFee);
    }
}
