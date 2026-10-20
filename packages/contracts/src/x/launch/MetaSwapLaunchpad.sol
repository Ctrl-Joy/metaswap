// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IMetaSwapV3Factory} from "@metaswap/amm/v3/interfaces/IMetaSwapV3Factory.sol";
import {LaunchParams} from "./LaunchTypes.sol";
import {LaunchAuction} from "./LaunchAuction.sol";
import {LaunchToken} from "./LaunchToken.sol";

/// @title MetaSwapLaunchpad
/// @notice Token-launch factory: each launch deploys a LaunchToken (whole supply minted to its auction) and a
///         uniform-price LaunchAuction that graduates into a MetaSwap V3 pool.
contract MetaSwapLaunchpad is Ownable {
    event LaunchCreated(
        address indexed token, address indexed auction, address indexed creator, string name, string symbol
    );
    event VerifiedSet(address indexed auction, bool verified);

    /// @dev code: 1 name/symbol, 2 totalSupply, 3 auctionSupplyBps, 4 liquidityBps, 5 quoteToken, 6 price, 7 time, 8 poolFee
    error InvalidParams(uint8 code);
    error UnknownAuction();

    /// @notice display name of this launchpad (e.g. "MetaSwap Launchpad")
    string public name;
    address public immutable v3Factory;
    address public immutable positionManager;
    address public immutable weth;

    address[] internal _launches; // auctions
    mapping(address => bool) public isLaunch;
    mapping(address => bool) public verified;

    constructor(string memory name_, address v3Factory_, address positionManager_, address weth_, address owner_)
        Ownable(owner_)
    {
        name = name_;
        v3Factory = v3Factory_;
        positionManager = positionManager_;
        weth = weth_;
    }

    /// @notice Create a token and its auction. msg.sender becomes the creator (receives proceeds).
    function createLaunch(LaunchParams calldata p) external returns (address token, address auction) {
        _validate(p);
        LaunchParams memory lp = p;
        if (lp.startTime < block.timestamp) lp.startTime = block.timestamp;

        LaunchAuction a = new LaunchAuction(lp, msg.sender, v3Factory, positionManager, weth);
        auction = address(a);
        token = address(new LaunchToken(p.name, p.symbol, p.totalSupply, auction));
        a.initialize(token);

        _launches.push(auction);
        isLaunch[auction] = true;
        emit LaunchCreated(token, auction, msg.sender, p.name, p.symbol);
    }

    function _validate(LaunchParams calldata p) internal view {
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams(1);
        if (p.totalSupply == 0 || p.totalSupply > 1e36) revert InvalidParams(2);
        if (p.auctionSupplyBps == 0 || p.auctionSupplyBps >= 10_000) revert InvalidParams(3);
        if (p.liquidityBps == 0 || p.liquidityBps > 10_000) revert InvalidParams(4);
        if (p.quoteToken == address(0) || p.quoteToken.code.length == 0) revert InvalidParams(5);
        if (p.tickSize == 0 || p.floorPrice == 0) revert InvalidParams(6);
        if (p.endTime <= p.startTime || p.endTime <= block.timestamp) revert InvalidParams(7);
        if (IMetaSwapV3Factory(v3Factory).feeAmountTickSpacing(p.poolFee) == 0) revert InvalidParams(8);
    }

    // ------------------------------------------------------------------ owner

    function setVerified(address auction, bool v) external onlyOwner {
        if (!isLaunch[auction]) revert UnknownAuction();
        verified[auction] = v;
        emit VerifiedSet(auction, v);
    }

    // ------------------------------------------------------------------ views

    function allLaunches() external view returns (address[] memory) {
        return _launches;
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }
}
