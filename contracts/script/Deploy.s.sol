// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol";

/// @notice Deploys Vault for one ERC-8004 token.
///
/// Example:
///   REGISTRY=0x... AGENT_ID=42 PRIVATE_KEY=0x... \
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url base \
///     --broadcast \
///     --verify \
///     -vvvv
contract Deploy is Script {
    function run() external returns (Vault vault) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address registry = vm.envAddress("REGISTRY");
        uint256 agentId = vm.envUint("AGENT_ID");
        vm.startBroadcast(deployerKey);
        vault = new Vault(registry, agentId);
        vm.stopBroadcast();

        console2.log("Vault deployed at:", address(vault));
        console2.log("Chain ID:", block.chainid);
        console2.log("Registry:", registry);
        console2.log("Agent ID:", agentId);
    }
}
