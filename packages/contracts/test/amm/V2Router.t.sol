// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {AMMFixture} from "./utils/AMMFixture.sol";
import {IMetaSwapV2Pair} from "../../src/amm/v2/interfaces/IMetaSwapV2Pair.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Charges a 1% fee on every transfer (burned) - exercises the *SupportingFeeOnTransferTokens variants.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee Token", "FOT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

contract V2RouterTest is AMMFixture {
    function setUp() public {
        setUpAMM();
    }

    function _path(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2);
        p[0] = a;
        p[1] = b;
    }

    function _path(address a, address b, address c) internal pure returns (address[] memory p) {
        p = new address[](3);
        p[0] = a;
        p[1] = b;
        p[2] = c;
    }

    function test_addLiquidity_createsPairAndMints() public {
        assertEq(v2Factory.getPair(address(tokenA), address(tokenB)), address(0));
        (uint256 a, uint256 b, uint256 liq) =
            v2Router.addLiquidity(address(tokenA), address(tokenB), 1e18, 4e18, 0, 0, alice, block.timestamp);
        assertEq(a, 1e18);
        assertEq(b, 4e18);
        assertEq(liq, 2e18 - 1000);
        IMetaSwapV2Pair pair = IMetaSwapV2Pair(v2Factory.getPair(address(tokenA), address(tokenB)));
        assertEq(pair.balanceOf(alice), liq);
    }

    function test_addLiquidity_optimalAmountsAndSlippage() public {
        v2Router.addLiquidity(address(tokenA), address(tokenB), 1e18, 2e18, 0, 0, alice, block.timestamp);
        // desire too much B: router uses optimal B = 2 * A
        (uint256 a, uint256 b,) =
            v2Router.addLiquidity(address(tokenA), address(tokenB), 1e18, 5e18, 0, 0, alice, block.timestamp);
        assertEq(a, 1e18);
        assertEq(b, 2e18);
        // desire too much A: router uses optimal A = B / 2
        (a, b,) = v2Router.addLiquidity(address(tokenA), address(tokenB), 5e18, 2e18, 0, 0, alice, block.timestamp);
        assertEq(a, 1e18);
        assertEq(b, 2e18);
        vm.expectRevert("MetaSwapV2Router: INSUFFICIENT_B_AMOUNT");
        v2Router.addLiquidity(address(tokenA), address(tokenB), 1e18, 5e18, 0, 3e18, alice, block.timestamp);
        vm.expectRevert("MetaSwapV2Router: INSUFFICIENT_A_AMOUNT");
        v2Router.addLiquidity(address(tokenA), address(tokenB), 5e18, 2e18, 2e18, 0, alice, block.timestamp);
    }

    function test_deadlineReverts() public {
        vm.expectRevert("MetaSwapV2Router: EXPIRED");
        v2Router.addLiquidity(address(tokenA), address(tokenB), 1e18, 1e18, 0, 0, alice, block.timestamp - 1);
        _addV2(address(this), address(tokenA), address(tokenB), 10e18, 10e18);
        vm.expectRevert("MetaSwapV2Router: EXPIRED");
        v2Router.swapExactTokensForTokens(1e18, 0, _path(address(tokenA), address(tokenB)), alice, block.timestamp - 1);
    }

    function test_addLiquidityETH_refundsDust() public {
        uint256 balBefore = address(this).balance;
        (uint256 amountToken, uint256 amountETH,) =
            v2Router.addLiquidityETH{value: 2 ether}(address(tokenA), 3000e18, 0, 0, alice, block.timestamp);
        assertEq(amountToken, 3000e18);
        assertEq(amountETH, 2 ether);
        // second add with surplus ETH -> refund
        (, amountETH,) = v2Router.addLiquidityETH{value: 5 ether}(address(tokenA), 1500e18, 0, 0, alice, block.timestamp);
        assertEq(amountETH, 1 ether);
        assertEq(balBefore - address(this).balance, 3 ether);
    }

    function test_removeLiquidity_and_ETH() public {
        (IMetaSwapV2Pair pair, uint256 liq) = _addV2(alice, address(tokenA), address(tokenB), 10e18, 10e18);
        vm.startPrank(alice);
        pair.approve(address(v2Router), type(uint256).max);
        vm.expectRevert("MetaSwapV2Router: INSUFFICIENT_A_AMOUNT");
        v2Router.removeLiquidity(address(tokenA), address(tokenB), liq, 10e18, 0, alice, block.timestamp);
        (uint256 a, uint256 b) =
            v2Router.removeLiquidity(address(tokenA), address(tokenB), liq, 0, 0, bob, block.timestamp);
        vm.stopPrank();
        assertEq(a, 10e18 - 1000);
        assertEq(b, 10e18 - 1000);

        vm.prank(alice);
        (,, uint256 liqEth) =
            v2Router.addLiquidityETH{value: 1 ether}(address(tokenC), 3000e18, 0, 0, alice, block.timestamp);
        IMetaSwapV2Pair ethPair = IMetaSwapV2Pair(v2Factory.getPair(address(tokenC), address(weth)));
        uint256 ethBefore = bob.balance;
        vm.startPrank(alice);
        ethPair.approve(address(v2Router), liqEth);
        (uint256 amountToken, uint256 amountETH) =
            v2Router.removeLiquidityETH(address(tokenC), liqEth, 0, 0, bob, block.timestamp);
        vm.stopPrank();
        assertGt(amountToken, 0);
        assertEq(bob.balance - ethBefore, amountETH);
    }

    function test_removeLiquidityWithPermit() public {
        (address owner, uint256 pk) = makeAddrAndKey("permitOwner");
        _fund(owner);
        (IMetaSwapV2Pair pair, uint256 liq) = _addV2(owner, address(tokenA), address(tokenB), 10e18, 10e18);
        (uint8 v, bytes32 r, bytes32 s) = _signLpPermit(pair, owner, pk, liq);
        vm.prank(owner);
        (uint256 a,) = v2Router.removeLiquidityWithPermit(
            address(tokenA), address(tokenB), liq, 0, 0, owner, block.timestamp + 1, false, v, r, s
        );
        assertEq(a, 10e18 - 1000);
        assertEq(pair.balanceOf(owner), 0);
    }

    function _signLpPermit(IMetaSwapV2Pair pair, address owner, uint256 pk, uint256 value)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                pair.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(pair.PERMIT_TYPEHASH(), owner, address(v2Router), value, 0, block.timestamp + 1))
            )
        );
        (v, r, s) = vm.sign(pk, digest);
    }

    function test_swapExactTokensForTokens_matchesLibraryAndPair() public {
        _addV2(address(this), address(tokenA), address(tokenB), 100e18, 200e18);
        uint256[] memory quoted = v2Router.getAmountsOut(1e18, _path(address(tokenA), address(tokenB)));
        assertEq(quoted[1], _v2AmountOut(1e18, 100e18, 200e18));
        uint256 before = tokenB.balanceOf(alice);
        uint256[] memory amounts =
            v2Router.swapExactTokensForTokens(1e18, quoted[1], _path(address(tokenA), address(tokenB)), alice, block.timestamp);
        assertEq(amounts[1], quoted[1]);
        assertEq(tokenB.balanceOf(alice) - before, quoted[1]);
    }

    function test_swap_slippageReverts() public {
        _addV2(address(this), address(tokenA), address(tokenB), 100e18, 200e18);
        uint256 out = _v2AmountOut(1e18, 100e18, 200e18);
        vm.expectRevert("MetaSwapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        v2Router.swapExactTokensForTokens(1e18, out + 1, _path(address(tokenA), address(tokenB)), alice, block.timestamp);
        uint256 inNeeded = v2Router.getAmountsIn(1e18, _path(address(tokenA), address(tokenB)))[0];
        vm.expectRevert("MetaSwapV2Router: EXCESSIVE_INPUT_AMOUNT");
        v2Router.swapTokensForExactTokens(1e18, inNeeded - 1, _path(address(tokenA), address(tokenB)), alice, block.timestamp);
    }

    function test_swapTokensForExactTokens() public {
        _addV2(address(this), address(tokenA), address(tokenB), 100e18, 200e18);
        uint256 before = tokenB.balanceOf(alice);
        uint256 balA = tokenA.balanceOf(address(this));
        uint256[] memory amounts = v2Router.swapTokensForExactTokens(
            5e18, type(uint256).max, _path(address(tokenA), address(tokenB)), alice, block.timestamp
        );
        assertEq(tokenB.balanceOf(alice) - before, 5e18);
        assertEq(balA - tokenA.balanceOf(address(this)), amounts[0]);
        // getAmountIn formula: reserveIn*out*1000 / ((reserveOut-out)*997) + 1
        assertEq(amounts[0], (uint256(100e18) * 5e18 * 1000) / ((200e18 - 5e18) * 997) + 1);
    }

    function test_multihop_exactInAndOut() public {
        _addV2(address(this), address(tokenA), address(tokenB), 100e18, 100e18);
        _addV2(address(this), address(tokenB), address(tokenC), 100e18, 50e18);
        address[] memory path = _path(address(tokenA), address(tokenB), address(tokenC));
        uint256 mid = _v2AmountOut(2e18, 100e18, 100e18);
        uint256 expected = _v2AmountOut(mid, 100e18, 50e18);
        uint256 before = tokenC.balanceOf(bob);
        uint256[] memory amounts = v2Router.swapExactTokensForTokens(2e18, 0, path, bob, block.timestamp);
        assertEq(amounts[1], mid);
        assertEq(amounts[2], expected);
        assertEq(tokenC.balanceOf(bob) - before, expected);

        uint256[] memory ins = v2Router.getAmountsIn(1e18, path);
        before = tokenC.balanceOf(bob);
        amounts = v2Router.swapTokensForExactTokens(1e18, ins[0], path, bob, block.timestamp);
        assertEq(amounts[0], ins[0]);
        assertEq(tokenC.balanceOf(bob) - before, 1e18);
    }

    function test_ethSwaps() public {
        v2Router.addLiquidityETH{value: 100 ether}(address(tokenA), 300_000e18, 0, 0, address(this), block.timestamp);
        address[] memory toToken = _path(address(weth), address(tokenA));
        address[] memory toEth = _path(address(tokenA), address(weth));

        // exact ETH in
        uint256 out = _v2AmountOut(1 ether, 100 ether, 300_000e18);
        uint256 before = tokenA.balanceOf(bob);
        v2Router.swapExactETHForTokens{value: 1 ether}(out, toToken, bob, block.timestamp);
        assertEq(tokenA.balanceOf(bob) - before, out);

        // exact tokens out paid in ETH, dust refunded
        uint256 ethBefore = address(this).balance;
        uint256[] memory amounts = v2Router.swapETHForExactTokens{value: 10 ether}(1000e18, toToken, bob, block.timestamp);
        assertEq(ethBefore - address(this).balance, amounts[0]);

        // exact tokens in -> ETH out
        uint256 bobEth = bob.balance;
        amounts = v2Router.swapExactTokensForETH(3000e18, 0, toEth, bob, block.timestamp);
        assertEq(bob.balance - bobEth, amounts[1]);

        // tokens in -> exact ETH out
        bobEth = bob.balance;
        v2Router.swapTokensForExactETH(0.5 ether, type(uint256).max, toEth, bob, block.timestamp);
        assertEq(bob.balance - bobEth, 0.5 ether);

        vm.expectRevert("MetaSwapV2Router: INVALID_PATH");
        v2Router.swapExactETHForTokens{value: 1 ether}(0, toEth, bob, block.timestamp);
        vm.expectRevert("MetaSwapV2Router: INVALID_PATH");
        v2Router.swapExactTokensForETH(1e18, 0, toToken, bob, block.timestamp);
    }

    function test_receive_onlyFromWETH() public {
        (bool ok,) = address(v2Router).call{value: 1}("");
        assertFalse(ok);
    }

    function test_missingPairReverts() public {
        vm.expectRevert("MetaSwapV2Library: PAIR_NOT_FOUND");
        v2Router.getAmountsOut(1e18, _path(address(tokenA), address(tokenC)));
    }

    function test_feeOnTransferVariants() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        fot.mint(address(this), 1_000_000e18);
        fot.approve(address(v2Router), type(uint256).max);
        v2Router.addLiquidity(address(fot), address(tokenA), 10_000e18, 10_000e18, 0, 0, address(this), block.timestamp);
        v2Router.addLiquidityETH{value: 10 ether}(address(fot), 10_000e18, 0, 0, address(this), block.timestamp);

        // standard variant fails on a fee-on-transfer input (pair receives less than amounts[0])
        vm.expectRevert("MetaSwapV2: K");
        v2Router.swapExactTokensForTokens(100e18, 0, _path(address(fot), address(tokenA)), bob, block.timestamp);

        uint256 before = tokenA.balanceOf(bob);
        v2Router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            100e18, 1, _path(address(fot), address(tokenA)), bob, block.timestamp
        );
        assertGt(tokenA.balanceOf(bob), before);

        before = fot.balanceOf(bob);
        v2Router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: 0.1 ether}(
            1, _path(address(weth), address(fot)), bob, block.timestamp
        );
        assertGt(fot.balanceOf(bob), before);

        uint256 bobEth = bob.balance;
        v2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            100e18, 1, _path(address(fot), address(weth)), bob, block.timestamp
        );
        assertGt(bob.balance, bobEth);

        // remove ETH liquidity of a fee-on-transfer token
        IMetaSwapV2Pair pair = IMetaSwapV2Pair(v2Factory.getPair(address(fot), address(weth)));
        uint256 liq = pair.balanceOf(address(this));
        pair.approve(address(v2Router), liq);
        uint256 ethBefore = address(this).balance;
        uint256 amountETH = v2Router.removeLiquidityETHSupportingFeeOnTransferTokens(
            address(fot), liq, 0, 0, address(this), block.timestamp
        );
        assertEq(address(this).balance - ethBefore, amountETH);
    }

    function test_quoteHelpers() public view {
        assertEq(v2Router.quote(1e18, 100e18, 200e18), 2e18);
        assertEq(v2Router.getAmountOut(1e18, 100e18, 200e18), _v2AmountOut(1e18, 100e18, 200e18));
        assertEq(v2Router.getAmountIn(1e18, 100e18, 200e18), (uint256(100e18) * 1e18 * 1000) / ((200e18 - 1e18) * 997) + 1);
        assertEq(v2Router.factory(), address(v2Factory));
        assertEq(v2Router.WETH(), address(weth));
    }

    receive() external payable {}
}
