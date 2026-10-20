// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {WETH9} from "../src/amm/tokens/WETH9.sol";
import {TestERC20} from "../src/amm/tokens/TestERC20.sol";
import {Multicall3} from "../src/amm/utils/Multicall3.sol";
import {IMetaSwapV2Factory} from "../src/amm/v2/interfaces/IMetaSwapV2Factory.sol";
import {IMetaSwapV2Pair} from "../src/amm/v2/interfaces/IMetaSwapV2Pair.sol";
import {IMetaSwapV2Router02} from "../src/amm/v2/interfaces/IMetaSwapV2Router02.sol";
import {IMetaSwapV3Factory} from "../src/amm/v3/interfaces/IMetaSwapV3Factory.sol";
import {IMetaSwapV3Pool} from "../src/amm/v3/interfaces/IMetaSwapV3Pool.sol";
import {INonfungiblePositionManager} from "../src/amm/v3/interfaces/INonfungiblePositionManager.sol";
import {IPoolInitializer} from "../src/amm/v3/interfaces/IPoolInitializer.sol";
import {IMulticall} from "../src/amm/v3/interfaces/IMulticall.sol";
import {IPeripheryPayments} from "../src/amm/v3/interfaces/IPeripheryPayments.sol";
import {ISwapRouter02} from "../src/amm/v3/interfaces/ISwapRouter02.sol";
import {IV3SwapRouter} from "../src/amm/v3/interfaces/IV3SwapRouter.sol";
import {TickMath} from "../src/amm/v3/libraries/TickMath.sol";
import {MetaSwapConfig} from "./lib/MetaSwapConfig.sol";

/// @title Seed
/// @notice Seeds a freshly deployed MetaSwap AMM (see DeployAMM.s.sol) with pools, deep liquidity and swap history.
/// @dev Run ONLY on a fresh chain right after DeployAMM (it refuses to run if any V2 pair already exists):
///        forge script script/Seed.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///      Accounts (Anvil default mnemonic, local devnet only):
///        #0  mints test tokens to #0..#5 (one Multicall3 tx), wraps ETH, owns all V2 LP and the V3 full-range
///            positions, and funds the V3 concentrated positions minted to #1 (wide) and #2 (narrow)
///        #1..#5 approve the routers via EIP-2612 permits (signed off-chain, submitted by #0 in one Multicall3 tx)
///            and perform the swap history: V2Router02 (incl. ETH-in and exact-out), SwapRouter02 exact-in/out
///            single-hop (incl. ETH-in + refundETH multicall) and multi-hop.
///      Anvil mines multi-sender scripts one tx per block, so the script keeps the tx count low (~100 txs).
contract Seed is Script {
    uint256 internal constant N_ACCOUNTS = 6;
    uint256 internal constant N_SWAPS = 60;
    /// @dev Explicit gas limit for swap txs. Forge re-simulates all broadcast txs in a single block, which hides the
    ///      V2 price-accumulator / V3 oracle SSTOREs that happen on-chain when each tx lands in its own block, so
    ///      estimated limits can be too low (out-of-gas). A fixed generous limit avoids that.
    uint256 internal constant SWAP_GAS = 1_000_000;

    // deployment
    address internal weth;
    Multicall3 internal multicall3;
    IMetaSwapV2Factory internal v2Factory;
    IMetaSwapV2Router02 internal v2Router;
    IMetaSwapV3Factory internal v3Factory;
    INonfungiblePositionManager internal npm;
    ISwapRouter02 internal swapRouter;

    MetaSwapConfig.TokenSpec[] internal specs;
    address[] internal tokens;
    uint256[N_ACCOUNTS] internal keys;
    address[N_ACCOUNTS] internal accts;

    // token indices (MetaSwapConfig.tokenSpecs order)
    uint8 internal constant WETH_ = 0;
    uint8 internal constant USDC = 1;
    uint8 internal constant USDT = 2;
    uint8 internal constant DAI = 3;
    uint8 internal constant WBTC = 4;
    uint8 internal constant META = 5;
    uint8 internal constant LINK = 6;
    uint8 internal constant ARB = 7;

    struct V2Spec {
        uint8 a;
        uint8 b;
        uint256 usdPerSide; // 6 decimals
    }

    struct V3Spec {
        uint8 a;
        uint8 b;
        uint24 fee;
        uint256 fullUsd; // per side, full range, owned by #0
        uint256 wideUsd; // per side, owned by #1
        int24 wideDelta; // +-ticks around the current tick
        uint256 narrowUsd; // per side, owned by #2
        int24 narrowDelta;
    }

    struct PoolRef {
        bool isV3;
        address pool;
        uint8 a; // token index (unsorted)
        uint8 b;
        uint24 fee;
        uint256 maxSwapUsd;
    }

    PoolRef[] internal poolRefs;

    function run() external {
        _load();
        require(v2Factory.allPairsLength() == 0, "Seed: chain already seeded - restart anvil, DeployAMM, then Seed");

        _fundAndApprove();
        _seedV2();
        _seedV3();
        _swapHistory();
        _writePools();
    }

    /// @dev Advances the *simulated* clock before each broadcast tx. On Anvil every tx of a multi-sender script lands
    ///      in its own block, so V2 price accumulators / V3 oracle writes happen on-chain; simulating them keeps
    ///      forge's gas estimates from coming out too low.
    function _nextBlock() internal {
        vm.warp(block.timestamp + 1);
        vm.roll(block.number + 1);
    }

    // ------------------------------------------------------------------ setup

    function _load() internal {
        string memory json = vm.readFile(MetaSwapConfig.DEPLOYMENTS_PATH);
        weth = vm.parseJsonAddress(json, ".contracts.WETH9");
        multicall3 = Multicall3(vm.parseJsonAddress(json, ".contracts.Multicall3"));
        v2Factory = IMetaSwapV2Factory(vm.parseJsonAddress(json, ".contracts.V2Factory"));
        v2Router = IMetaSwapV2Router02(vm.parseJsonAddress(json, ".contracts.V2Router02"));
        v3Factory = IMetaSwapV3Factory(vm.parseJsonAddress(json, ".contracts.V3Factory"));
        npm = INonfungiblePositionManager(vm.parseJsonAddress(json, ".contracts.NonfungiblePositionManager"));
        swapRouter = ISwapRouter02(vm.parseJsonAddress(json, ".contracts.SwapRouter02"));

        MetaSwapConfig.TokenSpec[] memory s = MetaSwapConfig.tokenSpecs();
        for (uint256 i = 0; i < s.length; i++) {
            specs.push(s[i]);
            string memory base = string.concat(".tokens[", vm.toString(i), "]");
            tokens.push(vm.parseJsonAddress(json, string.concat(base, ".address")));
            require(
                keccak256(bytes(vm.parseJsonString(json, string.concat(base, ".symbol"))))
                    == keccak256(bytes(s[i].symbol)),
                "Seed: token order mismatch"
            );
        }
        require(tokens[WETH_] == weth, "Seed: WETH mismatch");

        for (uint32 i = 0; i < N_ACCOUNTS; i++) {
            keys[i] = vm.deriveKey(MetaSwapConfig.ANVIL_MNEMONIC, i);
            accts[i] = vm.addr(keys[i]);
        }
    }

    function _amt(uint8 t, uint256 usd6) internal view returns (uint256) {
        return MetaSwapConfig.usdToAmount(usd6, specs[t].priceUsd6, specs[t].decimals);
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1 days;
    }

    function _fundAndApprove() internal {
        // 1) one Multicall3 tx: open-mint every test token to #0..#5
        Multicall3.Call[] memory mints = new Multicall3.Call[](N_ACCOUNTS * (tokens.length - 1));
        uint256 k;
        for (uint256 i = 0; i < N_ACCOUNTS; i++) {
            uint256 usd = i == 0 ? 60_000_000e6 : (i <= 2 ? 10_000_000e6 : 1_000_000e6);
            for (uint8 t = 1; t < tokens.length; t++) {
                mints[k++] = Multicall3.Call(tokens[t], abi.encodeCall(TestERC20.mint, (accts[i], _amt(t, usd))));
            }
        }
        // 2) EIP-2612 permits from #1..#5 to both routers for every test token (WETH-in swaps use native ETH)
        Multicall3.Call[] memory permits = new Multicall3.Call[](5 * (tokens.length - 1) * 2);
        k = 0;
        for (uint256 i = 1; i < N_ACCOUNTS; i++) {
            for (uint8 t = 1; t < tokens.length; t++) {
                TestERC20 token = TestERC20(tokens[t]);
                uint256 nonce = token.nonces(accts[i]);
                permits[k++] = _permitCall(token, i, address(swapRouter), nonce);
                permits[k++] = _permitCall(token, i, address(v2Router), nonce + 1);
            }
        }

        _nextBlock();
        vm.startBroadcast(keys[0]);
        multicall3.aggregate(mints);
        WETH9(payable(weth)).deposit{value: 8_000 ether}();
        multicall3.aggregate(permits);
        for (uint256 t = 0; t < tokens.length; t++) {
            TestERC20(tokens[t]).approve(address(v2Router), type(uint256).max);
            TestERC20(tokens[t]).approve(address(npm), type(uint256).max);
        }
        vm.stopBroadcast();
    }

    function _permitCall(TestERC20 token, uint256 who, address spender, uint256 nonce)
        internal
        view
        returns (Multicall3.Call memory)
    {
        uint256 deadline = _deadline();
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                accts[who],
                spender,
                type(uint256).max,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[who], digest);
        return Multicall3.Call(
            address(token), abi.encodeCall(token.permit, (accts[who], spender, type(uint256).max, deadline, v, r, s))
        );
    }

    // ------------------------------------------------------------------ V2

    function _v2Specs() internal pure returns (V2Spec[] memory s) {
        s = new V2Spec[](6);
        s[0] = V2Spec(WETH_, USDC, 3_000_000e6);
        s[1] = V2Spec(WETH_, DAI, 1_500_000e6);
        s[2] = V2Spec(WBTC, WETH_, 1_500_000e6);
        s[3] = V2Spec(META, WETH_, 600_000e6);
        s[4] = V2Spec(LINK, WETH_, 600_000e6);
        s[5] = V2Spec(USDC, USDT, 3_000_000e6);
    }

    function _seedV2() internal {
        V2Spec[] memory s = _v2Specs();
        for (uint256 i = 0; i < s.length; i++) {
            _nextBlock();
            vm.startBroadcast(keys[0]);
            v2Router.addLiquidity(
                tokens[s[i].a],
                tokens[s[i].b],
                _amt(s[i].a, s[i].usdPerSide),
                _amt(s[i].b, s[i].usdPerSide),
                0,
                0,
                accts[0],
                _deadline()
            );
            vm.stopBroadcast();
            address pair = v2Factory.getPair(tokens[s[i].a], tokens[s[i].b]);
            poolRefs.push(PoolRef(false, pair, s[i].a, s[i].b, 0, s[i].usdPerSide / 150));
        }
    }

    // ------------------------------------------------------------------ V3

    function _v3Specs() internal pure returns (V3Spec[] memory s) {
        s = new V3Spec[](7);
        // tick deltas: +-25% ~ 2231, +-10% ~ 953, +-5% ~ 488, +-3% ~ 296, +-2% ~ 198, +-1% ~ 100, +-0.2% ~ 20
        s[0] = V3Spec(WETH_, USDC, 500, 2_000_000e6, 1_000_000e6, 953, 500_000e6, 198);
        s[1] = V3Spec(WETH_, USDC, 3000, 1_000_000e6, 500_000e6, 2231, 200_000e6, 488);
        s[2] = V3Spec(USDC, USDT, 100, 1_000_000e6, 2_000_000e6, 100, 1_000_000e6, 20);
        s[3] = V3Spec(WBTC, WETH_, 3000, 1_000_000e6, 500_000e6, 953, 200_000e6, 296);
        s[4] = V3Spec(META, WETH_, 10000, 500_000e6, 200_000e6, 2231, 100_000e6, 953);
        s[5] = V3Spec(ARB, WETH_, 3000, 500_000e6, 200_000e6, 2231, 100_000e6, 953);
        s[6] = V3Spec(DAI, USDC, 100, 1_000_000e6, 2_000_000e6, 100, 1_000_000e6, 20);
    }

    function _seedV3() internal {
        V3Spec[] memory s = _v3Specs();
        Multicall3.Call[] memory cardinality = new Multicall3.Call[](s.length);
        for (uint256 i = 0; i < s.length; i++) {
            V3Spec memory p = s[i];
            (uint8 i0, uint8 i1) = tokens[p.a] < tokens[p.b] ? (p.a, p.b) : (p.b, p.a);
            uint160 sqrtP = MetaSwapConfig.sqrtPriceX96(
                specs[i0].priceUsd6, specs[i0].decimals, specs[i1].priceUsd6, specs[i1].decimals
            );
            int24 spacing = v3Factory.feeAmountTickSpacing(p.fee);
            int24 tick = TickMath.getTickAtSqrtRatio(sqrtP);

            // create + initialize + 3 positions (full range -> #0, wide -> #1, narrow -> #2) in one NPM multicall
            bytes[] memory calls = new bytes[](4);
            calls[0] = abi.encodeCall(
                IPoolInitializer.createAndInitializePoolIfNecessary, (tokens[i0], tokens[i1], p.fee, sqrtP)
            );
            calls[1] = _mintCall(
                0, i0, i1, p.fee, MetaSwapConfig.minUsableTick(spacing), MetaSwapConfig.maxUsableTick(spacing), p.fullUsd
            );
            calls[2] = _mintCall(
                1,
                i0,
                i1,
                p.fee,
                MetaSwapConfig.floorTick(tick - p.wideDelta, spacing),
                MetaSwapConfig.floorTick(tick + p.wideDelta, spacing) + spacing,
                p.wideUsd
            );
            calls[3] = _mintCall(
                2,
                i0,
                i1,
                p.fee,
                MetaSwapConfig.floorTick(tick - p.narrowDelta, spacing),
                MetaSwapConfig.floorTick(tick + p.narrowDelta, spacing) + spacing,
                p.narrowUsd
            );

            _nextBlock();
            vm.startBroadcast(keys[0]);
            IMulticall(address(npm)).multicall(calls);
            vm.stopBroadcast();

            address pool = v3Factory.getPool(tokens[i0], tokens[i1], p.fee);
            // grow the oracle buffer so observe() has history for TWAPs
            cardinality[i] = Multicall3.Call(
                pool, abi.encodeCall(IMetaSwapV3Pool(pool).increaseObservationCardinalityNext, (100))
            );
            poolRefs.push(PoolRef(true, pool, i0, i1, p.fee, (p.fullUsd + p.wideUsd) / 150));
        }
        _nextBlock();
        vm.startBroadcast(keys[0]);
        multicall3.aggregate(cardinality);
        vm.stopBroadcast();
    }

    function _mintCall(uint256 who, uint8 i0, uint8 i1, uint24 fee, int24 lower, int24 upper, uint256 usd)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeCall(
            INonfungiblePositionManager.mint,
            (
                INonfungiblePositionManager.MintParams({
                    token0: tokens[i0],
                    token1: tokens[i1],
                    fee: fee,
                    tickLower: lower,
                    tickUpper: upper,
                    amount0Desired: _amt(i0, usd),
                    amount1Desired: _amt(i1, usd),
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: accts[who],
                    deadline: _deadline()
                })
            )
        );
    }

    // ------------------------------------------------------------------ swaps

    function _swapHistory() internal {
        uint256 v2Count;
        uint256 v3Count;
        for (uint256 i = 0; i < N_SWAPS; i++) {
            uint256 r = uint256(keccak256(abi.encode("metaswap-seed", i)));
            PoolRef memory ref = poolRefs[r % poolRefs.length];
            (uint8 tin, uint8 tout) = (r >> 8) & 1 == 1 ? (ref.b, ref.a) : (ref.a, ref.b);
            uint256 usd = 150e6 + ((r >> 16) % ref.maxSwapUsd); // $150 .. ~0.7% of pool depth
            uint256 who = 1 + ((r >> 128) % 5);
            bool exactOut = (r >> 64) % 3 == 0;

            _nextBlock();
            vm.startBroadcast(keys[who]);
            if (!ref.isV3) {
                v2Count++;
                _swapV2(who, tin, tout, usd, exactOut);
            } else {
                v3Count++;
                _swapV3(who, tin, tout, ref.fee, usd, exactOut);
            }
            vm.stopBroadcast();
        }

        // multi-hop V3 swaps
        _nextBlock();
        vm.startBroadcast(keys[3]);
        swapRouter.exactInput{gas: SWAP_GAS}(
            IV3SwapRouter.ExactInputParams({
                path: abi.encodePacked(tokens[USDT], uint24(100), tokens[USDC], uint24(500), tokens[WETH_]),
                recipient: accts[3],
                amountIn: _amt(USDT, 5_000e6),
                amountOutMinimum: 0
            })
        );
        vm.stopBroadcast();
        _nextBlock();
        vm.startBroadcast(keys[4]);
        swapRouter.exactInput{gas: SWAP_GAS}(
            IV3SwapRouter.ExactInputParams({
                path: abi.encodePacked(tokens[WBTC], uint24(3000), tokens[WETH_], uint24(500), tokens[USDC]),
                recipient: accts[4],
                amountIn: _amt(WBTC, 8_000e6),
                amountOutMinimum: 0
            })
        );
        vm.stopBroadcast();
        _nextBlock();
        vm.startBroadcast(keys[5]);
        // exact output multi-hop: path is reversed (tokenOut first)
        swapRouter.exactOutput{gas: SWAP_GAS}(
            IV3SwapRouter.ExactOutputParams({
                path: abi.encodePacked(tokens[WETH_], uint24(500), tokens[USDC], uint24(100), tokens[DAI]),
                recipient: accts[5],
                amountOut: 1 ether,
                amountInMaximum: type(uint256).max
            })
        );
        vm.stopBroadcast();

        console2.log("V2 swaps:", v2Count);
        console2.log("V3 swaps:", v3Count + 3);
    }

    function _swapV2(uint256 who, uint8 tin, uint8 tout, uint256 usd, bool exactOut) internal {
        address[] memory path = new address[](2);
        path[0] = tokens[tin];
        path[1] = tokens[tout];
        if (tin == WETH_) {
            if (exactOut) {
                v2Router.swapETHForExactTokens{gas: SWAP_GAS, value: _amt(tin, usd * 11 / 10)}(
                    _amt(tout, usd * 95 / 100), path, accts[who], _deadline()
                );
            } else {
                v2Router.swapExactETHForTokens{gas: SWAP_GAS, value: _amt(tin, usd)}(0, path, accts[who], _deadline());
            }
        } else if (tout == WETH_ && !exactOut) {
            v2Router.swapExactTokensForETH{gas: SWAP_GAS}(_amt(tin, usd), 0, path, accts[who], _deadline());
        } else if (exactOut) {
            v2Router.swapTokensForExactTokens{gas: SWAP_GAS}(
                _amt(tout, usd * 95 / 100), type(uint256).max, path, accts[who], _deadline()
            );
        } else {
            v2Router.swapExactTokensForTokens{gas: SWAP_GAS}(_amt(tin, usd), 0, path, accts[who], _deadline());
        }
    }

    function _swapV3(uint256 who, uint8 tin, uint8 tout, uint24 fee, uint256 usd, bool exactOut) internal {
        uint256 value = tin == WETH_ ? _amt(tin, exactOut ? usd * 11 / 10 : usd) : 0;
        if (exactOut) {
            bytes[] memory calls = new bytes[](tin == WETH_ ? 2 : 1);
            calls[0] = abi.encodeCall(
                IV3SwapRouter.exactOutputSingle,
                (
                    IV3SwapRouter.ExactOutputSingleParams({
                        tokenIn: tokens[tin],
                        tokenOut: tokens[tout],
                        fee: fee,
                        recipient: accts[who],
                        amountOut: _amt(tout, usd * 95 / 100),
                        amountInMaximum: tin == WETH_ ? value : type(uint256).max,
                        sqrtPriceLimitX96: 0
                    })
                )
            );
            if (tin == WETH_) calls[1] = abi.encodeCall(IPeripheryPayments.refundETH, ());
            swapRouter.multicall{gas: SWAP_GAS, value: value}(_deadline(), calls);
        } else {
            swapRouter.exactInputSingle{gas: SWAP_GAS, value: value}(
                IV3SwapRouter.ExactInputSingleParams({
                    tokenIn: tokens[tin],
                    tokenOut: tokens[tout],
                    fee: fee,
                    recipient: accts[who],
                    amountIn: _amt(tin, usd),
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        }
    }

    // ------------------------------------------------------------------ output

    function _writePools() internal {
        string memory v2 = "[";
        string memory v3 = "[";
        uint256 n2;
        uint256 n3;
        for (uint256 i = 0; i < poolRefs.length; i++) {
            PoolRef memory p = poolRefs[i];
            if (!p.isV3) {
                IMetaSwapV2Pair pair = IMetaSwapV2Pair(p.pool);
                v2 = string.concat(
                    v2,
                    n2++ == 0 ? "" : ",",
                    '{"address":"',
                    vm.toString(p.pool),
                    '","token0":"',
                    vm.toString(pair.token0()),
                    '","token1":"',
                    vm.toString(pair.token1()),
                    '"}'
                );
            } else {
                IMetaSwapV3Pool pool = IMetaSwapV3Pool(p.pool);
                v3 = string.concat(
                    v3,
                    n3++ == 0 ? "" : ",",
                    '{"address":"',
                    vm.toString(p.pool),
                    '","token0":"',
                    vm.toString(pool.token0()),
                    '","token1":"',
                    vm.toString(pool.token1()),
                    '","fee":',
                    vm.toString(uint256(pool.fee())),
                    "}"
                );
            }
        }
        string memory pools = string.concat('{"v2":', v2, '],"v3":', v3, "]}");
        vm.writeJson(pools, MetaSwapConfig.DEPLOYMENTS_PATH, ".pools");
        console2.log("pools written: v2 =", n2, ", v3 =", n3);
    }
}
