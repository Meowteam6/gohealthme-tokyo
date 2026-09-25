// Ethereum Sepolia access for the ENSv2 integration (server only).
//
// Pools live on Base Sepolia; names live on Ethereum Sepolia. This module is
// the only place the app builds a Sepolia client or loads an ENS signing key,
// so the two chains never get confused and a missing key fails in exactly one
// spot with a plain message.
//
// Two signers, deliberately distinct:
//
//   owner  ENS_OWNER_PRIVATE_KEY   owns gohealthme.eth and its registry. Mints
//                                  pool and participant subnames, sets their
//                                  address records, grants the agent its keys.
//   agent  ENS_AGENT_PRIVATE_KEY   SPOTTER's Sepolia signer. Owns
//          (or TREASURY_PRIVATE_KEY)  spotter.gohealthme.eth with no registry
//                                  roles, and holds ROLE_SET_TEXT on exactly
//                                  the four receipt keys. That is all it can
//                                  do, and lib/server/ens/resolve.ts proves it.
//
// GoHealthMe's own registry and resolver proxies are never hard-coded: they
// are read from ETHRegistry.getSubregistry / getResolver for the parent label
// every time (with a short cache), which is also how any third party finds
// them.

import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { DEFAULT_PARENT_NAME, firstLabel } from "@/lib/ens/names";
import { optionalEnv } from "@/lib/server/env";
import { ENS_SEPOLIA, REGISTRY_ABI } from "@/lib/server/ens/deployments";

export const DEFAULT_ENS_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

export type EnsPublicClient = PublicClient<Transport, typeof sepolia>;
export type EnsWalletClient = WalletClient<Transport, Chain, Account>;

export function ensRpcUrl(): string {
  return optionalEnv("ENS_SEPOLIA_RPC_URL", DEFAULT_ENS_RPC_URL);
}

let cachedPublic: { url: string; client: EnsPublicClient } | null = null;

/** One module-scoped Sepolia client; rebuilt only if the RPC url changes. */
export function ensPublicClient(): EnsPublicClient {
  const url = ensRpcUrl();
  if (cachedPublic !== null && cachedPublic.url === url) {
    return cachedPublic.client;
  }
  const client = createPublicClient({
    chain: sepolia,
    transport: http(url, { batch: { wait: 16 }, timeout: 15_000, retryCount: 1 }),
  });
  cachedPublic = { url, client };
  return client;
}

export function ensWalletClient(account: Account): EnsWalletClient {
  return createWalletClient({
    account,
    chain: sepolia,
    transport: http(ensRpcUrl(), { timeout: 15_000, retryCount: 1 }),
  });
}

function accountFromEnv(names: string[]): Account | null {
  for (const name of names) {
    const raw = optionalEnv(name, "");
    if (raw === "") continue;
    const normalized = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
    try {
      return privateKeyToAccount(normalized);
    } catch {
      throw new Error(`${name} is not a valid private key`);
    }
  }
  return null;
}

/** The key that owns the parent name, or null when this deployment has none. */
export function ensOwnerAccount(): Account | null {
  return accountFromEnv(["ENS_OWNER_PRIVATE_KEY"]);
}

/** SPOTTER's Sepolia signer, or null when receipts are not enabled here. */
export function ensAgentAccount(): Account | null {
  return accountFromEnv(["ENS_AGENT_PRIVATE_KEY", "TREASURY_PRIVATE_KEY"]);
}

/** The configured parent, e.g. gohealthme.eth. Validated to be a .eth 2LD. */
export function ensParentName(): string {
  const name = optionalEnv("ENS_PARENT_NAME", DEFAULT_PARENT_NAME).toLowerCase();
  if (!/^[a-z0-9-]+\.eth$/.test(name)) {
    throw new Error(
      `ENS_PARENT_NAME must be a second-level .eth name, got "${name}"`,
    );
  }
  return name;
}

export function ensParentLabel(): string {
  return firstLabel(ensParentName());
}

export interface EnsNamespace {
  parentName: string;
  parentLabel: string;
  /** GoHealthMe's UserRegistry proxy (ETHRegistry.getSubregistry(parent)). */
  registry: Address;
  /** GoHealthMe's PermissionedResolver proxy (ETHRegistry.getResolver(parent)). */
  resolver: Address;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const NAMESPACE_TTL_MS = 5 * 60 * 1000;
let cachedNamespace: { at: number; value: EnsNamespace } | null = null;

/**
 * Discover the parent's registry and resolver from the ETHRegistry. Null when
 * the parent is not registered (or registered without a subregistry), which
 * every caller reports as "not bootstrapped" rather than guessing.
 */
export async function discoverNamespace(
  client: EnsPublicClient = ensPublicClient(),
  now: number = Date.now(),
): Promise<EnsNamespace | null> {
  if (cachedNamespace !== null && now - cachedNamespace.at < NAMESPACE_TTL_MS) {
    return cachedNamespace.value;
  }
  const parentName = ensParentName();
  const parentLabel = firstLabel(parentName);
  const [registry, resolver] = await Promise.all([
    client.readContract({
      address: ENS_SEPOLIA.ethRegistry,
      abi: REGISTRY_ABI,
      functionName: "getSubregistry",
      args: [parentLabel],
    }),
    client.readContract({
      address: ENS_SEPOLIA.ethRegistry,
      abi: REGISTRY_ABI,
      functionName: "getResolver",
      args: [parentLabel],
    }),
  ]);
  if (registry.toLowerCase() === ZERO || resolver.toLowerCase() === ZERO) {
    return null;
  }
  const value: EnsNamespace = { parentName, parentLabel, registry, resolver };
  cachedNamespace = { at: now, value };
  return value;
}

/** Test seam and post-bootstrap refresh. */
export function resetEnsClientCache(): void {
  cachedPublic = null;
  cachedNamespace = null;
}
