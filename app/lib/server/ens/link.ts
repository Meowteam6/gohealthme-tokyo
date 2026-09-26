// Link an ENS name the player already owns (server only).
//
// Beside "pick a gohealthme.eth name", a player can bring their own name. The
// server forward-resolves it with viem on Ethereum mainnet (viem's built-in
// universal resolver) AND on Sepolia (the ENSv2 universal resolver in
// deployments.ts) and accepts it only when an address record equals the
// signed-in wallet. Nothing is minted and no gas is spent.
//
// The link is a claim that can go stale (the owner re-points the name, sells
// it, lets it expire), so every read re-verifies it once the last check is
// older than LINK_VERIFY_TTL_MS. A link that no longer resolves to the wallet
// is dropped and the player falls back to their subname or short address. A
// read during an RPC outage falls back for that read and keeps the link.
//
// STORAGE: ens-link-<lowercased address>.json { name, chain, linkedAt, verifiedAt }

import { createPublicClient, http, type Address } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { errorMessage } from "@/lib/server/http";
import { optionalEnv } from "@/lib/server/env";
import { invalidateResolvedName } from "@/lib/server/ens/cache";
import { ensPublicClient } from "@/lib/server/ens/client";
import { ENS_SEPOLIA } from "@/lib/server/ens/deployments";
import { resolveNameForAddress } from "@/lib/server/ens/resolve";
import { deleteKey, readJson, writeJson } from "@/lib/server/store";

export const LINK_VERIFY_TTL_MS = 60 * 60 * 1000;

export type LinkChain = "mainnet" | "sepolia";

export interface ChainResolver {
  chain: LinkChain;
  /** addr(60) for the name on this chain, or null when unset. Throws on RPC failure. */
  address: (name: string) => Promise<Address | null>;
}

export interface LinkedName {
  name: string;
  chain: LinkChain;
  linkedAt: string;
  verifiedAt: string;
}

export interface LinkDeps {
  resolvers: ChainResolver[];
  invalidate: (address: string) => Promise<void>;
  now?: () => number;
}

let mainnetClient: { url: string; client: ReturnType<typeof createPublicClient> } | null = null;

function mainnetPublicClient() {
  const url = optionalEnv("MAINNET_RPC_URL", "");
  if (mainnetClient !== null && mainnetClient.url === url) return mainnetClient.client;
  const client = createPublicClient({
    chain: mainnet,
    transport: http(url === "" ? undefined : url, { timeout: 10_000, retryCount: 1 }),
  });
  mainnetClient = { url, client };
  return client;
}

export function liveChainResolvers(): ChainResolver[] {
  return [
    {
      chain: "mainnet",
      address: (name) => mainnetPublicClient().getEnsAddress({ name }),
    },
    {
      chain: "sepolia",
      address: (name) =>
        ensPublicClient().getEnsAddress({
          name,
          universalResolverAddress: ENS_SEPOLIA.universalResolver,
        }),
    },
  ];
}

export function liveLinkDeps(): LinkDeps {
  return { resolvers: liveChainResolvers(), invalidate: invalidateResolvedName };
}

function linkFile(address: string): string {
  return `ens-link-${address.toLowerCase()}.json`;
}

export async function readLinkedName(address: string): Promise<LinkedName | null> {
  return readJson<LinkedName | null>(linkFile(address), null);
}

/** Forget the link (the player picked a subname, or asked). */
export async function unlinkEnsName(address: string): Promise<void> {
  await deleteKey(linkFile(address));
  await invalidateResolvedName(address);
}

type Verdict =
  | { kind: "match"; chain: LinkChain }
  | { kind: "elsewhere" }
  | { kind: "unset" }
  | { kind: "unknown" };

/** Resolve on every chain; a match on any chain wins. */
async function verify(
  name: string,
  address: string,
  resolvers: ChainResolver[],
): Promise<Verdict> {
  const wanted = address.toLowerCase();
  const answers = await Promise.allSettled(resolvers.map((r) => r.address(name)));
  let elsewhere = false;
  let failed = 0;
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (a.status === "rejected") {
      failed += 1;
      console.warn(`[ens/link] ${resolvers[i].chain} lookup of ${name} failed: ${errorMessage(a.reason)}`);
      continue;
    }
    if (a.value === null) continue;
    if (a.value.toLowerCase() === wanted) return { kind: "match", chain: resolvers[i].chain };
    elsewhere = true;
  }
  if (elsewhere) return { kind: "elsewhere" };
  if (failed === answers.length) return { kind: "unknown" };
  return { kind: "unset" };
}

export type LinkOutcome =
  | { ok: true; name: string; chain: LinkChain }
  | { ok: false; status: number; reason: string };

export async function linkEnsName(
  input: { address: string; rawName: string },
  deps: LinkDeps = liveLinkDeps(),
): Promise<LinkOutcome> {
  const now = deps.now ?? Date.now;
  let name: string;
  try {
    name = normalize(input.rawName.trim());
  } catch {
    name = "";
  }
  if (name === "" || !name.includes(".") || name.startsWith(".") || name.endsWith(".")) {
    return { ok: false, status: 400, reason: "That is not an ENS name. Try something like yourname.eth." };
  }

  const verdict = await verify(name, input.address, deps.resolvers);
  switch (verdict.kind) {
    case "elsewhere":
      return {
        ok: false,
        status: 403,
        reason: `${name} points at a different wallet. Set its address to this wallet in the ENS app, then try again.`,
      };
    case "unset":
      return {
        ok: false,
        status: 404,
        reason: `${name} does not resolve to an address on Ethereum or Sepolia.`,
      };
    case "unknown":
      return {
        ok: false,
        status: 502,
        reason: "Could not reach ENS just now. Nothing was saved; try again.",
      };
    case "match": {
      const at = new Date(now()).toISOString();
      await writeJson<LinkedName>(linkFile(input.address), {
        name,
        chain: verdict.chain,
        linkedAt: at,
        verifiedAt: at,
      });
      await deps.invalidate(input.address);
      return { ok: true, name, chain: verdict.chain };
    }
  }
}

export interface DisplayDeps {
  resolvers: ChainResolver[];
  /** The name when there is no live link (primary name, then subname). */
  fallback: (address: string) => Promise<string | null>;
  now?: () => number;
}

export function liveDisplayDeps(): DisplayDeps {
  return { resolvers: liveChainResolvers(), fallback: (a) => resolveNameForAddress(a) };
}

/**
 * The name a wallet is shown as: its linked own ENS name while that still
 * resolves to it, else the existing resolution (primary name, then subname).
 */
export async function displayNameForAddress(
  address: string,
  deps: DisplayDeps = liveDisplayDeps(),
): Promise<string | null> {
  const now = deps.now ?? Date.now;
  let link: LinkedName | null = null;
  try {
    link = await readLinkedName(address);
  } catch {
    link = null;
  }
  if (link !== null) {
    const age = now() - Date.parse(link.verifiedAt);
    if (age >= 0 && age < LINK_VERIFY_TTL_MS) return link.name;
    const verdict = await verify(link.name, address, deps.resolvers);
    if (verdict.kind === "match") {
      try {
        await writeJson<LinkedName>(linkFile(address), {
          ...link,
          chain: verdict.chain,
          verifiedAt: new Date(now()).toISOString(),
        });
      } catch {
        // Re-verified again next read. Slower, never wrong.
      }
      return link.name;
    }
    if (verdict.kind !== "unknown") {
      console.info(`[ens/link] ${link.name} no longer resolves to ${address}; link dropped`);
      try {
        await deleteKey(linkFile(address));
      } catch {
        // Checked again next read.
      }
    }
  }
  return deps.fallback(address);
}
