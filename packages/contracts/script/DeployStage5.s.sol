// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MetaSwapSavingsVault} from "../src/x/earn/MetaSwapSavingsVault.sol";
import {MetaSwapLaunchpad} from "../src/x/launch/MetaSwapLaunchpad.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

interface IWETHDeposit {
    function deposit() external payable;
}

/// @notice Stage 5: deploys the three MetaSwap Earn vaults (reward reserves funded) and the two launchpads,
///         then merges `contracts.Launchpad`, `contracts.DevnetPad` and `vaults` into deployments/31337.json,
///         keeping every existing key. Runs after DeployX and before Seed.
/// @dev forge script script/DeployStage5.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///      Uses $PRIVATE_KEY if set, otherwise Anvil account #0 (local devnet only, no real funds).
contract DeployStage5 is Script {
    string internal constant DEPLOYMENTS_PATH = "deployments/31337.json";
    uint256 internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    struct VaultSpec {
        string assetSymbol;
        string name;
        string symbol;
        uint256 apyBps;
        uint256 reserve; // reward reserve: >= 2 years of yield at 50M USD TVL
    }

    struct VaultOut {
        address vault;
        address asset;
        string symbol;
        uint256 apyBps;
    }

    function run() external {
        string memory json = vm.readFile(DEPLOYMENTS_PATH);
        address weth = vm.parseJsonAddress(json, ".contracts.WETH9");
        address v3Factory = vm.parseJsonAddress(json, ".contracts.V3Factory");
        address npm = vm.parseJsonAddress(json, ".contracts.NonfungiblePositionManager");

        uint256 pk = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
        address deployer = vm.addr(pk);

        // 50M USD × APY × 2 years, rounded up: mUSDT 4.78M, mUSDC 4.41M, WETH 1.57M USD / 3000 = 524 ETH
        VaultSpec[3] memory specs = [
            VaultSpec("mUSDT", "MetaSwap Earn mUSDT", "meUSDT", 478, 5_000_000e6),
            VaultSpec("mUSDC", "MetaSwap Earn mUSDC", "meUSDC", 441, 5_000_000e6),
            VaultSpec("WETH", "MetaSwap Earn ETH", "meETH", 157, 600 ether)
        ];

        VaultOut[3] memory out;
        vm.startBroadcast(pk);
        for (uint256 i = 0; i < 3; i++) {
            address asset = _tokenBySymbol(json, specs[i].assetSymbol);
            MetaSwapSavingsVault v = new MetaSwapSavingsVault(
                IERC20(asset), specs[i].name, specs[i].symbol, specs[i].apyBps, deployer, weth
            );
            if (asset == weth) IWETHDeposit(weth).deposit{value: specs[i].reserve}();
            else IMintable(asset).mint(deployer, specs[i].reserve);
            IERC20(asset).approve(address(v), specs[i].reserve);
            v.fundReserve(specs[i].reserve);
            out[i] = VaultOut(address(v), asset, specs[i].symbol, specs[i].apyBps);
        }
        address launchpad = address(new MetaSwapLaunchpad("MetaSwap Launchpad", v3Factory, npm, weth, deployer));
        address devnetPad = address(new MetaSwapLaunchpad("Devnet Pad", v3Factory, npm, weth, deployer));
        vm.stopBroadcast();

        _merge(json, launchpad, devnetPad, out);

        for (uint256 i = 0; i < 3; i++) {
            console2.log(out[i].symbol, out[i].vault);
        }
        console2.log("Launchpad  ", launchpad);
        console2.log("DevnetPad  ", devnetPad);
    }

    function _tokenBySymbol(string memory json, string memory symbol) internal view returns (address) {
        for (uint256 i = 0;; i++) {
            string memory base = string.concat(".tokens[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, base)) break;
            if (keccak256(bytes(vm.parseJsonString(json, string.concat(base, ".symbol")))) == keccak256(bytes(symbol)))
            {
                return vm.parseJsonAddress(json, string.concat(base, ".address"));
            }
        }
        revert(string.concat("token not in deployments: ", symbol));
    }

    /// @dev loads the existing file as the root object, replaces `contracts` (existing keys + 2 new) and `vaults`
    function _merge(string memory json, address launchpad, address devnetPad, VaultOut[3] memory out) internal {
        string memory c = "s5-contracts";
        string[] memory keys = vm.parseJsonKeys(json, ".contracts");
        for (uint256 i = 0; i < keys.length; i++) {
            bytes32 h = keccak256(bytes(keys[i]));
            if (h == keccak256("Launchpad") || h == keccak256("DevnetPad")) continue;
            vm.serializeAddress(c, keys[i], vm.parseJsonAddress(json, string.concat(".contracts.", keys[i])));
        }
        vm.serializeAddress(c, "Launchpad", launchpad);
        string memory contractsJson = vm.serializeAddress(c, "DevnetPad", devnetPad);

        string memory vaults = "[";
        for (uint256 i = 0; i < 3; i++) {
            string memory o = string.concat("s5-vault-", vm.toString(i));
            vm.serializeAddress(o, "address", out[i].vault);
            vm.serializeAddress(o, "asset", out[i].asset);
            vm.serializeString(o, "symbol", out[i].symbol);
            string memory item = vm.serializeUint(o, "apyBps", out[i].apyBps);
            vaults = string.concat(vaults, i == 0 ? "" : ",", item);
        }
        vaults = string.concat(vaults, "]");

        string memory root = "s5-root";
        vm.serializeJson(root, json);
        vm.serializeString(root, "contracts", contractsJson);
        // arrays are not embedded by serializeString, so write a placeholder key first and then replace it with
        // the parsed array (writeJson with a key parses the value as JSON, like Seed does for `.pools`)
        string memory finalJson = vm.serializeString(root, "vaults", "pending");
        vm.writeJson(finalJson, DEPLOYMENTS_PATH);
        vm.writeJson(vaults, DEPLOYMENTS_PATH, ".vaults");
    }
}
