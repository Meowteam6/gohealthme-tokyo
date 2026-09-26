import {
  createPublicClient,
  fallback,
  formatUnits,
  http,
  parseAbiItem,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
  encodeAbiParameters,
  getAddress,
  keccak256,
  toHex,
} from "viem";
import { baseSepolia } from "@/lib/chains";
import { poolsScanFromBlock } from "@/lib/server/chunked-logs";
import { proofTierFromVerdict, type ProofTier } from "@/lib/proof-tier";
import { isFrozenV3Pools } from "@/lib/frozen-pools";

export { proofTierFromVerdict, type ProofTier };

// ---------------------------------------------------------------- addresses

/** Canonical USDC ERC-20 on Base Sepolia (6 decimals). */
export const USDC_ADDRESS: Address =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const USDC_DECIMALS = 6;

/**
 * HealthPools deployment address. Set NEXT_PUBLIC_HEALTH_POOLS_ADDRESS once
 * the contract agent deploys; pages surface a visible configuration error
 * until then rather than failing silently.
 *
 * The frozen V3 pilot address is refused (null, the same "not configured"
 * state every surface already renders honestly): V4 must never show V3 users'
 * activity as its own, or let a V4 player join or fund a V3 pool.
 */
export function getHealthPoolsAddress(): Address | null {
  const raw = process.env.NEXT_PUBLIC_HEALTH_POOLS_ADDRESS;
  if (raw === undefined || raw === "") return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  if (isFrozenV3Pools(raw)) {
    console.error(
      "NEXT_PUBLIC_HEALTH_POOLS_ADDRESS is the frozen V3 pilot contract; refusing it. Point it at the Tokyo HealthPoolsV3.",
    );
    return null;
  }
  return raw as Address;
}

/**
 * HealthVerdict registry address for READ-ONLY tier lookups from the browser.
 * The registry's `verified` bool and facet `bitmap` are public routing data
 * (never health data), so a client may read them to tell a verified win from a
 * low-trust self-reported one. Null when unset — callers then treat the tier as
 * "unknown" and MUST NOT present the claim as verified. The value is the public
 * on-chain address, mirroring NEXT_PUBLIC_HEALTH_POOLS_ADDRESS.
 */
export function getHealthVerdictAddress(): Address | null {
  const raw = process.env.NEXT_PUBLIC_HEALTH_VERDICT_ADDRESS;
  if (raw === undefined || raw === "") return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return raw as Address;
}

// ---------------------------------------------------------------------- abi

export const healthPoolsAbi = [
  {
    type: "function",
    name: "createPool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "initiative", type: "string" },
      { name: "goalSpec", type: "string" },
      { name: "entryFee", type: "uint256" },
      { name: "periodStart", type: "uint64" },
      { name: "periodEnd", type: "uint64" },
      { name: "bountyModel", type: "uint8" },
      { name: "initialFunding", type: "uint256" },
    ],
    outputs: [{ name: "poolId", type: "uint256" }],
  },
  {
    type: "function",
    name: "joinPool",
    stateMutability: "nonpayable",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "joinGateEnabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "joinAllowed",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setJoinGateEnabled",
    stateMutability: "nonpayable",
    inputs: [{ name: "enabled", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setJoinAllowed",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setJoinAllowedBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accounts", type: "address[]" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "recordResult",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "user", type: "address" },
      { name: "verdict", type: "bool" },
      { name: "multiplierBps", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "fundPool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  // Pull-payment withdrawals (C-1). settle() only CREDITS owed[user]; these are
  // the ONLY functions that move USDC out of the contract, so the claim UI must
  // call them - a settled payout sits stranded until withdraw() runs. Signatures
  // verified against contracts/src/HealthPoolsV3.sol.
  {
    type: "function",
    name: "owed",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "sweep",
    stateMutability: "nonpayable",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimRefund",
    stateMutability: "nonpayable",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [],
  },
  // B-1: the entry-fee refunds still owed on a cancelled pool. sweep() reverts
  // REFUNDS_PENDING until this is zero, so the creator's "take back the
  // leftover" action reads it to say why it is not available yet.
  {
    type: "function",
    name: "refundLiability",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [
      {
        name: "pool",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "bountyModel", type: "uint8" },
          { name: "settled", type: "bool" },
          { name: "cancelled", type: "bool" },
          { name: "periodStart", type: "uint64" },
          { name: "periodEnd", type: "uint64" },
          { name: "entryFee", type: "uint256" },
          { name: "balance", type: "uint256" },
          { name: "initiative", type: "string" },
          { name: "goalSpec", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getParticipant",
    stateMutability: "view",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [
      {
        name: "participant",
        type: "tuple",
        components: [
          { name: "joined", type: "bool" },
          { name: "resultRecorded", type: "bool" },
          { name: "verdict", type: "bool" },
          { name: "refunded", type: "bool" },
          { name: "multiplierBps", type: "uint16" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "participantCount",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "poolCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "computeGoalId",
    stateMutability: "view",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "participant", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "event",
    name: "PoolCreated",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "initiative", type: "string", indexed: false },
      { name: "goalSpec", type: "string", indexed: false },
      { name: "entryFee", type: "uint256", indexed: false },
      { name: "periodStart", type: "uint64", indexed: false },
      { name: "periodEnd", type: "uint64", indexed: false },
      { name: "bountyModel", type: "uint8", indexed: false },
    ],
  },
  // Read-only money/identity events for the social layer. These carry
  // addresses, amounts, and tx hashes ONLY - no initiative, no goalSpec, no
  // health string of any kind - so aggregating them is redaction-safe by
  // construction. Signatures verified against contracts/src/HealthPools.sol.
  {
    type: "event",
    name: "PoolJoined",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ResultRecorded",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "verdict", type: "bool", indexed: false },
      { name: "multiplierBps", type: "uint16", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AchieverPaid",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  // Emitted by withdraw() when USDC actually leaves the contract for the caller.
  // Unlike AchieverPaid (a credit to owed[]), this is the real transfer, so the
  // claim hook asserts on it to confirm money moved - never on tx success alone.
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  // RefundCredited is what claimRefund() emits on a cancelled pool (and what
  // settle() emits for an unadjudicated participant). The refund hook asserts
  // on it for this participant and pool - never on tx success alone.
  {
    type: "event",
    name: "RefundCredited",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  // PoolFunded carries the funder ADDRESS (indexed) and amount only - no
  // initiative, no goalSpec, no health string - so reading it to name who
  // chipped in to a pool is redaction-safe. sponsor-data.ts aggregates the same
  // event into counts and discards the identities; the social contributors
  // reader is the one place that keeps the funder addresses. Signature verified
  // against contracts/src/HealthPools.sol.
  {
    type: "event",
    name: "PoolFunded",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const poolCreatedEvent = parseAbiItem(
  "event PoolCreated(uint256 indexed poolId, address indexed creator, string initiative, string goalSpec, uint256 entryFee, uint64 periodStart, uint64 periodEnd, uint8 bountyModel)",
);

// Parsed event items for getLogs in the social-stats aggregator. Indexed
// address params let the RPC filter server-side per wallet.
export const achieverPaidEvent = parseAbiItem(
  "event AchieverPaid(uint256 indexed poolId, address indexed participant, uint256 amount)",
);
// The real USDC-out event, for asserting a withdraw actually moved money.
export const withdrawnEvent = parseAbiItem(
  "event Withdrawn(address indexed account, uint256 amount)",
);
export const poolJoinedEvent = parseAbiItem(
  "event PoolJoined(uint256 indexed poolId, address indexed participant)",
);
export const resultRecordedEvent = parseAbiItem(
  "event ResultRecorded(uint256 indexed poolId, address indexed participant, bool verdict, uint16 multiplierBps)",
);
// Keyed by poolId to name a pool's contributors. Indexed poolId + funder let
// the RPC filter server-side for one pool; the reader keeps the funder address
// (sponsor-data.ts's own copy of this event drops it into counts).
export const poolFundedEvent = parseAbiItem(
  "event PoolFunded(uint256 indexed poolId, address indexed funder, uint256 amount)",
);

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ------------------------------------------------------------------ clients

let cachedClient: PublicClient | null = null;
let cachedRpcOverride: string | null = null;

/**
 * The endpoints this client falls back across.
 *
 * The public list is the chain definition itself, so there is one copy of it
 * for the browser, lib/server/arc-client.ts and lib/chains.ts to share.
 *
 * ARC_RPC_URL, when set, is the ONLY endpoint, matching the operator override
 * lib/server/arc-client.ts and lib/server/pools.ts already honour — this
 * module was the last Arc consumer that ignored it, which meant a server-side
 * read through fetchPool() (loadClaimPool, and therefore both claim routes)
 * could not be pointed at a private or local endpoint at all. The override
 * replaces the public list rather than heading it: an operator who pins an
 * endpoint means it, and quietly falling through a pinned endpoint sends
 * traffic to exactly the endpoints the pin exists to avoid.
 *
 * The browser never sees the variable (it is not NEXT_PUBLIC), so this is a
 * server-side override by construction.
 */
function baseRpcUrls(): string[] {
  const override = process.env.BASE_SEPOLIA_RPC_URL ?? "";
  if (override === "") return [...baseSepolia.rpcUrls.default.http];
  return [override];
}

/** Shared Base Sepolia public client with RPC fallbacks for flaky venue WiFi. */
export function getArcPublicClient(): PublicClient {
  const override = process.env.BASE_SEPOLIA_RPC_URL ?? "";
  // Rebuild when the override changes rather than serving a client pinned to
  // an endpoint the operator has since moved off.
  if (cachedClient === null || cachedRpcOverride !== override) {
    cachedRpcOverride = override;
    cachedClient = createPublicClient({
      chain: baseSepolia,
      transport: fallback(baseRpcUrls().map((url) => http(url))),
    });
  }
  return cachedClient;
}

// -------------------------------------------------------------------- types

export interface PoolInfo {
  id: bigint;
  creator: Address;
  bountyModel: number;
  settled: boolean;
  cancelled: boolean;
  periodStart: bigint;
  periodEnd: bigint;
  entryFee: bigint;
  balance: bigint;
  initiative: string;
  goalSpec: string;
}

export interface ParticipantInfo {
  joined: boolean;
  resultRecorded: boolean;
  verdict: boolean;
  refunded: boolean;
  multiplierBps: number;
}

/** What a player reads when this build has no pools contract. Plain words:
 *  the env var name goes to the console, never onto the screen. */
export const POOLS_NOT_CONFIGURED_COPY =
  "Runs are not open on this build yet. Nothing was sent.";

export class ContractNotConfiguredError extends Error {
  constructor() {
    super(POOLS_NOT_CONFIGURED_COPY);
    this.name = "ContractNotConfiguredError";
    console.error(
      "HealthPools contract address is not configured (or is the refused V3 address). Set NEXT_PUBLIC_HEALTH_POOLS_ADDRESS to the Tokyo HealthPoolsV3 and redeploy.",
    );
  }
}

// -------------------------------------------------------------------- reads

async function readPool(address: Address, id: bigint): Promise<PoolInfo> {
  const client = getArcPublicClient();
  const pool = await client.readContract({
    address,
    abi: healthPoolsAbi,
    functionName: "getPool",
    args: [id],
  });
  return {
    id,
    creator: pool.creator,
    bountyModel: pool.bountyModel,
    settled: pool.settled,
    cancelled: pool.cancelled,
    periodStart: pool.periodStart,
    periodEnd: pool.periodEnd,
    entryFee: pool.entryFee,
    balance: pool.balance,
    initiative: pool.initiative,
    goalSpec: pool.goalSpec,
  };
}

/**
 * The USDC a wallet can pull right now via withdraw(), in 6-decimal base units.
 *
 * settle() only CREDITS this ledger (owed[user]); the funds do not reach the
 * wallet until withdraw() runs. This read is what tells the claim UI there is
 * money to claim. Returns 0n when the contract address is unset - the same
 * not-configured convention the write path uses - so a misconfigured build
 * shows "nothing to claim" rather than throwing on a public read.
 */
export async function readOwed(account: Address): Promise<bigint> {
  const address = getHealthPoolsAddress();
  if (address === null) return 0n;
  const client = getArcPublicClient();
  return client.readContract({
    address,
    abi: healthPoolsAbi,
    functionName: "owed",
    args: [account],
  });
}

/**
 * The browser's per-call eth_getLogs window.
 *
 * Deliberately far smaller than the 90k window in lib/server/chunked-logs.ts.
 * That window targets the archival endpoint the server override (ARC_RPC_URL)
 * points at, which allows 90k. The browser has no such override: its fallback
 * list leads with rpc.blockdaemon.testnet.arc.network, which has PRUNED all
 * deploy-era history (it answers "pruned history unavailable" below ~57M), then
 * falls through to rpc.testnet.arc.network, which caps eth_getLogs at a 10,000
 * block range ("eth_getLogs is limited to a 10,000 range") and rate-limits a
 * burst of calls. 9,000 stays safely under that 10k cap. Measured 2026-08-20
 * against both live endpoints.
 */
const CLIENT_LOG_WINDOW = 9_000n;

/** Windows run at once. Kept low because a burst trips the public RPC's rate
 *  limit, and the sponsor console fires its own scan alongside this one. */
const CLIENT_LOG_CONCURRENCY = 4;

/**
 * Windowed eth_getLogs. Splits [fromBlock, toBlock] into spans no wider than
 * CLIENT_LOG_WINDOW and concatenates the results, so no single call exceeds the
 * public RPC's range cap. Mirrors scanInWindows in lib/server/chunked-logs.ts
 * but with the browser's tighter window, which that shared helper hard-codes at
 * 90k and offers no way to lower.
 */
async function scanLogsInWindows<T>(
  fromBlock: bigint,
  toBlock: bigint,
  query: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
): Promise<T[]> {
  if (toBlock < fromBlock) return [];
  const windows: Array<[bigint, bigint]> = [];
  for (let from = fromBlock; from <= toBlock; from += CLIENT_LOG_WINDOW) {
    const end = from + CLIENT_LOG_WINDOW - 1n;
    windows.push([from, end > toBlock ? toBlock : end]);
  }
  const out: T[] = [];
  for (let i = 0; i < windows.length; i += CLIENT_LOG_CONCURRENCY) {
    const batch = windows.slice(i, i + CLIENT_LOG_CONCURRENCY);
    const results = await Promise.all(batch.map(([f, t]) => query(f, t)));
    for (const r of results) out.push(...r);
  }
  return out;
}

/**
 * Discover every pool.
 *
 * Pools are numbered 1..poolCount and never deleted, so reading poolCount and
 * enumerating that range yields the complete, authoritative pool list in a
 * single state read - and it is the only discovery path that works from the
 * browser, whose RPCs cannot serve deploy-era PoolCreated logs (blockdaemon has
 * pruned them; rpc.testnet.arc.network rate-limits the hundreds of windows a
 * full historical scan needs). Measured 2026-08-20: enumeration returns the
 * full list in ~0.5s where a windowed log scan takes ~3.3s before falling
 * through to enumeration anyway.
 *
 * The windowed PoolCreated scan is the fallback, reached only when poolCount
 * itself cannot be read. It covers environments where an archival RPC (a
 * server-side ARC_RPC_URL) can serve the logs, and is windowed under the public
 * RPC's range cap so it never repeats the original "requested range too large"
 * failure of a single fromBlock:0 call.
 */
export async function fetchPools(): Promise<PoolInfo[]> {
  const address = getHealthPoolsAddress();
  if (address === null) throw new ContractNotConfiguredError();
  const client = getArcPublicClient();

  let ids: bigint[] = [];
  let haveCount = false;
  try {
    const count = await client.readContract({
      address,
      abi: healthPoolsAbi,
      functionName: "poolCount",
    });
    ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
    haveCount = true;
  } catch {
    haveCount = false;
  }

  // Only fall through to the log scan when poolCount could not be read. A
  // successful poolCount of 0 means there genuinely are no pools; it must not
  // trigger a pointless historical scan.
  if (!haveCount) {
    try {
      const latest = await client.getBlockNumber();
      const logs = await scanLogsInWindows(
        poolsScanFromBlock(),
        latest,
        (fromBlock, toBlock) =>
          client.getLogs({
            address,
            event: poolCreatedEvent,
            fromBlock,
            toBlock,
          }),
      );
      ids = logs
        .map((log) => log.args.poolId)
        .filter((id): id is bigint => id !== undefined);
    } catch {
      ids = [];
    }
  }

  const unique = Array.from(new Set(ids.map((id) => id.toString()))).map(
    (s) => BigInt(s),
  );
  const pools = await Promise.all(unique.map((id) => readPool(address, id)));
  return pools.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function fetchPool(id: bigint): Promise<PoolInfo> {
  const address = getHealthPoolsAddress();
  if (address === null) throw new ContractNotConfiguredError();
  return readPool(address, id);
}

/**
 * Storage slot of HealthPoolsV3's `participantList` mapping
 * (mapping(uint256 => address[])), from `forge inspect HealthPoolsV3
 * storageLayout`. Pinned by lib/participants.test.ts against the compiled
 * layout, and checked on every read against participantCount.
 */
export const PARTICIPANT_LIST_SLOT = 7n;

/**
 * Who joined a pool. HealthPoolsV3 keeps the list in an internal array with no
 * getter (only participantCount), and the public Base RPC caps eth_getLogs at
 * 1,000 blocks, so the list is read straight from contract storage: the array
 * length sits at keccak256(poolId . slot) and element i at keccak256(that) + i.
 * One read per player, exact, in join order. A length that disagrees with
 * participantCount throws rather than show a wrong list.
 */
export async function readParticipants(
  client: PublicClient,
  address: Address,
  id: bigint,
): Promise<Address[]> {
  const count = await client.readContract({
    address,
    abi: healthPoolsAbi,
    functionName: "participantCount",
    args: [id],
  });
  if (count === 0n) return [];
  const lengthSlot = keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [id, PARTICIPANT_LIST_SLOT]),
  );
  const stored = BigInt((await client.getStorageAt({ address, slot: lengthSlot })) ?? "0x0");
  if (stored !== count) {
    throw new Error(`participant list length ${stored} does not match participantCount ${count}`);
  }
  const base = BigInt(keccak256(lengthSlot));
  const words = await Promise.all(
    Array.from({ length: Number(count) }, (_, i) =>
      client.getStorageAt({ address, slot: toHex(base + BigInt(i), { size: 32 }) }),
    ),
  );
  return words.map((word) => getAddress(`0x${(word ?? "0x").slice(-40).padStart(40, "0")}`));
}

export async function fetchParticipants(id: bigint): Promise<Address[]> {
  const address = getHealthPoolsAddress();
  if (address === null) throw new ContractNotConfiguredError();
  return readParticipants(getArcPublicClient(), address, id);
}

export async function fetchParticipant(
  id: bigint,
  user: Address,
): Promise<ParticipantInfo> {
  const address = getHealthPoolsAddress();
  if (address === null) throw new ContractNotConfiguredError();
  const client = getArcPublicClient();
  const p = await client.readContract({
    address,
    abi: healthPoolsAbi,
    functionName: "getParticipant",
    args: [id, user],
  });
  return {
    joined: p.joined,
    resultRecorded: p.resultRecorded,
    verdict: p.verdict,
    refunded: p.refunded,
    multiplierBps: p.multiplierBps,
  };
}

/**
 * Ask the contract for the goal id of a (pool, participant) pair. The agent
 * run route keys its ledger by this id and re-derives it server-side, so the
 * browser must read it from the same source of truth, never re-derive it.
 */
export async function fetchGoalId(id: bigint, user: Address): Promise<Hex> {
  const address = getHealthPoolsAddress();
  if (address === null) throw new ContractNotConfiguredError();
  const client = getArcPublicClient();
  return client.readContract({
    address,
    abi: healthPoolsAbi,
    functionName: "computeGoalId",
    args: [id, user],
  });
}

// Minimal read view of the HealthVerdict registry: getVerdict returns the
// recorded verdict struct, of which only the public `verified` bool and facet
// `bitmap` are read here to derive the display trust tier. No health-derived
// content is stored on chain or read here.
export const healthVerdictReadAbi = [
  {
    type: "function",
    name: "getVerdict",
    stateMutability: "view",
    inputs: [{ name: "goalId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "verified", type: "bool" },
          { name: "confidence", type: "uint8" },
          { name: "digest", type: "bytes32" },
          { name: "attester", type: "address" },
          { name: "timestamp", type: "uint64" },
          { name: "bitmap", type: "uint16" },
        ],
      },
    ],
  },
] as const;

/**
 * The on-chain trust tier of a goal's recorded verdict, read from the
 * HealthVerdict facet bitmap. A passing verdict with no facet (bitmap 0) is the
 * low-trust self-reported tier; a facet set marks the verified tier. Returns
 * "unknown" when the registry address is unset or no passing verdict exists —
 * which callers MUST NOT present as verified. Reads only the public verified
 * bool + facet bitmap, never any health data.
 */
export async function fetchProofTier(goalId: Hex): Promise<ProofTier> {
  const address = getHealthVerdictAddress();
  if (address === null) return "unknown";
  const client = getArcPublicClient();
  const verdict = await client.readContract({
    address,
    abi: healthVerdictReadAbi,
    functionName: "getVerdict",
    args: [goalId],
  });
  return proofTierFromVerdict(verdict.verified, Number(verdict.bitmap));
}

// ------------------------------------------------------------------ helpers

export function formatUsdc(amount: bigint): string {
  const value = Number(formatUnits(amount, USDC_DECIMALS));
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseUsdc(input: string): bigint {
  return parseUnits(input, USDC_DECIMALS);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export const BOUNTY_MODEL_LABELS: Record<number, string> = {
  0: "Fixed bounty per achiever",
  1: "Pro-rata pot split",
  2: "Stake on yourself, hitters split the pot",
};

// -------------------------------------------------------- proof-modality policy

/**
 * Proof-modality taxonomy. A goal is proven by one of three modalities, trust-
 * ranked highest to lowest:
 *
 *   "wearable"      -> connected-device metrics (sleep, steps) read from the
 *                      Junction provider. Deterministic; the highest-trust tier.
 *   "document"      -> an uploaded record (flu shot, lab PDF) judged in the
 *                      confidential TEE attester. Verified tier.
 *   "self-reported" -> a photo, screenshot, or video the participant uploads.
 *                      LOW TRUST and still in development: we cannot confirm the
 *                      image is real, recent, or theirs. It is NEVER "verified".
 *
 * The policy for a pool lives ON-CHAIN in its goalSpec as an optional leading
 * marker; no contract change. Two marker conventions coexist:
 *
 *   (legacy) "[doc] ..."          -> floor document, accepts [document]
 *   "[proof=<tokens>] ..."        -> tokens are '+'-joined from
 *                                    wearable | doc | self, e.g.
 *                                    "[proof=doc+self]" or "[proof=wearable+self]"
 *   (none)                        -> floor wearable, accepts [wearable]
 *
 * The serializer only ever emits "[proof=...]" when self-reported is involved,
 * so a pure-wearable pool stays unmarked and a pure-document pool stays "[doc]"
 * exactly as before this taxonomy existed. Every pool created before it has no
 * "[proof=...]" marker and resolves to the identical policy it always had, so
 * the feature is fully backward compatible.
 */
export const DOC_GOAL_MARKER = "[doc]";

export type Modality = "wearable" | "document" | "self-reported";

/** The three modalities, for input validation. */
export const MODALITIES: readonly Modality[] = [
  "wearable",
  "document",
  "self-reported",
];

/** Kept for backward compatibility with existing callers/tests. The floor of a
 *  policy maps onto this two-value routing kind: self-reported is upload-routed
 *  like a document, so it collapses to "document" here. */
export type EvidenceType = "document" | "wearable";

/** A pool's proof policy: the lowest-trust modality it will accept as a floor,
 *  and the full accepted set. `accepted` always leads with `floor`. */
export interface ProofPolicy {
  floor: Modality;
  accepted: Modality[];
}

const PROOF_MARKER_RE = /^\s*\[proof=([a-z+]+)\]/i;

const TOKEN_TO_MODALITY: Record<string, Modality> = {
  wearable: "wearable",
  doc: "document",
  document: "document",
  self: "self-reported",
};

function dedupeModalities(items: Modality[]): Modality[] {
  return [...new Set(items)];
}

/**
 * The proof policy encoded in a goalSpec. The single source of truth for how a
 * pool may be proven. Falls back to the legacy conventions (a "[doc]" prefix,
 * or nothing) so an unmarked or "[doc]" pool behaves exactly as it always has.
 */
export function proofPolicyOf(goalSpec: string): ProofPolicy {
  const trimmed = goalSpec.trimStart();
  const marker = PROOF_MARKER_RE.exec(trimmed);
  if (marker !== null) {
    const mapped: Modality[] = [];
    for (const token of marker[1].toLowerCase().split("+")) {
      const modality = TOKEN_TO_MODALITY[token.trim()];
      if (modality !== undefined && !mapped.includes(modality)) {
        mapped.push(modality);
      }
    }
    if (mapped.length > 0) {
      // Floor is the highest-trust (first non-self) modality; a marker of only
      // "self" leaves self-reported as the floor. `accepted` leads with floor.
      const floor = mapped.find((m) => m !== "self-reported") ?? "self-reported";
      const accepted = dedupeModalities([
        floor,
        ...mapped.filter((m) => m !== floor),
      ]);
      return { floor, accepted };
    }
    // A "[proof=...]" whose tokens are all unknown is not a valid policy; fall
    // through to the legacy interpretation rather than inventing an empty set.
  }
  if (trimmed.toLowerCase().startsWith(DOC_GOAL_MARKER)) {
    return { floor: "document", accepted: ["document"] };
  }
  return { floor: "wearable", accepted: ["wearable"] };
}

/** Strip any leading proof marker ("[proof=...]" or the legacy "[doc]") for a
 *  human-readable goal. Plain goals pass through unchanged. */
function stripProofMarker(goalSpec: string): string {
  const trimmed = goalSpec.trim();
  const marker = PROOF_MARKER_RE.exec(trimmed);
  if (marker !== null) return trimmed.slice(marker[0].length).trim();
  if (trimmed.toLowerCase().startsWith(DOC_GOAL_MARKER)) {
    return trimmed.slice(DOC_GOAL_MARKER.length).trim();
  }
  return trimmed;
}

/**
 * Decide how a goal is verified from its goalSpec string. UNCHANGED contract:
 * returns "document" or "wearable" only. A self-reported floor is upload-routed,
 * so it maps to "document" here (the upload surface), which is what keeps every
 * existing evidenceTypeOf caller working without knowing about the new tier.
 */
export function evidenceTypeOf(goalSpec: string): EvidenceType {
  return proofPolicyOf(goalSpec).floor === "wearable" ? "wearable" : "document";
}

/**
 * Serialize a proof policy back into a goalSpec marker. Emits a "[proof=...]"
 * marker ONLY when self-reported is in the accepted set; a pure-document policy
 * serializes to "[doc]" and a pure-wearable policy to no marker at all, so
 * existing create paths produce byte-identical goalSpecs. Supersedes
 * withDocMarker for callers that need the self-reported tier.
 */
export function withProofPolicy(goalSpec: string, policy: ProofPolicy): string {
  const clean = stripProofMarker(goalSpec);
  if (!policy.accepted.includes("self-reported")) {
    return policy.floor === "document" ? `${DOC_GOAL_MARKER} ${clean}` : clean;
  }
  const marker =
    policy.floor === "self-reported"
      ? "[proof=self]"
      : policy.floor === "document"
        ? "[proof=doc+self]"
        : "[proof=wearable+self]";
  return `${marker} ${clean}`;
}

/** Prefix a goalSpec with the legacy document marker, avoiding duplicate
 *  markers. Retained for callers not touching the self-reported tier; produces
 *  the identical "[doc] ..." string it always did. */
export function withDocMarker(goalSpec: string): string {
  const trimmed = goalSpec.trim();
  return evidenceTypeOf(trimmed) === "document"
    ? trimmed
    : `${DOC_GOAL_MARKER} ${trimmed}`;
}

/** Strip the proof marker for human-readable display. */
export function displayGoalSpec(goalSpec: string): string {
  return stripProofMarker(goalSpec);
}

/**
 * Resolve which modality a claim runs under, enforcing the pool's accepted set.
 * The caller may request a specific modality (the hybrid opt-in surfaces do);
 * absent a request, the pool's floor is used. A request outside the accepted
 * set is refused here, server-side, so a modality the pool does not accept can
 * never reach the run loop. Pure function so the enforcement is unit-testable
 * without the route harness.
 */
export function claimModalityFor(
  policy: ProofPolicy,
  requested: string | undefined,
):
  | { ok: true; modality: Modality }
  | { ok: false; reason: "invalid" | "not-accepted" } {
  if (requested === undefined) return { ok: true, modality: policy.floor };
  if (!MODALITIES.includes(requested as Modality)) {
    return { ok: false, reason: "invalid" };
  }
  const modality = requested as Modality;
  if (!policy.accepted.includes(modality)) {
    return { ok: false, reason: "not-accepted" };
  }
  return { ok: true, modality };
}

/** FundsSwept is what sweep() emits when the leftover USDC actually leaves the
 *  contract for the creator. The sweep hook asserts on it, never on tx success. */
export const FUNDS_SWEPT_ABI = [
  {
    type: "event",
    name: "FundsSwept",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * The entry-fee refunds still owed on a cancelled pool, in 6-decimal base
 * units. Zero on any pool that was never cancelled (the contract only sets it
 * in cancelPool).
 */
export async function fetchRefundLiability(id: bigint): Promise<bigint> {
  const address = getHealthPoolsAddress();
  if (address === null) throw new ContractNotConfiguredError();
  const client = getArcPublicClient();
  return client.readContract({
    address,
    abi: healthPoolsAbi,
    functionName: "refundLiability",
    args: [id],
  });
}

/** Every participant's on-chain result for one pool, read after it closes so
 *  the settled screen can say what actually happened instead of guessing. */
export async function fetchParticipantResults(
  id: bigint,
): Promise<ParticipantInfo[]> {
  const addresses = await fetchParticipants(id);
  return Promise.all(addresses.map((user) => fetchParticipant(id, user)));
}

/** Just the RefundCredited event, for parsing receipts in isolation. */
export const REFUND_CREDITED_ABI = [
  {
    type: "event",
    name: "RefundCredited",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
