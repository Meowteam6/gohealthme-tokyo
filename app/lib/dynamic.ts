// Dynamic EvmNetwork descriptor for Base Sepolia, passed via
// DynamicContextProvider overrides.evmNetworks.
// Shape verified against @dynamic-labs/types EvmNetwork (v4.88.6):
//   EvmNetwork = Omit<GenericNetwork, 'chainId'> & { chainId: number; ... }
//   GenericNetwork = Omit<NetworkConfiguration, 'chainId'|'networkId'|'shortName'|'chain'>
//                   & { chainId: number|string; networkId: number|string; ... }
// Required fields (all non-optional in NetworkConfiguration and not omitted):
//   name, nativeCurrency, rpcUrls, blockExplorerUrls, iconUrls, chainId, networkId
import type { EvmNetwork } from "@dynamic-labs/types";

// Dynamic writes these into the external wallet via wallet_addEthereumChain, so
// the list is kept in sync with lib/chains.ts on purpose. Base gas is ETH, not
// USDC. This fork does NOT carry the Arc-RPC ordering drift from the ancestor
// repo — the endpoints below are the Base Sepolia public RPCs.
export const baseEvmNetwork: EvmNetwork = {
  chainId: 84532,
  networkId: 84532,
  name: "Base Sepolia",
  iconUrls: [],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [
    "https://sepolia.base.org",
    "https://base-sepolia-rpc.publicnode.com",
  ],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};

// Transitional alias so shared-core importers of `arcEvmNetwork` resolve to the
// Base descriptor during the Arc -> Base migration. Prefer `baseEvmNetwork`.
export const arcEvmNetwork: EvmNetwork = baseEvmNetwork;
