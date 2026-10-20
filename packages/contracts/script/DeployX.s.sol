// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {Permit2} from "../src/x/permit2/Permit2.sol";
import {IPermit2} from "../src/x/permit2/interfaces/IPermit2.sol";
import {MetaSwapUniversalRouter} from "../src/x/router/MetaSwapUniversalRouter.sol";
import {ExclusiveDutchOrderReactor} from "../src/x/metaswapx/reactors/ExclusiveDutchOrderReactor.sol";
import {SwapRouter02Executor} from "../src/x/metaswapx/sample-executors/SwapRouter02Executor.sol";
import {IReactor} from "../src/x/metaswapx/interfaces/IReactor.sol";
import {ISwapRouter02} from "../src/amm/v3/interfaces/ISwapRouter02.sol";

/// @notice Deploys Permit2, MetaSwapUniversalRouter, ExclusiveDutchOrderReactor and SwapRouter02Executor on top of
///         the AMM recorded in deployments/31337.json (written by DeployAMM) and merges their addresses into
///         `.contracts` of the same file, keeping every existing key.
/// @dev forge script script/DeployX.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///      Uses $PRIVATE_KEY if set, otherwise Anvil account #0 (local devnet only, no real funds).
///      Executor: whitelisted caller = $FILLER_ADDRESS or Anvil account #9; owner = deployer (account #0).
contract DeployX is Script {
    string internal constant DEPLOYMENTS_PATH = "deployments/31337.json";
    /// @dev Anvil account #0 private key (well-known local devnet key).
    uint256 internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    /// @dev Anvil account #9 — the API's filler bot.
    address internal constant ANVIL_ACCOUNT_9 = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720;

    struct DeployedX {
        address permit2;
        address universalRouter;
        address reactor;
        address executor;
    }

    function run() external returns (DeployedX memory d) {
        string memory json = vm.readFile(DEPLOYMENTS_PATH);
        address weth9 = vm.parseJsonAddress(json, ".contracts.WETH9");
        address v2Factory = vm.parseJsonAddress(json, ".contracts.V2Factory");
        address v3Factory = vm.parseJsonAddress(json, ".contracts.V3Factory");
        address swapRouter02 = vm.parseJsonAddress(json, ".contracts.SwapRouter02");

        uint256 pk = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
        address deployer = vm.addr(pk);
        address filler = vm.envOr("FILLER_ADDRESS", ANVIL_ACCOUNT_9);

        vm.startBroadcast(pk);
        d.permit2 = address(new Permit2());
        d.universalRouter = address(new MetaSwapUniversalRouter(d.permit2, weth9, v2Factory, v3Factory));
        d.reactor = address(new ExclusiveDutchOrderReactor(IPermit2(d.permit2), deployer));
        d.executor =
            address(new SwapRouter02Executor(filler, IReactor(d.reactor), deployer, ISwapRouter02(swapRouter02)));
        vm.stopBroadcast();

        _merge(json, d);

        console2.log("Permit2                    ", d.permit2);
        console2.log("UniversalRouter            ", d.universalRouter);
        console2.log("ExclusiveDutchOrderReactor ", d.reactor);
        console2.log("SwapRouter02Executor       ", d.executor);
        console2.log("  whitelisted filler       ", filler);
        console2.log("  owner                    ", deployer);
    }

    /// @dev rebuilds `.contracts` = existing keys + the four new ones, then replaces only that key in the file.
    function _merge(string memory json, DeployedX memory d) internal {
        string memory obj = "x-contracts";
        string[] memory keys = vm.parseJsonKeys(json, ".contracts");
        for (uint256 i = 0; i < keys.length; i++) {
            if (_isOurs(keys[i])) continue;
            vm.serializeAddress(obj, keys[i], vm.parseJsonAddress(json, string.concat(".contracts.", keys[i])));
        }
        vm.serializeAddress(obj, "Permit2", d.permit2);
        vm.serializeAddress(obj, "UniversalRouter", d.universalRouter);
        vm.serializeAddress(obj, "ExclusiveDutchOrderReactor", d.reactor);
        string memory contractsJson = vm.serializeAddress(obj, "SwapRouter02Executor", d.executor);
        vm.writeJson(contractsJson, DEPLOYMENTS_PATH, ".contracts");
    }

    function _isOurs(string memory key) internal pure returns (bool) {
        bytes32 h = keccak256(bytes(key));
        return h == keccak256("Permit2") || h == keccak256("UniversalRouter")
            || h == keccak256("ExclusiveDutchOrderReactor") || h == keccak256("SwapRouter02Executor");
    }
}
