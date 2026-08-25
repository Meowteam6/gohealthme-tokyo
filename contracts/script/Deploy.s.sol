// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HealthPoolsV3} from "../src/HealthPoolsV3.sol";

/// @notice Deploys HealthPoolsV3 to Base Sepolia (chain id 84532).
/// @dev    Requires three distinct role keys (C-2): the deployer becomes owner
///         (deploy as a Safe/timelock for production), plus a distinct oracle and
///         settler. The verdict registry is optional at deploy (address(0) =
///         oracle-only pilot); enable it later with setHealthVerdict once the CRE
///         registry is live. Base Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e.
///
///         Env:
///           PRIVATE_KEY        deployer / owner (Safe/timelock in prod)
///           USDC_ADDRESS       Base Sepolia USDC (defaults to the canonical address)
///           ORACLE_ADDRESS     verdict-recording key (distinct)
///           SETTLER_ADDRESS    grace-window settler / SPOTTER Circle wallet (distinct)
///           VERDICT_REGISTRY   optional HealthVerdict address (0 = oracle-only)
///
///         Verify on Basescan with:
///           forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast \
///             --verify --etherscan-api-key $BASESCAN_API_KEY
contract Deploy is Script {
    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address token = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address settler = vm.envAddress("SETTLER_ADDRESS");
        address verdictRegistry = vm.envOr("VERDICT_REGISTRY", address(0));

        vm.startBroadcast(pk);
        HealthPoolsV3 pools = new HealthPoolsV3(token, oracle, settler, verdictRegistry);
        vm.stopBroadcast();

        // Pilot compliance lock: the real-money pilot must deploy with the
        // commitment rake OFF. A non-zero cut of losers' forfeited stakes is the
        // single feature that reads as operating a gambling business, so assert
        // it at deploy time rather than trusting the constructor default.
        require(pools.commitmentFeeBps() == 0, "PILOT_RAKE_MUST_BE_ZERO");

        console.log("HealthPoolsV3 deployed at:", address(pools));
        console.log("  rake   : 0 bps (pilot compliance lock)");
        console.log("  usdc   :", token);
        console.log("  oracle :", oracle);
        console.log("  settler:", settler);
        console.log("  verdict:", verdictRegistry);
    }
}
