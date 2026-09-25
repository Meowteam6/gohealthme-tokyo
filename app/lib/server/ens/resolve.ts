// Real ENSv2 resolution on Sepolia (server only). Every name the app shows
// comes through here: the universal resolver walks the registry hierarchy
// (root -> eth -> gohealthme -> <label>) and asks the resolver it lands on.
// There is no lookup table; a name that does not resolve on chain is not a
// name the app will show.
//
// Reads are injectable (ResolveDeps) so the unit tests drive them with fakes
// and never touch an RPC, in the same style as the agent's ArcReader.

import {
  type Address,
  type Hex,
  BaseError,
  ContractFunctionRevertedError,
} from "viem";
import {
  AGENT_LABEL,
  BASE_SEPOLIA_COIN_TYPE,
  ETH_COIN_TYPE,
  RECEIPT_KEYS,
  RECEIPT_KEY_LIST,
  RESOLVER_ROLE_SET_TEXT,
  addressFromBytes,
  agentName,
  checkEnsLabel,
  decodeReceipt,
  dnsEncode,
  isPoolLabel,
  labelId,
  nodeOf,
  poolName,
  subname,
  textResource,
  type ReceiptKey,
  type SettlementReceipt,
} from "@/lib/ens/names";
import { optionalEnv } from "@/lib/server/env";
import {
  discoverNamespace,
  ensAgentAccount,
  ensOwnerAccount,
  ensPublicClient,
  type EnsNamespace,
  type EnsPublicClient,
} from "@/lib/server/ens/client";
import {
  ENS_SEPOLIA,
  PERMISSIONED_RESOLVER_ABI,
  REGISTRY_ABI,
} from "@/lib/server/ens/deployments";
import { readJson, writeJson } from "@/lib/server/store";

/** The subset of a viem public client resolution needs; fakes implement it. */
export type EnsReader = Pick<
  EnsPublicClient,
  | "getEnsText"
  | "getEnsAddress"
  | "getEnsName"
  | "readContract"
  | "getLogs"
  | "getBlockNumber"
  | "simulateContract"
>;

export interface ResolveDeps {
  client: EnsReader;
  namespace: () => Promise<EnsNamespace | null>;
}

export function liveResolveDeps(): ResolveDeps {
  const client = ensPublicClient();
  return { client, namespace: () => discoverNamespace(client) };
}

const UR = ENS_SEPOLIA.universalResolver;
const ZERO = "0x0000000000000000000000000000000000000000";

// ------------------------------------------------------------ primitives

/** A text record through the universal resolver, or null when unset. */
export async function resolveText(
  name: string,
  key: string,
  deps: ResolveDeps = liveResolveDeps(),
): Promise<string | null> {
  const value = await deps.client.getEnsText({
    name,
    key,
    universalResolverAddress: UR,
  });
  return value === null || value === "" ? null : value;
}

/**
 * An address record through the universal resolver. Coin type 60 is the
 * Ethereum address; Base Sepolia records use the ENSIP-11 coin type for
 * chain 84532. Null when the record is empty.
 */
export async function resolveAddress(
  name: string,
  coinType: bigint = ETH_COIN_TYPE,
  deps: ResolveDeps = liveResolveDeps(),
): Promise<Address | null> {
  const value = await deps.client.getEnsAddress({
    name,
    coinType: coinType === ETH_COIN_TYPE ? undefined : coinType,
    universalResolverAddress: UR,
  });
  if (value === null) return null;
  return addressFromBytes(value as Hex);
}

// --------------------------------------------------------------- receipts

export interface PoolReceiptRead {
  name: string;
  records: Partial<Record<ReceiptKey, string | null>>;
  receipt: SettlementReceipt | null;
}

/**
 * The settlement receipt at pool-<id>.<parent>, read record by record through
 * real resolution. `receipt` is null until the agent's write has landed.
 */
export async function readPoolReceipt(
  poolId: bigint,
  deps: ResolveDeps = liveResolveDeps(),
): Promise<PoolReceiptRead | null> {
  const namespace = await deps.namespace();
  if (namespace === null) return null;
  const name = poolName(poolId, namespace.parentName);
  const values = await Promise.all(
    RECEIPT_KEY_LIST.map((key) => resolveText(name, key, deps)),
  );
  const records: Partial<Record<ReceiptKey, string | null>> = {};
  RECEIPT_KEY_LIST.forEach((key, i) => {
    records[key] = values[i];
  });
  return { name, records, receipt: decodeReceipt(records) };
}

// ------------------------------------------------------------------ agent

export interface AgentIdentity {
  name: string;
  /** addr(60): the Sepolia signer that writes receipts. */
  sepoliaAddress: Address | null;
  /** addr(coinType 84532): the Base Sepolia settler that moves USDC. */
  baseAddress: Address | null;
}

/** What spotter.<parent> resolves to, on both chains the agent acts on. */
export async function resolveAgent(
  deps: ResolveDeps = liveResolveDeps(),
): Promise<AgentIdentity | null> {
  const namespace = await deps.namespace();
  if (namespace === null) return null;
  const name = agentName(namespace.parentName);
  const [sepoliaAddress, baseAddress] = await Promise.all([
    resolveAddress(name, ETH_COIN_TYPE, deps),
    resolveAddress(name, BASE_SEPOLIA_COIN_TYPE, deps),
  ]);
  return { name, sepoliaAddress, baseAddress };
}

// ----------------------------------------------------------- availability

export type Availability =
  | { available: true; name: string }
  | { available: false; reason: string; name?: string };

/**
 * Whether a participant label can be minted right now. Reserved and malformed
 * labels are refused by the pure rule; anything else is answered by the
 * registry itself (findOwner), so a name minted outside the app is still
 * seen as taken.
 */
export async function labelAvailability(
  rawLabel: string,
  deps: ResolveDeps = liveResolveDeps(),
): Promise<Availability> {
  const check = checkEnsLabel(rawLabel);
  if (!check.ok) return { available: false, reason: check.reason };
  const namespace = await deps.namespace();
  if (namespace === null) {
    return {
      available: false,
      reason: "Names are not enabled on this deployment yet.",
    };
  }
  const name = subname(check.label, namespace.parentName);
  const owner = await deps.client.readContract({
    address: namespace.registry,
    abi: REGISTRY_ABI,
    functionName: "findOwner",
    args: [check.label],
  });
  if (owner.toLowerCase() !== ZERO) {
    return { available: false, reason: "That name is already taken.", name };
  }
  return { available: true, name };
}

/** The current owner of <label>.<parent>, or null when unregistered. */
export async function labelOwner(
  label: string,
  deps: ResolveDeps = liveResolveDeps(),
): Promise<Address | null> {
  const namespace = await deps.namespace();
  if (namespace === null) return null;
  const owner = await deps.client.readContract({
    address: namespace.registry,
    abi: REGISTRY_ABI,
    functionName: "findOwner",
    args: [label],
  });
  return owner.toLowerCase() === ZERO ? null : owner;
}

// -------------------------------------------------------- address -> name
//
// Two real paths, in order. (1) The ENS primary name, if the wallet ever set
// one (reverseWithGateways on the universal resolver). (2) GoHealthMe's own
// registry: LabelRegistered events name every subname ever minted and who
// received it; each candidate is then forward-resolved and kept only if its
// addr(60) record points back at the address. Ownership can move and records
// can be re-pointed, so the forward check is the authority, the event log is
// only the index.

export interface NameIndexEntry {
  label: string;
  owner: string;
  block: string;
}

export interface NameIndex {
  registry: string;
  scannedTo: string;
  entries: NameIndexEntry[];
}

export const NAME_INDEX_FILE = "ens-name-index.json";
export const INDEX_WINDOW_BLOCKS = 10_000n;
export const INDEX_MAX_WINDOWS_PER_REFRESH = 20;
/** How far back a fresh index looks when no ENS_INDEX_FROM_BLOCK is set. */
export const INDEX_DEFAULT_LOOKBACK_BLOCKS = 200_000n;
const INDEX_REFRESH_MIN_MS = 30 * 1000;

let lastIndexRefresh: { registry: string; at: number } | null = null;

const LABEL_REGISTERED = REGISTRY_ABI.find(
  (item) => item.type === "event" && item.name === "LabelRegistered",
);

function indexFromBlock(latest: bigint): bigint {
  const configured = optionalEnv("ENS_INDEX_FROM_BLOCK", "");
  if (configured !== "" && /^[0-9]+$/.test(configured)) return BigInt(configured);
  return latest > INDEX_DEFAULT_LOOKBACK_BLOCKS
    ? latest - INDEX_DEFAULT_LOOKBACK_BLOCKS
    : 0n;
}

/**
 * Bring the LabelRegistered index up to the chain head, in bounded windows.
 * Persisted in the store so a cold lambda continues rather than restarts.
 */
export async function refreshNameIndex(
  deps: ResolveDeps,
  namespace: EnsNamespace,
  now: number = Date.now(),
): Promise<NameIndex> {
  const registry = namespace.registry.toLowerCase();
  let index: NameIndex;
  try {
    const stored = await readJson<NameIndex | null>(NAME_INDEX_FILE, null);
    index =
      stored !== null && stored.registry === registry
        ? stored
        : { registry, scannedTo: "", entries: [] };
  } catch {
    index = { registry, scannedTo: "", entries: [] };
  }

  if (
    lastIndexRefresh !== null &&
    lastIndexRefresh.registry === registry &&
    now - lastIndexRefresh.at < INDEX_REFRESH_MIN_MS
  ) {
    return index;
  }

  const latest = await deps.client.getBlockNumber();
  let from =
    index.scannedTo === "" ? indexFromBlock(latest) : BigInt(index.scannedTo) + 1n;
  let windows = 0;
  while (from <= latest && windows < INDEX_MAX_WINDOWS_PER_REFRESH) {
    const to = from + INDEX_WINDOW_BLOCKS - 1n < latest ? from + INDEX_WINDOW_BLOCKS - 1n : latest;
    const logs = await deps.client.getLogs({
      address: namespace.registry,
      event: LABEL_REGISTERED,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const args = (log as unknown as { args: { label?: string; owner?: Address } }).args;
      if (args.label === undefined || args.owner === undefined) continue;
      index.entries.push({
        label: args.label,
        owner: args.owner.toLowerCase(),
        block: (log.blockNumber ?? to).toString(),
      });
    }
    index.scannedTo = to.toString();
    from = to + 1n;
    windows += 1;
  }
  lastIndexRefresh = { registry, at: now };
  try {
    await writeJson(NAME_INDEX_FILE, index);
  } catch {
    // Rescanned next time. Slower, never wrong.
  }
  return index;
}

/**
 * The name a wallet should be shown as, or null. Never a guess: the answer is
 * either the wallet's ENS primary name or a GoHealthMe subname whose address
 * record resolves back to the wallet.
 */
export async function resolveNameForAddress(
  address: string,
  deps: ResolveDeps = liveResolveDeps(),
): Promise<string | null> {
  const wanted = address.toLowerCase();

  try {
    const primary = await deps.client.getEnsName({
      address: address as Address,
      universalResolverAddress: UR,
    });
    if (primary !== null && primary !== "") return primary;
  } catch {
    // No reverse record, or a resolver the universal resolver could not
    // reach. Fall through to the registry index.
  }

  const namespace = await deps.namespace();
  if (namespace === null) return null;
  const index = await refreshNameIndex(deps, namespace);
  const candidates = index.entries
    .filter(
      (e) =>
        e.owner === wanted &&
        e.label !== AGENT_LABEL &&
        !isPoolLabel(e.label),
    )
    .reverse();
  for (const candidate of candidates) {
    const name = subname(candidate.label, namespace.parentName);
    const resolved = await resolveAddress(name, ETH_COIN_TYPE, deps);
    if (resolved !== null && resolved.toLowerCase() === wanted) return name;
  }
  return null;
}

// ------------------------------------------------------ permission matrix
//
// The boundary the prize text asks for, proven against the live contracts
// with eth_call from each actor's address. A denied row is a real revert
// (EACUnauthorizedAccountRoles from EnhancedAccessControl), not a UI flag.

export interface PermissionRow {
  actor: "agent" | "owner" | "stranger";
  action: string;
  allowed: boolean;
  /** The revert name when denied, or the reason it could not be evaluated. */
  detail?: string;
}

function revertName(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null;
    if (reverted !== null) {
      return reverted.data?.errorName ?? reverted.reason ?? reverted.shortMessage;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

async function simulate(
  deps: ResolveDeps,
  actor: PermissionRow["actor"],
  action: string,
  run: () => Promise<unknown>,
): Promise<PermissionRow> {
  try {
    await run();
    return { actor, action, allowed: true };
  } catch (err) {
    return { actor, action, allowed: false, detail: revertName(err) };
  }
}

/** A throwaway address that holds nothing on either contract. */
export const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";

/**
 * Evaluate what each actor may do, from the chain's point of view. Needs the
 * agent and owner addresses; when a key is missing the matching rows say so
 * instead of being silently absent.
 */
export async function permissionMatrix(
  deps: ResolveDeps = liveResolveDeps(),
  actors: { agent: Address | null; owner: Address | null } = {
    agent: ensAgentAccount()?.address ?? null,
    owner: ensOwnerAccount()?.address ?? null,
  },
): Promise<PermissionRow[]> {
  const namespace = await deps.namespace();
  if (namespace === null) return [];
  const { parentName, registry, resolver } = namespace;
  const pool = poolName(1n, parentName);
  const agent = agentName(parentName);
  const rows: PermissionRow[] = [];

  const setText = (
    account: Address,
    name: string,
    key: string,
    value: string,
  ) =>
    deps.client.simulateContract({
      account,
      address: resolver,
      abi: PERMISSIONED_RESOLVER_ABI,
      functionName: "setText",
      args: [dnsEncode(name), key, value],
    });

  if (actors.agent !== null) {
    const a = actors.agent;
    rows.push(
      await simulate(deps, "agent", `setText ${RECEIPT_KEYS.txHash} on ${pool}`, () =>
        setText(a, pool, RECEIPT_KEYS.txHash, "0x"),
      ),
      await simulate(deps, "agent", `setText gohealthme.pool.id on ${pool}`, () =>
        setText(a, pool, "gohealthme.pool.id", "999"),
      ),
      await simulate(deps, "agent", `setAddress coinType 60 on ${agent}`, () =>
        deps.client.simulateContract({
          account: a,
          address: resolver,
          abi: PERMISSIONED_RESOLVER_ABI,
          functionName: "setAddress",
          args: [dnsEncode(agent), ETH_COIN_TYPE, a.toLowerCase() as Hex],
        }),
      ),
      await simulate(deps, "agent", `linkToNode ${pool} -> ${agent}`, () =>
        deps.client.simulateContract({
          account: a,
          address: resolver,
          abi: PERMISSIONED_RESOLVER_ABI,
          functionName: "linkToNode",
          args: [dnsEncode(`alias.${parentName}`), nodeOf(pool)],
        }),
      ),
      await simulate(deps, "agent", `registry.register pool-999`, () =>
        deps.client.simulateContract({
          account: a,
          address: registry,
          abi: REGISTRY_ABI,
          functionName: "register",
          args: ["pool-999", a, ZERO, resolver, 0n, 2n ** 64n - 1n],
        }),
      ),
      await simulate(deps, "agent", `registry.setResolver ${agent} -> stranger`, () =>
        deps.client.simulateContract({
          account: a,
          address: registry,
          abi: REGISTRY_ABI,
          functionName: "setResolver",
          args: [labelId(AGENT_LABEL), STRANGER],
        }),
      ),
    );
  } else {
    rows.push({
      actor: "agent",
      action: "any",
      allowed: false,
      detail: "ENS_AGENT_PRIVATE_KEY is not set on this deployment",
    });
  }

  rows.push(
    await simulate(deps, "stranger", `setText ${RECEIPT_KEYS.txHash} on ${pool}`, () =>
      setText(STRANGER, pool, RECEIPT_KEYS.txHash, "0x"),
    ),
  );

  if (actors.owner !== null) {
    const o = actors.owner;
    rows.push(
      await simulate(deps, "owner", `setText gohealthme.pool.id on ${pool}`, () =>
        setText(o, pool, "gohealthme.pool.id", "1"),
      ),
    );
  }
  return rows;
}

/** Whether the agent holds ROLE_SET_TEXT on a receipt key, read from chain. */
export async function agentHoldsReceiptRole(
  key: ReceiptKey,
  agent: Address,
  deps: ResolveDeps = liveResolveDeps(),
): Promise<boolean> {
  const namespace = await deps.namespace();
  if (namespace === null) return false;
  return deps.client.readContract({
    address: namespace.resolver,
    abi: PERMISSIONED_RESOLVER_ABI,
    functionName: "hasRoles",
    args: [textResource(key), RESOLVER_ROLE_SET_TEXT, agent],
  });
}
