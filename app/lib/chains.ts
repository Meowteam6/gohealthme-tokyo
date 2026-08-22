import { defineChain } from "viem";
import { baseSepolia as viemBaseSepolia } from "viem/chains";

/**
 * Base Sepolia (chain id 84532) — the settlement chain for the Base fork.
 *
 * Unlike Arc (USDC-native, 18-decimal native gas), Base pays gas in ETH. Pool
 * accounting uses the canonical Base Sepolia USDC ERC-20 at
 * 0x036CbD53842c5426634e7929541eC2318f3dCF7e (6 decimals) — see
 * lib/contract.ts USDC_ADDRESS.
 *
 * The RPC order is what viem's fallback transport tries in sequence. The public
 * base.org endpoint leads; publicnode is the redundant fallback. This fork
 * deliberately does NOT carry any of the Arc-RPC ordering workarounds from the
 * ancestor repo — they were specific to the Arc endpoints and do not apply here.
 */
export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        "https://sepolia.base.org",
        "https://base-sepolia-rpc.publicnode.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Basescan",
      url: "https://sepolia.basescan.org",
    },
  },
  testnet: true,
});

// Keep the viem canonical chain available for anything that prefers it; the
// locally defined descriptor above owns the RPC ordering used by this app.
export { viemBaseSepolia };

export function baseTxUrl(txHash: string): string {
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

export function baseAddressUrl(address: string): string {
  return `https://sepolia.basescan.org/address/${address}`;
}

// ---------------------------------------------------------------------------
// Transitional aliases (Arc -> Base fork).
//
// The shared-core modules copied from the ancestor repo import `arcTestnet`,
// `arcTxUrl`, and `arcAddressUrl`. Rather than rename every call site in one
// unverifiable sweep, the fork repoints those names at the Base descriptor so
// the entire app talks to Base Sepolia. New code should import the base* names
// above; these aliases are the migration bridge and can be removed once every
// importer is renamed.
// ---------------------------------------------------------------------------
export const arcTestnet = baseSepolia;
export const arcTxUrl = baseTxUrl;
export const arcAddressUrl = baseAddressUrl;
