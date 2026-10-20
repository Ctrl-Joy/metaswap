// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {WETH9} from "../src/amm/tokens/WETH9.sol";
import {TestERC20} from "../src/amm/tokens/TestERC20.sol";
import {Multicall3} from "../src/amm/utils/Multicall3.sol";
import {MetaSwapV2Factory} from "../src/amm/v2/MetaSwapV2Factory.sol";
import {MetaSwapV2Router02} from "../src/amm/v2/MetaSwapV2Router02.sol";
import {MetaSwapV3Factory} from "../src/amm/v3/MetaSwapV3Factory.sol";
import {NonfungiblePositionManager} from "../src/amm/v3/NonfungiblePositionManager.sol";
import {SwapRouter02} from "../src/amm/v3/SwapRouter02.sol";
import {QuoterV2} from "../src/amm/v3/QuoterV2.sol";
import {TickLens} from "../src/amm/v3/TickLens.sol";
import {MetaSwapConfig} from "./lib/MetaSwapConfig.sol";

/// @title DeployAMM
/// @notice Deploys WETH9, Multicall3, MetaSwap V2 (factory + Router02), MetaSwap V3 (factory, position manager,
///         SwapRouter02, QuoterV2, TickLens) and the 7 TestERC20 seed tokens, then writes deployments/31337.json.
/// @dev forge script script/DeployAMM.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///      Uses $PRIVATE_KEY if set, otherwise Anvil account #0 (local devnet only).
contract DeployAMM is Script {
    struct Deployed {
        address weth9;
        address multicall3;
        address v2Factory;
        address v2Router02;
        address v3Factory;
        address positionManager;
        address swapRouter02;
        address quoterV2;
        address tickLens;
        address[] tokens; // same order as MetaSwapConfig.tokenSpecs()
    }

    function run() external returns (Deployed memory d) {
        uint256 startBlock = block.number;
        uint256 pk = vm.envOr("PRIVATE_KEY", MetaSwapConfig.ANVIL_KEY_0);
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        d = deployAll(deployer);
        vm.stopBroadcast();

        _writeJson(d, startBlock);
        _log(d);
    }

    function deployAll(address owner) internal returns (Deployed memory d) {
        MetaSwapConfig.TokenSpec[] memory specs = MetaSwapConfig.tokenSpecs();

        d.weth9 = address(new WETH9());
        d.multicall3 = address(new Multicall3());

        d.v2Factory = address(new MetaSwapV2Factory(owner));
        d.v2Router02 = address(new MetaSwapV2Router02(d.v2Factory, d.weth9));

        d.v3Factory = address(new MetaSwapV3Factory());
        d.positionManager = address(new NonfungiblePositionManager(d.v3Factory, d.weth9));
        d.swapRouter02 = address(new SwapRouter02(d.v2Factory, d.v3Factory, d.positionManager, d.weth9));
        d.quoterV2 = address(new QuoterV2(d.v3Factory, d.weth9));
        d.tickLens = address(new TickLens());

        d.tokens = new address[](specs.length);
        d.tokens[0] = d.weth9;
        for (uint256 i = 1; i < specs.length; i++) {
            d.tokens[i] =
                address(new TestERC20(specs[i].name, specs[i].symbol, specs[i].decimals, specs[i].faucetAmount));
        }
    }

    function _writeJson(Deployed memory d, uint256 startBlock) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "WETH9", d.weth9);
        vm.serializeAddress(c, "Multicall3", d.multicall3);
        vm.serializeAddress(c, "V2Factory", d.v2Factory);
        vm.serializeAddress(c, "V2Router02", d.v2Router02);
        vm.serializeAddress(c, "V3Factory", d.v3Factory);
        vm.serializeAddress(c, "NonfungiblePositionManager", d.positionManager);
        vm.serializeAddress(c, "SwapRouter02", d.swapRouter02);
        vm.serializeAddress(c, "QuoterV2", d.quoterV2);
        string memory contractsJson = vm.serializeAddress(c, "TickLens", d.tickLens);

        // Arrays of objects are assembled as raw JSON so seedPriceUsd can be a non-integer number (mARB = 0.8).
        MetaSwapConfig.TokenSpec[] memory specs = MetaSwapConfig.tokenSpecs();
        string memory tokensJson = "[";
        for (uint256 i = 0; i < specs.length; i++) {
            tokensJson = string.concat(
                tokensJson,
                i == 0 ? "" : ",",
                '{"symbol":"',
                specs[i].symbol,
                '","name":"',
                specs[i].name,
                '","decimals":',
                vm.toString(uint256(specs[i].decimals)),
                ',"address":"',
                vm.toString(d.tokens[i]),
                '","seedPriceUsd":',
                specs[i].priceJson,
                "}"
            );
        }
        tokensJson = string.concat(tokensJson, "]");

        string memory root = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"blockNumber":',
            vm.toString(startBlock),
            ',"contracts":',
            contractsJson,
            ',"tokens":',
            tokensJson,
            ',"pools":{"v2":[],"v3":[]}}'
        );
        // round-trip through serializeJson so the file is validated & pretty-printed by forge
        string memory json = vm.serializeJson("deployment", root);
        vm.writeJson(json, MetaSwapConfig.DEPLOYMENTS_PATH);
    }

    function _log(Deployed memory d) internal pure {
        console2.log("WETH9                     ", d.weth9);
        console2.log("Multicall3                ", d.multicall3);
        console2.log("V2Factory                 ", d.v2Factory);
        console2.log("V2Router02                ", d.v2Router02);
        console2.log("V3Factory                 ", d.v3Factory);
        console2.log("NonfungiblePositionManager", d.positionManager);
        console2.log("SwapRouter02              ", d.swapRouter02);
        console2.log("QuoterV2                  ", d.quoterV2);
        console2.log("TickLens                  ", d.tickLens);
    }
}
