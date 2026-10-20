// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FullMath} from "../../src/amm/v3/libraries/FullMath.sol";
import {TickMath} from "../../src/amm/v3/libraries/TickMath.sol";

/// @notice Shared constants and helpers for the MetaSwap AMM deploy / seed scripts and tests.
library MetaSwapConfig {
    /// @dev Anvil's default mnemonic (local devnet only; never holds real funds).
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    /// @dev Anvil account #0 private key (local devnet only).
    uint256 internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    string internal constant DEPLOYMENTS_PATH = "deployments/31337.json";

    /// @dev USD prices are expressed with 6 decimals (1e6 == $1).
    uint256 internal constant USD = 1e6;

    struct TokenSpec {
        string symbol;
        string name;
        uint8 decimals;
        uint256 priceUsd6; // seed USD price * 1e6
        string priceJson; // seed USD price as a JSON number literal
        uint256 faucetAmount; // base units minted per faucet() call
    }

    /// @notice The 8 seed tokens from PLAN.md, in deployment order (index 0 is WETH = WETH9).
    function tokenSpecs() internal pure returns (TokenSpec[] memory s) {
        s = new TokenSpec[](8);
        s[0] = TokenSpec("WETH", "Wrapped Ether", 18, 3000 * USD, "3000", 0);
        s[1] = TokenSpec("mUSDC", "Meta USD Coin", 6, 1 * USD, "1", 10_000e6);
        s[2] = TokenSpec("mUSDT", "Meta Tether", 6, 1 * USD, "1", 10_000e6);
        s[3] = TokenSpec("mDAI", "Meta Dai", 18, 1 * USD, "1", 10_000e18);
        s[4] = TokenSpec("mWBTC", "Meta Wrapped BTC", 8, 60_000 * USD, "60000", 0.2e8);
        s[5] = TokenSpec("META", "MetaSwap", 18, 8 * USD, "8", 1_000e18);
        s[6] = TokenSpec("mLINK", "Meta Chainlink", 18, 15 * USD, "15", 500e18);
        s[7] = TokenSpec("mARB", "Meta Arbitrum", 18, 800_000, "0.8", 10_000e18);
    }

    /// @notice Converts a USD value (6 decimals) into base units of a token with the given price/decimals.
    function usdToAmount(uint256 usd6, uint256 priceUsd6, uint8 decimals) internal pure returns (uint256) {
        return FullMath.mulDiv(usd6, 10 ** decimals, priceUsd6);
    }

    /// @notice sqrtPriceX96 of a pool (token0, token1) given each token's USD price and decimals.
    /// price (token1 base units per token0 base unit) = (p0 / p1) * 10^(d1 - d0)
    function sqrtPriceX96(uint256 p0Usd6, uint8 d0, uint256 p1Usd6, uint8 d1) internal pure returns (uint160) {
        uint256 ratioX192 = FullMath.mulDiv(p0Usd6 * 10 ** d1, 1 << 192, p1Usd6 * 10 ** d0);
        return uint160(Math.sqrt(ratioX192));
    }

    /// @notice Lowest usable tick for a tick spacing.
    function minUsableTick(int24 spacing) internal pure returns (int24) {
        return (TickMath.MIN_TICK / spacing) * spacing;
    }

    /// @notice Highest usable tick for a tick spacing.
    function maxUsableTick(int24 spacing) internal pure returns (int24) {
        return (TickMath.MAX_TICK / spacing) * spacing;
    }

    /// @notice Rounds a tick down to a multiple of `spacing` (towards negative infinity).
    function floorTick(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 compressed = tick / spacing;
        if (tick < 0 && tick % spacing != 0) compressed--;
        return compressed * spacing;
    }
}
