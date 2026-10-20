// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {XFixture} from "./utils/XFixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {TestERC20} from "@metaswap/amm/tokens/TestERC20.sol";
import {NonfungiblePositionManager} from "@metaswap/amm/v3/NonfungiblePositionManager.sol";
import {IMetaSwapV3Pool} from "@metaswap/amm/v3/interfaces/IMetaSwapV3Pool.sol";
import {IV3SwapRouter} from "@metaswap/amm/v3/interfaces/IV3SwapRouter.sol";
import {MetaSwapLaunchpad} from "@metaswap/x/launch/MetaSwapLaunchpad.sol";
import {LaunchAuction} from "@metaswap/x/launch/LaunchAuction.sol";
import {LaunchToken} from "@metaswap/x/launch/LaunchToken.sol";
import {LaunchParams, AuctionStatus, BidInfo} from "@metaswap/x/launch/LaunchTypes.sol";

contract LaunchAuctionTest is XFixture {
    event LaunchCreated(
        address indexed token, address indexed auction, address indexed creator, string name, string symbol
    );
    event BidPlaced(uint256 indexed bidId, address indexed bidder, uint256 amount, uint256 maxPrice);
    event Settled(uint256 clearingPrice, uint256 raised, bool launched, address pool);
    event Claimed(uint256 indexed bidId, address indexed bidder, uint256 tokens, uint256 refund);

    NonfungiblePositionManager npm;
    MetaSwapLaunchpad pad;
    TestERC20 usdc; // 6 decimals
    address creator = makeAddr("creator");
    address b1 = makeAddr("b1");
    address b2 = makeAddr("b2");
    address b3 = makeAddr("b3");
    address b4 = makeAddr("b4");

    uint256 constant SUPPLY = 1_000_000e18;

    function setUp() public {
        vm.warp(1_700_000_000);
        setUpAMM();
        npm = new NonfungiblePositionManager(address(v3Factory), address(weth));
        pad =
            new MetaSwapLaunchpad("MetaSwap Launchpad", address(v3Factory), address(npm), address(weth), address(this));
        usdc = new TestERC20("Meta USD Coin", "mUSDC", 6, 0);
        address[4] memory bs = [b1, b2, b3, b4];
        for (uint256 i; i < 4; i++) {
            tokenA.transfer(bs[i], 100_000 ether);
            usdc.mint(bs[i], 1_000_000e6);
            vm.deal(bs[i], 100 ether);
        }
    }

    // ------------------------------------------------------------ helpers

    /// 50% of 1M tokens auctioned (S = 500k), floor 0.01, tick 0.001, threshold 1000, 50% of raise to LP
    function _p(address quote, uint256 threshold) internal view returns (LaunchParams memory p) {
        p = LaunchParams({
            name: "Pixel Pup",
            symbol: "PUP",
            totalSupply: SUPPLY,
            auctionSupplyBps: 5000,
            quoteToken: quote,
            floorPrice: 0.01e18,
            tickSize: 0.001e18,
            startTime: block.timestamp,
            endTime: block.timestamp + 1 days,
            launchThreshold: threshold,
            liquidityBps: 5000,
            poolFee: 3000,
            description: "A test launch",
            website: "https://example.invalid"
        });
    }

    function _launch(LaunchParams memory p) internal returns (LaunchAuction a, LaunchToken t) {
        vm.prank(creator);
        (address token, address auction) = pad.createLaunch(p);
        a = LaunchAuction(payable(auction));
        t = LaunchToken(token);
    }

    function _bid(LaunchAuction a, address who, uint256 amount, uint256 price) internal returns (uint256 id) {
        IERC20 q = a.quoteToken();
        vm.startPrank(who);
        q.approve(address(a), amount);
        id = a.bid(amount, price);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ launchpad

    function test_createLaunch() public {
        LaunchParams memory p = _p(address(tokenA), 1000 ether);
        vm.expectEmit(false, false, true, true, address(pad));
        emit LaunchCreated(address(0), address(0), creator, "Pixel Pup", "PUP");
        (LaunchAuction a, LaunchToken t) = _launch(p);

        assertEq(t.totalSupply(), SUPPLY);
        assertEq(t.balanceOf(address(a)), SUPPLY);
        assertEq(t.name(), "Pixel Pup");
        assertEq(t.decimals(), 18);
        assertEq(a.token(), address(t));
        assertEq(a.creator(), creator);
        assertEq(a.auctionSupply(), 500_000e18);
        assertEq(a.reserveSupply(), 500_000e18);
        assertEq(uint8(a.status()), uint8(AuctionStatus.Active));
        assertEq(a.fdvAtFloor(), 10_000 ether); // 0.01 * 1M
        assertEq(a.clearingPrice(), 0.01e18);
        assertEq(a.params().website, "https://example.invalid");
        assertEq(pad.launchCount(), 1);
        assertEq(pad.allLaunches()[0], address(a));
        assertEq(pad.name(), "MetaSwap Launchpad");
    }

    function test_createLaunchValidation() public {
        LaunchParams memory p = _p(address(tokenA), 0);
        p.auctionSupplyBps = 10_000;
        vm.expectRevert(abi.encodeWithSelector(MetaSwapLaunchpad.InvalidParams.selector, uint8(3)));
        pad.createLaunch(p);
        p = _p(address(tokenA), 0);
        p.poolFee = 1234;
        vm.expectRevert(abi.encodeWithSelector(MetaSwapLaunchpad.InvalidParams.selector, uint8(8)));
        pad.createLaunch(p);
        p = _p(address(tokenA), 0);
        p.endTime = p.startTime;
        vm.expectRevert(abi.encodeWithSelector(MetaSwapLaunchpad.InvalidParams.selector, uint8(7)));
        pad.createLaunch(p);
        p = _p(address(tokenA), 0);
        p.tickSize = 0;
        vm.expectRevert(abi.encodeWithSelector(MetaSwapLaunchpad.InvalidParams.selector, uint8(6)));
        pad.createLaunch(p);
    }

    function test_setVerifiedOnlyOwner() public {
        (LaunchAuction a,) = _launch(_p(address(tokenA), 0));
        vm.prank(creator);
        vm.expectRevert();
        pad.setVerified(address(a), true);
        pad.setVerified(address(a), true);
        assertTrue(pad.verified(address(a)));
        vm.expectRevert(MetaSwapLaunchpad.UnknownAuction.selector);
        pad.setVerified(address(0xbeef), true);
    }

    // ------------------------------------------------------------ bidding rules

    function test_statusLifecycleAndBidWindow() public {
        LaunchParams memory p = _p(address(tokenA), 0);
        p.startTime = block.timestamp + 1 hours;
        p.endTime = block.timestamp + 2 hours;
        (LaunchAuction a,) = _launch(p);
        assertEq(uint8(a.status()), uint8(AuctionStatus.Upcoming));
        vm.startPrank(b1);
        tokenA.approve(address(a), type(uint256).max);
        vm.expectRevert(LaunchAuction.AuctionNotActive.selector);
        a.bid(1 ether, 0.01e18);
        vm.warp(p.startTime);
        assertEq(uint8(a.status()), uint8(AuctionStatus.Active));
        a.bid(1 ether, 0.01e18);
        vm.warp(p.endTime);
        assertEq(uint8(a.status()), uint8(AuctionStatus.Ended));
        vm.expectRevert(LaunchAuction.AuctionNotActive.selector);
        a.bid(1 ether, 0.01e18);
        vm.stopPrank();
    }

    function test_bidPriceRules() public {
        (LaunchAuction a,) = _launch(_p(address(tokenA), 0));
        vm.startPrank(b1);
        tokenA.approve(address(a), type(uint256).max);
        vm.expectRevert(LaunchAuction.InvalidPrice.selector);
        a.bid(1 ether, 0.009e18); // below floor
        vm.expectRevert(LaunchAuction.InvalidPrice.selector);
        a.bid(1 ether, 0.0105e18); // not a tick multiple
        vm.expectRevert(LaunchAuction.InvalidAmount.selector);
        a.bid(0, 0.01e18);
        vm.expectEmit(true, true, false, true, address(a));
        emit BidPlaced(0, b1, 1 ether, 0.015e18);
        a.bid(1 ether, 0.015e18);
        vm.stopPrank();
    }

    function test_priceLevelsSortedAndAggregated() public {
        (LaunchAuction a,) = _launch(_p(address(tokenA), 0));
        _bid(a, b1, 1 ether, 0.02e18);
        _bid(a, b2, 2 ether, 0.01e18);
        _bid(a, b3, 3 ether, 0.015e18);
        _bid(a, b4, 4 ether, 0.02e18);
        (uint256[] memory prices, uint256[] memory demand) = a.priceLevels();
        assertEq(prices.length, 3);
        assertEq(prices[0], 0.01e18);
        assertEq(prices[1], 0.015e18);
        assertEq(prices[2], 0.02e18);
        assertEq(demand[2], 5 ether);
        assertEq(a.totalBids(), 4);
        assertEq(a.raised(), 10 ether);
        BidInfo[] memory mine = a.bidsOf(b4);
        assertEq(mine.length, 1);
        assertEq(mine[0].id, 3);
        assertEq(mine[0].amount, 4 ether);
    }

    function test_maxPriceLevels() public {
        (LaunchAuction a,) = _launch(_p(address(tokenA), 0));
        vm.startPrank(b1);
        tokenA.approve(address(a), type(uint256).max);
        for (uint256 i = 0; i < 256; i++) {
            a.bid(1, 0.01e18 + i * 0.001e18);
        }
        a.bid(1, 0.01e18); // existing level is fine
        vm.expectRevert(LaunchAuction.TooManyPriceLevels.selector);
        a.bid(1, 0.01e18 + 256 * 0.001e18);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ successful launch, pro-rata at the margin

    function test_successProRataLifecycle() public {
        (LaunchAuction a, LaunchToken t) = _launch(_p(address(tokenA), 1000 ether));
        _bid(a, b1, 3000 ether, 0.02e18); // 150k tokens at 0.02
        _bid(a, b2, 2000 ether, 0.012e18);
        _bid(a, b3, 2000 ether, 0.012e18);
        _bid(a, b4, 1000 ether, 0.011e18);
        // at 0.012: 7000 quote buys 583k >= 500k -> clearing 0.012, level 0.012 is marginal
        assertEq(a.clearingPrice(), 0.012e18);
        assertEq(a.thresholdProgressBps(), 80_000);
        {
            (uint256 pt, uint256 pr) = a.previewClaim(1);
            assertEq(pt, 125_000e18);
            assertEq(pr, 500 ether);
        }

        vm.expectRevert(LaunchAuction.AuctionNotEnded.selector);
        a.settle();
        vm.expectRevert(LaunchAuction.NotSettled.selector);
        a.claim(0);

        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(false, false, false, false, address(a));
        emit Settled(0.012e18, 6000 ether, true, address(0));
        a.settle();
        vm.expectRevert(LaunchAuction.AlreadySettled.selector);
        a.settle();

        assertEq(uint8(a.status()), uint8(AuctionStatus.Launched));
        assertEq(a.clearingPrice(), 0.012e18);
        assertEq(a.raised(), 6000 ether); // 3000 full + 3000 of the 4000 marginal
        assertEq(a.tokensSold(), 500_000e18);

        // pool at the clearing price, LP NFT locked in the auction
        address pool = a.pool();
        assertEq(pool, v3Factory.getPool(address(t), address(tokenA), 3000));
        assertEq(IERC721(address(npm)).ownerOf(a.lpTokenId()), address(a));
        _assertPoolPrice(pool, address(t), 0.012e18, 1e18);

        // creator: proceeds not used for liquidity (3000) + reserved tokens not used
        uint256 creatorQuote = tokenA.balanceOf(creator);
        assertApproxEqRel(creatorQuote, 3000 ether, 1e12);
        {
            uint256 lpQuote = 6000 ether - creatorQuote;
            uint256 lpTokens = 500_000e18 - t.balanceOf(creator);
            assertApproxEqRel(lpQuote * 1e18 / lpTokens, 0.012e18, 1e12);
        }

        // claims
        vm.expectEmit(true, true, false, true, address(a));
        emit Claimed(0, b1, 250_000e18, 0);
        a.claim(0); // anyone may trigger; pays the bidder
        assertEq(t.balanceOf(b1), 250_000e18);
        vm.prank(b2);
        a.claimAll();
        assertEq(t.balanceOf(b2), 125_000e18);
        assertEq(tokenA.balanceOf(b2), 100_000 ether - 1500 ether);
        a.claim(2);
        a.claim(3);
        assertEq(t.balanceOf(b4), 0);
        assertEq(tokenA.balanceOf(b4), 100_000 ether);
        vm.expectRevert(LaunchAuction.AlreadyClaimed.selector);
        a.claim(0);

        // everything distributed (only rounding dust may remain)
        assertLe(t.balanceOf(address(a)), 10);
        assertLe(tokenA.balanceOf(address(a)), 10);
    }

    function test_clearingBetweenLevels() public {
        (LaunchAuction a, LaunchToken t) = _launch(_p(address(tokenA), 0));
        uint256 id1 = _bid(a, b1, 6000 ether, 0.02e18); // alone buys 300k at 0.02
        uint256 id2 = _bid(a, b2, 1000 ether, 0.01e18);
        // at 0.01 the 0.02-bid alone over-buys (600k), so clearing = 6000/500k = 0.012
        assertEq(a.clearingPrice(), 0.012e18);
        vm.warp(block.timestamp + 1 days);
        a.settle();
        a.claim(id1);
        a.claim(id2);
        assertEq(t.balanceOf(b1), 500_000e18);
        assertEq(tokenA.balanceOf(b2), 100_000 ether); // fully refunded
        assertEq(a.raised(), 6000 ether);
    }

    function test_undersubscribedLaunchesAtFloor() public {
        (LaunchAuction a, LaunchToken t) = _launch(_p(address(tokenA), 500 ether));
        uint256 id1 = _bid(a, b1, 600 ether, 0.05e18);
        uint256 id2 = _bid(a, b2, 400 ether, 0.01e18);
        assertEq(a.clearingPrice(), 0.01e18);
        vm.warp(block.timestamp + 1 days);
        a.settle();
        assertEq(uint8(a.status()), uint8(AuctionStatus.Launched));
        a.claim(id1);
        a.claim(id2);
        assertEq(t.balanceOf(b1), 60_000e18);
        assertEq(t.balanceOf(b2), 40_000e18);
        // 400k unsold auction tokens + 450k unused reserve go to the creator (LP took 50k tokens + 500 quote)
        assertApproxEqRel(t.balanceOf(creator), 850_000e18, 1e12);
    }

    function test_failedLaunchRefundsEveryone() public {
        (LaunchAuction a, LaunchToken t) = _launch(_p(address(tokenA), 10_000 ether));
        uint256 id1 = _bid(a, b1, 3000 ether, 0.02e18);
        uint256 id2 = _bid(a, b2, 2000 ether, 0.01e18);
        assertEq(a.thresholdProgressBps(), 5000);
        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(false, false, false, true, address(a));
        emit Settled(0.01e18, 5000 ether, false, address(0));
        a.settle();
        assertEq(uint8(a.status()), uint8(AuctionStatus.Failed));
        assertEq(a.pool(), address(0));
        vm.expectEmit(true, true, false, true, address(a));
        emit Claimed(id1, b1, 0, 3000 ether);
        a.claim(id1);
        vm.prank(b2);
        a.claimAll();
        assertEq(tokenA.balanceOf(b1), 100_000 ether);
        assertEq(tokenA.balanceOf(b2), 100_000 ether);
        assertEq(t.balanceOf(b1), 0);
        assertEq(tokenA.balanceOf(creator), 0);
    }

    function test_noBidsFails() public {
        (LaunchAuction a,) = _launch(_p(address(tokenA), 0));
        vm.warp(block.timestamp + 1 days);
        a.settle();
        assertEq(uint8(a.status()), uint8(AuctionStatus.Failed));
    }

    // ------------------------------------------------------------ 6-decimals quote + trading the new pool

    function test_usdcQuoteLaunchAndTrade() public {
        LaunchParams memory p = _p(address(usdc), 1_000e6);
        p.floorPrice = 0.05e18; // $0.05
        p.tickSize = 0.01e18;
        (LaunchAuction a, LaunchToken t) = _launch(p);
        assertEq(a.fdvAtFloor(), 50_000e6);
        uint256 id1 = _bid(a, b1, 20_000e6, 0.1e18);
        uint256 id2 = _bid(a, b2, 20_000e6, 0.06e18);
        // at 0.06: 40k USDC buys 666k >= 500k; above-level alone (20k) buys 333k at 0.06 -> clearing 0.06 marginal
        assertEq(a.clearingPrice(), 0.06e18);
        vm.warp(block.timestamp + 1 days);
        a.settle();
        a.claim(id1);
        a.claim(id2);
        uint256 t1 = t.balanceOf(b1);
        assertApproxEqAbs(t1, uint256(20_000e6) * 1e18 / 0.06e6, 1e6);
        assertApproxEqAbs(t.balanceOf(b2), 500_000e18 - t1, 1e6);
        _assertPoolPrice(a.pool(), address(t), 0.06e18, 1e6);

        // the graduated token trades on MetaSwap V3 at ~ the clearing price
        usdc.mint(address(this), 100e6);
        usdc.approve(address(swapRouter02), 100e6);
        uint256 out = swapRouter02.exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: address(t),
                fee: 3000,
                recipient: address(this),
                amountIn: 100e6,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        assertApproxEqRel(out, uint256(100e18) * 1e18 / 0.06e18, 0.01e18); // ~1666 tokens, within 1% (fee+impact)
    }

    // ------------------------------------------------------------ WETH quote + native ETH bids

    function test_wethQuoteNativeBidsRefundETH() public {
        LaunchParams memory p = _p(address(weth), 50 ether);
        p.floorPrice = 0.00001e18;
        p.tickSize = 0.00001e18;
        (LaunchAuction a,) = _launch(p);
        vm.prank(b1);
        uint256 id = a.bidETH{value: 3 ether}(0.00002e18);
        assertEq(weth.balanceOf(address(a)), 3 ether);
        vm.warp(block.timestamp + 1 days);
        a.settle(); // 3 ETH < 50 ETH threshold -> failed
        uint256 before = b1.balance;
        a.claim(id);
        assertEq(b1.balance - before, 3 ether);
    }

    function test_wethQuoteNativeLaunch() public {
        LaunchParams memory p = _p(address(weth), 1 ether);
        p.floorPrice = 0.00001e18;
        p.tickSize = 0.00001e18;
        (LaunchAuction a, LaunchToken t) = _launch(p);
        vm.prank(b1);
        uint256 id1 = a.bidETH{value: 4 ether}(0.00002e18);
        vm.prank(b2);
        uint256 id2 = a.bidETH{value: 8 ether}(0.00002e18);
        // 12 ETH at 0.00002 wants 600k > 500k -> marginal at 0.00002, each gets 5/6, 1/6 refunded in ETH
        vm.warp(block.timestamp + 1 days);
        a.settle();
        assertEq(a.clearingPrice(), 0.00002e18);
        uint256 before = b2.balance;
        a.claim(id1);
        a.claim(id2);
        assertApproxEqAbs(t.balanceOf(b2), uint256(500_000e18) * 2 / 3, 1e6);
        assertApproxEqAbs(b2.balance - before, uint256(8 ether) / 6, 1e6);
        _assertPoolPrice(a.pool(), address(t), 0.00002e18, 1e18);
    }

    function test_bidETHRequiresWethQuote() public {
        (LaunchAuction a,) = _launch(_p(address(tokenA), 0));
        vm.prank(b1);
        vm.expectRevert(LaunchAuction.NotWethQuote.selector);
        a.bidETH{value: 1 ether}(0.01e18);
    }

    // ------------------------------------------------------------ helpers

    /// @dev pool price (quote per whole token, 1e18-scaled) == expected within 0.01%
    function _assertPoolPrice(address pool, address token, uint256 expected, uint256 quoteUnit) internal view {
        (uint160 sqrtP,,,,,,) = IMetaSwapV3Pool(pool).slot0();
        // raw price token1/token0 (base units) as 1e36-fixed
        uint256 raw = Math.mulDiv(Math.mulDiv(sqrtP, sqrtP, 1 << 96), 1e36, 1 << 96);
        uint256 quotePerTokenRaw = IMetaSwapV3Pool(pool).token0() == token ? raw : 1e72 / raw;
        // quote base units per token base unit (1e36-fixed) -> whole quote per whole token (1e18-scaled)
        uint256 price = quotePerTokenRaw / quoteUnit;
        assertApproxEqRel(price, expected, 1e14);
    }
}
