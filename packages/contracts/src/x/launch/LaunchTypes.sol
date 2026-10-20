// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

/// @notice Parameters of a MetaSwap token launch (see docs/specs/STAGE5.md §1b).
/// @dev Prices (`floorPrice`, `tickSize`, bid `maxPrice`, `clearingPrice`) are "whole quote tokens per whole
///      launch token" scaled by 1e18, independent of the quote token's decimals. Example: 0.05 mUSDC per token
///      = 5e16. Launch tokens always have 18 decimals.
struct LaunchParams {
    string name;
    string symbol;
    uint256 totalSupply; // launch token base units (18 decimals)
    uint256 auctionSupplyBps; // share of totalSupply sold in the auction (1..9999); the rest is reserved for liquidity
    address quoteToken; // mUSDC or WETH (any ERC20 with decimals())
    uint256 floorPrice; // 1e18-scaled quote per whole token
    uint256 tickSize; // bid prices must be multiples of this (1e18-scaled)
    uint256 startTime;
    uint256 endTime;
    uint256 launchThreshold; // minimum raise, in quote base units
    uint256 liquidityBps; // share of the raise paired with reserved tokens in the V3 pool (1..10000)
    uint24 poolFee; // V3 fee tier
    string description;
    string website;
}

/// @notice Auction lifecycle. Numeric values are part of the API: 0 Upcoming, 1 Active, 2 Ended, 3 Launched, 4 Failed.
enum AuctionStatus {
    Upcoming,
    Active,
    Ended,
    Launched,
    Failed
}

/// @notice A bid as returned by `LaunchAuction.bidsOf` / `getBid`.
struct BidInfo {
    uint256 id;
    address bidder;
    uint256 amount; // quote base units committed
    uint256 maxPrice; // 1e18-scaled
    bool native; // placed with bidETH (refunds are paid in ETH)
    bool claimed;
}
