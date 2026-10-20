// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMetaSwapV3Factory} from "@metaswap/amm/v3/interfaces/IMetaSwapV3Factory.sol";
import {INonfungiblePositionManager} from "@metaswap/amm/v3/interfaces/INonfungiblePositionManager.sol";
import {LaunchParams, AuctionStatus, BidInfo} from "./LaunchTypes.sol";

interface IWETH9Minimal {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title LaunchAuction
/// @notice Uniform-price batch auction for a LaunchToken (inspired by Uniswap's continuous clearing auctions,
///         simplified). Bidders commit quote tokens with a max price; at `settle()` a single clearing price is
///         computed: bids above it fill fully (all committed quote is spent at the clearing price), bids at it
///         fill pro-rata, bids below are refunded. On success `liquidityBps` of the proceeds plus reserved tokens
///         seed a full-range MetaSwap V3 pool at the clearing price; the LP NFT stays locked in this contract.
/// @dev Price unit: 1e18-scaled whole-quote per whole-token (see LaunchTypes.sol).
///      tokens(q, p) = q * 1e36 / (p * 10^quoteDecimals);  quote(t, p) = t * p * 10^quoteDecimals / 1e36.
contract LaunchAuction is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_PRICE_LEVELS = 256;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant PRICE_SCALE = 1e36; // 1e18 price scale * 1e18 token decimals

    // ------------------------------------------------------------------ events (indexed by the API)
    event BidPlaced(uint256 indexed bidId, address indexed bidder, uint256 amount, uint256 maxPrice);
    event Settled(uint256 clearingPrice, uint256 raised, bool launched, address pool);
    event Claimed(uint256 indexed bidId, address indexed bidder, uint256 tokens, uint256 refund);

    error NotLaunchpad();
    error AlreadyInitialized();
    error AuctionNotActive();
    error AuctionNotEnded();
    error AlreadySettled();
    error NotSettled();
    error InvalidAmount();
    error InvalidPrice();
    error TooManyPriceLevels();
    error NotWethQuote();
    error AlreadyClaimed();
    error UnknownBid();
    error ETHTransferFailed();

    address public immutable launchpad;
    address public immutable creator;
    IMetaSwapV3Factory public immutable v3Factory;
    INonfungiblePositionManager public immutable positionManager;
    address public immutable weth;
    IERC20 public immutable quoteToken;
    uint256 public immutable quoteScale; // 10^quoteDecimals
    uint256 public immutable auctionSupply;
    uint256 public immutable reserveSupply;

    LaunchParams internal _params;
    address public token;
    address public pool;
    uint256 public lpTokenId;

    // bid book
    uint256[] internal levelPrices; // ascending
    mapping(uint256 => uint256) public demandAt; // price => committed quote
    BidInfo[] internal _bids;
    mapping(address => uint256[]) internal _bidIdsOf;
    uint256 public totalCommitted;

    // settlement
    bool public settled;
    bool public launched;
    uint256 internal settledClearingPrice;
    uint256 public proceeds;
    uint256 public marginalDemand; // quote committed at exactly the clearing price
    uint256 public marginalSpent; // quote of the marginal level actually spent
    uint256 public marginalTokens; // tokens allocated to the marginal level
    uint256 public tokensSold;

    constructor(LaunchParams memory p, address creator_, address v3Factory_, address positionManager_, address weth_) {
        launchpad = msg.sender;
        creator = creator_;
        v3Factory = IMetaSwapV3Factory(v3Factory_);
        positionManager = INonfungiblePositionManager(positionManager_);
        weth = weth_;
        quoteToken = IERC20(p.quoteToken);
        quoteScale = 10 ** IERC20Metadata(p.quoteToken).decimals();
        auctionSupply = (p.totalSupply * p.auctionSupplyBps) / BPS;
        reserveSupply = p.totalSupply - auctionSupply;
        _params = p;
    }

    /// @notice Called once by the launchpad right after the token (whose whole supply is minted here) is created.
    function initialize(address token_) external {
        if (msg.sender != launchpad) revert NotLaunchpad();
        if (token != address(0)) revert AlreadyInitialized();
        token = token_;
    }

    // ------------------------------------------------------------------ bidding

    /// @notice Commit `amount` quote tokens at a maximum price of `maxPrice` (1e18-scaled, multiple of tickSize).
    function bid(uint256 amount, uint256 maxPrice) external nonReentrant returns (uint256 bidId) {
        _checkBid(amount, maxPrice);
        quoteToken.safeTransferFrom(msg.sender, address(this), amount);
        bidId = _record(msg.sender, amount, maxPrice, false);
    }

    /// @notice Bid with native ETH (quote token must be WETH). Refunds for this bid are paid in ETH.
    function bidETH(uint256 maxPrice) external payable nonReentrant returns (uint256 bidId) {
        if (address(quoteToken) != weth) revert NotWethQuote();
        _checkBid(msg.value, maxPrice);
        IWETH9Minimal(weth).deposit{value: msg.value}();
        bidId = _record(msg.sender, msg.value, maxPrice, true);
    }

    function _checkBid(uint256 amount, uint256 maxPrice) internal view {
        if (status() != AuctionStatus.Active) revert AuctionNotActive();
        if (amount == 0) revert InvalidAmount();
        if (maxPrice < _params.floorPrice || maxPrice % _params.tickSize != 0) revert InvalidPrice();
    }

    function _record(address bidder, uint256 amount, uint256 maxPrice, bool native) internal returns (uint256 bidId) {
        if (demandAt[maxPrice] == 0) _insertLevel(maxPrice);
        demandAt[maxPrice] += amount;
        totalCommitted += amount;
        bidId = _bids.length;
        _bids.push(
            BidInfo({id: bidId, bidder: bidder, amount: amount, maxPrice: maxPrice, native: native, claimed: false})
        );
        _bidIdsOf[bidder].push(bidId);
        emit BidPlaced(bidId, bidder, amount, maxPrice);
    }

    /// @dev keeps `levelPrices` sorted ascending
    function _insertLevel(uint256 price) internal {
        uint256 n = levelPrices.length;
        if (n >= MAX_PRICE_LEVELS) revert TooManyPriceLevels();
        levelPrices.push(price);
        uint256 i = n;
        while (i > 0 && levelPrices[i - 1] > price) {
            levelPrices[i] = levelPrices[i - 1];
            i--;
        }
        levelPrices[i] = price;
    }

    // ------------------------------------------------------------------ views

    function params() external view returns (LaunchParams memory) {
        return _params;
    }

    function status() public view returns (AuctionStatus) {
        if (settled) return launched ? AuctionStatus.Launched : AuctionStatus.Failed;
        if (block.timestamp < _params.startTime) return AuctionStatus.Upcoming;
        if (block.timestamp < _params.endTime) return AuctionStatus.Active;
        return AuctionStatus.Ended;
    }

    /// @notice Number of bids placed.
    function totalBids() external view returns (uint256) {
        return _bids.length;
    }

    /// @notice Quote committed so far; after settlement, the proceeds actually raised at the clearing price.
    function raised() public view returns (uint256) {
        return settled ? proceeds : totalCommitted;
    }

    /// @notice raised / launchThreshold in bps (can exceed 10000; 10000 if the threshold is 0).
    function thresholdProgressBps() external view returns (uint256) {
        if (_params.launchThreshold == 0) return BPS;
        return (raised() * BPS) / _params.launchThreshold;
    }

    /// @notice Bid distribution: price levels ascending and the quote committed at each.
    function priceLevels() external view returns (uint256[] memory prices, uint256[] memory demand) {
        uint256 n = levelPrices.length;
        prices = new uint256[](n);
        demand = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            prices[i] = levelPrices[i];
            demand[i] = demandAt[levelPrices[i]];
        }
    }

    function bidsOf(address bidder) external view returns (BidInfo[] memory out) {
        uint256[] storage ids = _bidIdsOf[bidder];
        out = new BidInfo[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            out[i] = _bids[ids[i]];
        }
    }

    /// @notice floorPrice × totalSupply, in quote base units.
    function fdvAtFloor() external view returns (uint256) {
        return _quoteFor(_params.totalSupply, _params.floorPrice, Math.Rounding.Floor);
    }

    /// @notice Uniform clearing price (final after settlement, live estimate before).
    /// @dev The highest price p at which the quote committed at >= p buys at least `auctionSupply` tokens at p
    ///      (searched over bid levels; between two levels the price where the higher bids alone buy the supply,
    ///      rounded up to the tick). The floor if demand cannot buy the whole supply at the floor.
    function clearingPrice() public view returns (uint256) {
        if (settled) return settledClearingPrice;
        (uint256 c,,) = _computeClearing();
        return c;
    }

    /// @notice Tokens and refund a bid would get if the auction settled successfully at the current clearing price.
    function previewClaim(uint256 bidId) external view returns (uint256 tokens, uint256 refund) {
        if (bidId >= _bids.length) revert UnknownBid();
        BidInfo memory b = _bids[bidId];
        if (settled) {
            if (!launched) return (0, b.amount);
            return _allocation(b, settledClearingPrice, marginalDemand, marginalTokens, marginalSpent);
        }
        (uint256 c, uint256 full, uint256 md) = _computeClearing();
        (uint256 mTokens, uint256 mSpent) = _marginal(c, full, md);
        return _allocation(b, c, md, mTokens, mSpent);
    }

    // ------------------------------------------------------------------ settlement

    /// @notice Settle the auction (anyone, after endTime). Launches (creates the pool) if the raise reaches the
    ///         threshold, otherwise marks the auction Failed so every bid can be refunded.
    function settle() external nonReentrant {
        if (settled) revert AlreadySettled();
        if (block.timestamp < _params.endTime) revert AuctionNotEnded();
        settled = true;

        (uint256 c, uint256 full, uint256 md) = _computeClearing();
        (uint256 mTokens, uint256 mSpent) = _marginal(c, full, md);
        uint256 tFull = _tokensFor(full, c);
        uint256 sold = tFull + mTokens;
        uint256 raise = full + mSpent;

        settledClearingPrice = c;
        marginalDemand = md;
        marginalSpent = mSpent;
        marginalTokens = mTokens;
        proceeds = raise;

        if (raise == 0 || sold == 0 || raise < _params.launchThreshold) {
            launched = false;
            emit Settled(c, raise, false, address(0));
            return;
        }
        launched = true;
        tokensSold = sold;

        // ---- seed the V3 pool at the clearing price
        uint256 lpQuote = (raise * _params.liquidityBps) / BPS;
        uint256 lpTokens = _tokensFor(lpQuote, c);
        if (lpTokens > reserveSupply) {
            lpTokens = reserveSupply;
            lpQuote = _quoteFor(lpTokens, c, Math.Rounding.Floor);
        }
        (uint256 usedTokens, uint256 usedQuote) = _seedPool(c, lpTokens, lpQuote);

        // ---- the rest goes to the creator: unsold + unused reserved tokens, proceeds not used for liquidity
        uint256 creatorTokens = (reserveSupply - usedTokens) + (auctionSupply - sold);
        if (creatorTokens > 0) IERC20(token).safeTransfer(creator, creatorTokens);
        uint256 creatorQuote = raise - usedQuote;
        if (creatorQuote > 0) quoteToken.safeTransfer(creator, creatorQuote);

        emit Settled(c, raise, true, pool);
    }

    function _seedPool(uint256 c, uint256 lpTokens, uint256 lpQuote)
        internal
        returns (uint256 usedTokens, uint256 usedQuote)
    {
        if (lpTokens == 0 || lpQuote == 0) return (0, 0);
        bool tokenIs0 = token < address(quoteToken);
        _createPool(c, tokenIs0);

        IERC20(token).forceApprove(address(positionManager), lpTokens);
        quoteToken.forceApprove(address(positionManager), lpQuote);
        (uint256 amount0, uint256 amount1) =
            tokenIs0 ? _mintFullRange(lpTokens, lpQuote) : _mintFullRange(lpQuote, lpTokens);
        (usedTokens, usedQuote) = tokenIs0 ? (amount0, amount1) : (amount1, amount0);
        IERC20(token).forceApprove(address(positionManager), 0);
        quoteToken.forceApprove(address(positionManager), 0);
    }

    function _sortedPair() internal view returns (address token0, address token1) {
        address quote = address(quoteToken);
        (token0, token1) = token < quote ? (token, quote) : (quote, token);
    }

    /// @dev creates + initializes the pool at clearing price `c`
    function _createPool(uint256 c, bool tokenIs0) internal {
        // V3 price = token1 base units per token0 base unit; launch price (quote/token) = c * quoteScale / 1e36
        uint256 ratioX192 = tokenIs0
            ? Math.mulDiv(c * quoteScale, 1 << 192, PRICE_SCALE)
            : Math.mulDiv(PRICE_SCALE, 1 << 192, c * quoteScale);
        uint160 sqrtPriceX96 = uint160(Math.sqrt(ratioX192));
        (address token0, address token1) = _sortedPair();
        pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, _params.poolFee, sqrtPriceX96);
    }

    /// @dev mints a full-range position owned by this contract (LP NFT locked forever)
    function _mintFullRange(uint256 amount0Desired, uint256 amount1Desired)
        internal
        returns (uint256 amount0, uint256 amount1)
    {
        (address token0, address token1) = _sortedPair();
        int24 spacing = v3Factory.feeAmountTickSpacing(_params.poolFee);
        int24 maxTick = (int24(887272) / spacing) * spacing;
        uint256 tokenId;
        (tokenId,, amount0, amount1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: _params.poolFee,
                tickLower: -maxTick,
                tickUpper: maxTick,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        lpTokenId = tokenId;
    }

    // ------------------------------------------------------------------ claims

    /// @notice Pay out a settled bid (tokens + refund) to its bidder. Anyone may call.
    function claim(uint256 bidId) public nonReentrant {
        _claim(bidId);
    }

    /// @notice Claim every unclaimed bid of msg.sender.
    function claimAll() external nonReentrant {
        uint256[] storage ids = _bidIdsOf[msg.sender];
        for (uint256 i = 0; i < ids.length; i++) {
            if (!_bids[ids[i]].claimed) _claim(ids[i]);
        }
    }

    function _claim(uint256 bidId) internal {
        if (!settled) revert NotSettled();
        if (bidId >= _bids.length) revert UnknownBid();
        BidInfo storage b = _bids[bidId];
        if (b.claimed) revert AlreadyClaimed();
        b.claimed = true;

        uint256 tokens;
        uint256 refund;
        if (launched) {
            (tokens, refund) = _allocation(b, settledClearingPrice, marginalDemand, marginalTokens, marginalSpent);
        } else {
            refund = b.amount;
        }

        if (tokens > 0) IERC20(token).safeTransfer(b.bidder, tokens);
        if (refund > 0) {
            if (b.native) {
                IWETH9Minimal(weth).withdraw(refund);
                (bool ok,) = b.bidder.call{value: refund}("");
                if (!ok) revert ETHTransferFailed();
            } else {
                quoteToken.safeTransfer(b.bidder, refund);
            }
        }
        emit Claimed(bidId, b.bidder, tokens, refund);
    }

    // ------------------------------------------------------------------ math

    function _allocation(BidInfo memory b, uint256 c, uint256 md, uint256 mTokens, uint256 mSpent)
        internal
        view
        returns (uint256 tokens, uint256 refund)
    {
        if (b.maxPrice > c) {
            tokens = _tokensFor(b.amount, c);
        } else if (b.maxPrice == c && md > 0) {
            tokens = Math.mulDiv(b.amount, mTokens, md);
            uint256 spent = Math.mulDiv(b.amount, mSpent, md, Math.Rounding.Ceil);
            refund = b.amount - spent;
        } else {
            refund = b.amount;
        }
    }

    /// @dev tokens and quote spent at the marginal level, given the clearing price and full demand above it
    function _marginal(uint256 c, uint256 full, uint256 md) internal view returns (uint256 mTokens, uint256 mSpent) {
        uint256 tFull = _tokensFor(full, c);
        uint256 remaining = auctionSupply > tFull ? auctionSupply - tFull : 0;
        uint256 wanted = _tokensFor(md, c);
        if (wanted <= remaining) return (wanted, md);
        mTokens = remaining;
        mSpent = Math.min(md, _quoteFor(remaining, c, Math.Rounding.Ceil));
    }

    /// @return c clearing price, full quote committed strictly above c, md quote committed exactly at c
    function _computeClearing() internal view returns (uint256 c, uint256 full, uint256 md) {
        uint256 n = levelPrices.length;
        uint256 floor = _params.floorPrice;
        if (n == 0) return (floor, 0, 0);
        uint256 supply = auctionSupply;
        uint256 above = 0;
        for (uint256 i = n; i > 0; i--) {
            uint256 p = levelPrices[i - 1];
            uint256 d = demandAt[p];
            if (above > 0 && _tokensFor(above, p) >= supply) {
                // bids above p alone buy the supply somewhere in (p, levelPrices[i]]
                uint256 pStar = Math.mulDiv(above, PRICE_SCALE, supply * quoteScale, Math.Rounding.Ceil);
                uint256 tick = _params.tickSize;
                c = Math.ceilDiv(pStar, tick) * tick;
                uint256 next = levelPrices[i];
                if (c >= next) return (next, above - demandAt[next], demandAt[next]);
                if (c <= p) return (p, above, d);
                return (c, above, 0);
            }
            if (_tokensFor(above + d, p) >= supply) return (p, above, d);
            above += d;
        }
        // undersubscribed: everything fills at the floor
        md = demandAt[floor];
        return (floor, above - md, md);
    }

    function _tokensFor(uint256 quoteAmount, uint256 price) internal view returns (uint256) {
        return Math.mulDiv(quoteAmount, PRICE_SCALE, price * quoteScale);
    }

    function _quoteFor(uint256 tokens, uint256 price, Math.Rounding r) internal view returns (uint256) {
        return Math.mulDiv(tokens, price * quoteScale, PRICE_SCALE, r);
    }

    // ------------------------------------------------------------------ misc

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {
        if (msg.sender != weth) revert ETHTransferFailed();
    }
}
