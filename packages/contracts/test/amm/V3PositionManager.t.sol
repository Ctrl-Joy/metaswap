// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {AMMFixture} from "./utils/AMMFixture.sol";
import {INonfungiblePositionManager} from "../../src/amm/v3/interfaces/INonfungiblePositionManager.sol";
import {IMetaSwapV3Pool} from "../../src/amm/v3/interfaces/IMetaSwapV3Pool.sol";
import {IV3SwapRouter} from "../../src/amm/v3/interfaces/IV3SwapRouter.sol";
import {IPeripheryPayments} from "../../src/amm/v3/interfaces/IPeripheryPayments.sol";
import {TickMath} from "../../src/amm/v3/libraries/TickMath.sol";
import {LiquidityAmounts} from "../../src/amm/v3/libraries/LiquidityAmounts.sol";
import {PositionURI} from "../../src/amm/v3/libraries/PositionURI.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

contract V3PositionManagerTest is AMMFixture {
    IMetaSwapV3Pool internal pool;
    address internal t0;
    address internal t1;
    uint24 internal constant FEE = 3000;

    event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1);

    function setUp() public {
        setUpAMM();
        t0 = address(tokenA);
        t1 = address(tokenB);
        pool = _createPoolV3(t0, t1, FEE, SQRT_1_1);
    }

    function _swap(address user, address tin, address tout, uint256 amountIn) internal {
        vm.prank(user);
        router.exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams({
                tokenIn: tin,
                tokenOut: tout,
                fee: FEE,
                recipient: user,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function test_metadata() public view {
        assertEq(npm.name(), "MetaSwap V3 Positions");
        assertEq(npm.symbol(), "MS-V3-POS");
        assertEq(npm.factory(), address(v3Factory));
        assertEq(npm.WETH9(), address(weth));
    }

    function test_createAndInitializePoolIfNecessary_idempotent() public {
        address p = npm.createAndInitializePoolIfNecessary(t0, t1, FEE, TickMath.getSqrtRatioAtTick(500));
        assertEq(p, address(pool));
        (uint160 sqrtP,,,,,,) = pool.slot0();
        assertEq(sqrtP, SQRT_1_1); // not re-initialized
        address p2 = npm.createAndInitializePoolIfNecessary(t0, t1, 500, SQRT_1_1);
        assertEq(p2, v3Factory.getPool(t0, t1, 500));
    }

    function test_mint_positionState() public {
        uint128 expectedL = LiquidityAmounts.getLiquidityForAmounts(
            SQRT_1_1, TickMath.getSqrtRatioAtTick(-600), TickMath.getSqrtRatioAtTick(600), 10e18, 10e18
        );
        vm.expectEmit(true, false, false, false, address(npm));
        emit IncreaseLiquidity(1, 0, 0, 0);
        (uint256 tokenId, uint128 L, uint256 a0, uint256 a1) = _mintV3(alice, t0, t1, FEE, -600, 600, 10e18, 10e18);
        assertEq(tokenId, 1);
        assertEq(L, expectedL);
        assertLe(a0, 10e18);
        assertLe(a1, 10e18);
        assertEq(npm.ownerOf(1), alice);
        assertEq(npm.balanceOf(alice), 1);
        assertEq(npm.totalSupply(), 1);
        assertEq(npm.tokenOfOwnerByIndex(alice, 0), 1);
        (
            uint96 nonce,
            address operator,
            address pt0,
            address pt1,
            uint24 fee,
            int24 lower,
            int24 upper,
            uint128 liquidity,,,,
        ) = npm.positions(1);
        assertEq(nonce, 0);
        assertEq(operator, address(0));
        assertEq(pt0, t0);
        assertEq(pt1, t1);
        assertEq(fee, FEE);
        assertEq(lower, -600);
        assertEq(upper, 600);
        assertEq(liquidity, L);
        // pool position is owned by the manager
        (uint128 poolL,,,,) = pool.positions(keccak256(abi.encodePacked(address(npm), int24(-600), int24(600))));
        assertEq(poolL, L);
    }

    function test_mint_slippageAndDeadline() public {
        vm.prank(alice);
        vm.expectRevert("Price slippage check");
        npm.mint(
            INonfungiblePositionManager.MintParams(t0, t1, FEE, -600, 600, 10e18, 10e18, 10e18 + 1, 0, alice, block.timestamp)
        );
        vm.prank(alice);
        vm.expectRevert("Transaction too old");
        npm.mint(
            INonfungiblePositionManager.MintParams(t0, t1, FEE, -600, 600, 10e18, 10e18, 0, 0, alice, block.timestamp - 1)
        );
        vm.prank(alice);
        vm.expectRevert(bytes("PNF")); // pool for that fee tier does not exist
        npm.mint(INonfungiblePositionManager.MintParams(t0, t1, 10000, -600, 600, 1e18, 1e18, 0, 0, alice, block.timestamp));
    }

    function test_increase_decrease_collect_burn() public {
        (uint256 id, uint128 L,,) = _mintV3(alice, t0, t1, FEE, -600, 600, 10e18, 10e18);

        // anyone can increase (pays themselves)
        vm.prank(bob);
        (uint128 addL,,) = npm.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams(id, 5e18, 5e18, 0, 0, block.timestamp)
        );
        (,,,,,,, uint128 liq,,,,) = npm.positions(id);
        assertEq(liq, L + addL);

        // only owner/approved can decrease
        vm.prank(bob);
        vm.expectRevert("Not approved");
        npm.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams(id, addL, 0, 0, block.timestamp));

        // generate fees
        _swap(bob, t0, t1, 1e18);
        _swap(bob, t1, t0, 1e18);

        vm.prank(alice);
        (uint256 d0, uint256 d1) =
            npm.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams(id, liq, 0, 0, block.timestamp));
        assertGt(d0, 0);
        assertGt(d1, 0);
        _collectAllAndBurn(id, d0, d1);
    }

    function _collectAllAndBurn(uint256 id, uint256 d0, uint256 d1) internal {
        (,,,,,,, uint128 liqAfter,,, uint128 owed0, uint128 owed1) = npm.positions(id);
        assertEq(liqAfter, 0);
        // tokensOwed = principal + fees
        assertGt(owed0, d0);
        assertGt(owed1, d1);

        vm.prank(alice);
        vm.expectRevert("Not cleared");
        npm.burn(id);

        uint256 b0 = tokenA.balanceOf(bob);
        vm.prank(alice);
        (uint256 c0, uint256 c1) =
            npm.collect(INonfungiblePositionManager.CollectParams(id, bob, type(uint128).max, type(uint128).max));
        assertEq(c0, owed0);
        assertEq(c1, owed1);
        assertEq(tokenA.balanceOf(bob) - b0, c0);
        // fees: ~0.3% of 1e18 on each side
        assertApproxEqAbs(c0 - d0, 3e15, 1e12);

        vm.prank(alice);
        npm.burn(id);
        vm.expectRevert();
        npm.ownerOf(id);
        vm.expectRevert("Invalid token ID");
        npm.positions(id);
    }

    function test_collect_feesWhileLiquidityRemains() public {
        (uint256 id,,,) = _mintV3(alice, t0, t1, FEE, -600, 600, 10e18, 10e18);
        _swap(bob, t0, t1, 2e18);
        vm.prank(alice);
        (uint256 c0, uint256 c1) =
            npm.collect(INonfungiblePositionManager.CollectParams(id, alice, type(uint128).max, type(uint128).max));
        assertApproxEqAbs(c0, 6e15, 1e12); // 0.3% of 2e18
        assertEq(c1, 0);
        // partial collect respects amountMax
        _swap(bob, t1, t0, 2e18);
        vm.prank(alice);
        (, c1) = npm.collect(INonfungiblePositionManager.CollectParams(id, alice, 0, 1e15));
        assertEq(c1, 1e15);
        (,,,,,,,,,,, uint128 owed1) = npm.positions(id);
        assertApproxEqAbs(owed1, 5e15, 1e12);
    }

    function test_approvals_and_transfer() public {
        (uint256 id,,,) = _mintV3(alice, t0, t1, FEE, -600, 600, 1e18, 1e18);
        vm.prank(alice);
        npm.approve(bob, id);
        assertEq(npm.getApproved(id), bob);
        (, address operator,,,,,,,,,,) = npm.positions(id);
        assertEq(operator, bob); // approvals are stored in the position struct
        vm.prank(bob);
        npm.collect(INonfungiblePositionManager.CollectParams(id, bob, 1, 1));
        // transfer clears the approval
        vm.prank(alice);
        npm.transferFrom(alice, address(this), id);
        assertEq(npm.getApproved(id), address(0));
        assertEq(npm.ownerOf(id), address(this));
        vm.prank(bob);
        vm.expectRevert("Not approved");
        npm.collect(INonfungiblePositionManager.CollectParams(id, bob, 1, 1));
    }

    function test_permit() public {
        (address owner, uint256 pk) = makeAddrAndKey("nftOwner");
        _fund(owner);
        (uint256 id,,,) = _mintV3(owner, t0, t1, FEE, -600, 600, 1e18, 1e18);
        uint256 deadline = block.timestamp + 60;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                npm.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(npm.PERMIT_TYPEHASH(), bob, id, 0, deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        npm.permit(bob, id, deadline, v, r, s);
        assertEq(npm.getApproved(id), bob);
        (uint96 nonce,,,,,,,,,,,) = npm.positions(id);
        assertEq(nonce, 1);
        vm.expectRevert("Unauthorized"); // replay with consumed nonce
        npm.permit(bob, id, deadline, v, r, s);
    }

    function test_mintWithETH_viaMulticall_refund() public {
        IMetaSwapV3Pool wethPool = _createPoolV3(address(weth), t0, FEE, SQRT_1_1);
        (address a, address b) = address(weth) < t0 ? (address(weth), t0) : (t0, address(weth));
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            INonfungiblePositionManager.mint,
            (INonfungiblePositionManager.MintParams(a, b, FEE, -600, 600, 1e18, 1e18, 0, 0, bob, block.timestamp))
        );
        calls[1] = abi.encodeCall(IPeripheryPayments.refundETH, ());
        uint256 ethBefore = alice.balance;
        uint256 wethBefore = weth.balanceOf(alice);
        vm.prank(alice);
        npm.multicall{value: 2 ether}(calls);
        assertEq(npm.ownerOf(1), bob);
        assertEq(weth.balanceOf(alice), wethBefore); // paid with native ETH, not WETH
        assertLe(ethBefore - alice.balance, 1e18);
        assertEq(address(npm).balance, 0);
        assertGt(wethPool.liquidity(), 0);
    }

    function test_tokenURI_onchainJsonSvg() public {
        _mintV3(alice, t0, t1, FEE, -600, 600, 1e18, 1e18);
        string memory uri = npm.tokenURI(1);
        string memory json = string(_b64decode(_stripPrefix(uri, "data:application/json;base64,")));
        string memory sym0 = tokenA.symbol();
        string memory sym1 = tokenB.symbol();
        assertEq(vm.parseJsonString(json, ".name"), string.concat("MetaSwap V3 - 0.3% - ", sym0, "/", sym1));
        assertEq(vm.parseJsonString(json, ".attributes[1].value"), "0.3%");
        assertEq(vm.parseJsonString(json, ".attributes[2].value"), "-600");
        assertEq(vm.parseJsonString(json, ".attributes[4].value"), "Yes");
        string memory svg =
            string(_b64decode(_stripPrefix(vm.parseJsonString(json, ".image"), "data:image/svg+xml;base64,")));
        assertTrue(_contains(svg, "<svg"));
        assertTrue(_contains(svg, string.concat(sym0, "/", sym1)));
        assertTrue(_contains(svg, "In range"));
        vm.expectRevert();
        npm.tokenURI(99);
    }

    function _stripPrefix(string memory s, string memory prefix) internal pure returns (bytes memory out) {
        bytes memory b = bytes(s);
        bytes memory p = bytes(prefix);
        for (uint256 i = 0; i < p.length; i++) {
            require(b[i] == p[i], "prefix");
        }
        out = new bytes(b.length - p.length);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = b[i + p.length];
        }
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        for (uint256 i = 0; i + n.length <= h.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function _b64val(bytes1 c) internal pure returns (uint8) {
        if (c >= "A" && c <= "Z") return uint8(c) - 65;
        if (c >= "a" && c <= "z") return uint8(c) - 71;
        if (c >= "0" && c <= "9") return uint8(c) + 4;
        if (c == "+") return 62;
        if (c == "/") return 63;
        return 0; // '='
    }

    function _b64decode(bytes memory data) internal pure returns (bytes memory out) {
        uint256 pad = 0;
        if (data.length > 0 && data[data.length - 1] == "=") pad++;
        if (data.length > 1 && data[data.length - 2] == "=") pad++;
        out = new bytes((data.length / 4) * 3 - pad);
        uint256 o;
        for (uint256 i = 0; i < data.length; i += 4) {
            uint256 n = (uint256(_b64val(data[i])) << 18) | (uint256(_b64val(data[i + 1])) << 12)
                | (uint256(_b64val(data[i + 2])) << 6) | uint256(_b64val(data[i + 3]));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(n));
        }
    }

    function test_feeToString() public pure {
        assertEq(PositionURI.feeToString(100), "0.01%");
        assertEq(PositionURI.feeToString(500), "0.05%");
        assertEq(PositionURI.feeToString(3000), "0.3%");
        assertEq(PositionURI.feeToString(10000), "1%");
        assertEq(PositionURI.feeToString(2500), "0.25%");
    }

    function test_positionsTrackedPerPool() public {
        _createPoolV3(t0, t1, 500, SQRT_1_1);
        _mintV3(alice, t0, t1, FEE, -600, 600, 1e18, 1e18);
        _mintV3(alice, t0, t1, 500, -100, 100, 1e18, 1e18);
        (,,,, uint24 f1,,,,,,,) = npm.positions(1);
        (,,,, uint24 f2, int24 l2,,,,,,) = npm.positions(2);
        assertEq(f1, FEE);
        assertEq(f2, 500);
        assertEq(l2, -100);
        assertEq(npm.balanceOf(alice), 2);
    }
}
