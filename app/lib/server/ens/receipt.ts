// The settlement receipt: after SPOTTER settles a pool on Base Sepolia, it
// writes four text records on pool-<id>.<parent> from its own Sepolia key.
// The key holds ROLE_SET_TEXT on exactly those four resolver resources and
// nothing else, so the record is a statement only the delegated agent could
// have made, and anyone can resolve it with any ENS client.
//
// This is the ONE function the money path calls (run.ts and the sweep, each
// in a fenced block). It never throws: the payout has already happened and a
// naming failure must not look like a payment failure. Failures are logged
// loudly and left in the store so the sweep's reconciliation pass retries.
//
// Two speeds. From the money path the tx is sent and reported as "sent"
// (about a second); the sweep reconciles with `wait: true`, which asserts the
// TextUpdated logs. Reads always go through real resolution, so a "sent"
// receipt that never landed is visible as pending, never as written.

import type { Address, Hex } from "viem";
import { encodeReceipt, poolName, type SettlementReceipt } from "@/lib/ens/names";
import { optionalEnv } from "@/lib/server/env";
import { errorMessage } from "@/lib/server/http";
import {
  discoverNamespace,
  ensAgentAccount,
  ensOwnerAccount,
  ensPublicClient,
  type EnsNamespace,
} from "@/lib/server/ens/client";
import { liveResolveDeps, readPoolReceipt, type ResolveDeps } from "@/lib/server/ens/resolve";
import {
  ensurePoolName,
  liveWriteDeps,
  setTextRecords,
  type WriteDeps,
} from "@/lib/server/ens/write";
import { readJson, writeJson } from "@/lib/server/store";

export interface ReceiptInput {
  poolId: bigint;
  /** The Base Sepolia settle() transaction. */
  settleTxHash: Hex;
  /** AchieverPaid events that settle emitted. */
  achieverCount: number;
}

export type ReceiptOutcome =
  | { status: "written"; name: string; txHash: Hex }
  | { status: "sent"; name: string; txHash: Hex }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

/** What the store remembers per pool, so reconciliation can finish the job. */
export interface StoredReceipt {
  poolId: string;
  settleTxHash: Hex;
  achieverCount: number;
  settledAt: string;
  settledBy: Address;
  sepoliaTxHash: Hex | null;
  status: "sent" | "written" | "failed";
  reason?: string;
  updatedAt: string;
}

export function receiptFile(poolId: bigint): string {
  return `ens-receipt-${poolId.toString()}.json`;
}

export async function readStoredReceipt(poolId: bigint): Promise<StoredReceipt | null> {
  try {
    return await readJson<StoredReceipt | null>(receiptFile(poolId), null);
  } catch {
    return null;
  }
}

async function remember(entry: StoredReceipt): Promise<void> {
  try {
    await writeJson(receiptFile(BigInt(entry.poolId)), entry);
  } catch (err) {
    console.error(`[ens/receipt] could not store receipt state for pool ${entry.poolId}: ${errorMessage(err)}`);
  }
}

export interface ReceiptDeps {
  /** True when an agent key is configured. Answered without any network call,
   *  so a deployment (or a test) without the key never reaches Sepolia. */
  agentConfigured: () => boolean;
  agentWrite: () => Promise<WriteDeps | null>;
  ownerWrite: () => Promise<WriteDeps | null>;
  resolve: ResolveDeps;
  namespace: () => Promise<EnsNamespace | null>;
  poolsContract: () => Address | null;
  now: () => Date;
}

export function liveReceiptDeps(): ReceiptDeps {
  const client = ensPublicClient();
  const namespace = () => discoverNamespace(client);
  return {
    namespace,
    resolve: liveResolveDeps(),
    agentConfigured: () => ensAgentAccount() !== null,
    agentWrite: async () => {
      const account = ensAgentAccount();
      if (account === null) return null;
      const ns = await namespace();
      return ns === null ? null : liveWriteDeps(account, ns);
    },
    ownerWrite: async () => {
      const account = ensOwnerAccount();
      const ns = await namespace();
      return account === null || ns === null ? null : liveWriteDeps(account, ns);
    },
    poolsContract: () => {
      const raw = optionalEnv("HEALTH_POOLS_ADDRESS", optionalEnv("NEXT_PUBLIC_HEALTH_POOLS_ADDRESS", ""));
      return /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as Address) : null;
    },
    now: () => new Date(),
  };
}

/**
 * Write the receipt for a settled pool. Safe to call from the money path:
 * never throws, never blocks on Sepolia inclusion unless `wait` is true.
 */
export async function writeSettlementReceipt(
  input: ReceiptInput,
  options: { wait?: boolean } = {},
  deps: ReceiptDeps = liveReceiptDeps(),
): Promise<ReceiptOutcome> {
  const poolId = input.poolId.toString();
  try {
    if (!deps.agentConfigured()) {
      const reason = "ENS_AGENT_PRIVATE_KEY is not set, so SPOTTER has no Sepolia signer";
      console.warn(`[ens/receipt] pool ${poolId}: skipped, ${reason}`);
      return { status: "skipped", reason };
    }
    const agent = await deps.agentWrite();
    if (agent === null) {
      const reason =
        "the parent name is not bootstrapped on Sepolia (ETHRegistry has no subregistry for it)";
      console.warn(`[ens/receipt] pool ${poolId}: skipped, ${reason}`);
      return { status: "skipped", reason };
    }
    const name = poolName(input.poolId, agent.namespace.parentName);

    // Best effort, owner key: make the pool a registered name with its Base
    // address record. The receipt does not depend on it: an unregistered
    // subname still resolves through the parent's resolver, so a deployment
    // without the owner key still gets receipts.
    const pools = deps.poolsContract();
    const owner = await deps.ownerWrite();
    if (owner !== null && pools !== null) {
      try {
        await ensurePoolName(owner, { poolId: input.poolId, poolsContract: pools });
      } catch (err) {
        console.error(`[ens/receipt] pool ${poolId}: could not register ${name} (receipt continues): ${errorMessage(err)}`);
      }
    }

    const receipt: SettlementReceipt = {
      txHash: input.settleTxHash,
      settledAt: deps.now().toISOString(),
      settledBy: agent.account.address,
      achieverCount: input.achieverCount,
    };
    const stored: StoredReceipt = {
      poolId,
      settleTxHash: input.settleTxHash,
      achieverCount: input.achieverCount,
      settledAt: receipt.settledAt,
      settledBy: receipt.settledBy,
      sepoliaTxHash: null,
      status: "sent",
      updatedAt: receipt.settledAt,
    };
    try {
      const { txHash, confirmed } = await setTextRecords(agent, {
        name,
        records: encodeReceipt(receipt),
        wait: options.wait === true,
      });
      stored.sepoliaTxHash = txHash;
      stored.status = confirmed ? "written" : "sent";
      await remember(stored);
      console.log(`[ens/receipt] pool ${poolId}: ${stored.status} ${name} in ${txHash}`);
      return { status: stored.status, name, txHash };
    } catch (err) {
      const reason = errorMessage(err);
      stored.status = "failed";
      stored.reason = reason;
      await remember(stored);
      console.error(`[ens/receipt] pool ${poolId}: FAILED to write ${name}: ${reason}`);
      return { status: "failed", reason };
    }
  } catch (err) {
    const reason = errorMessage(err);
    console.error(`[ens/receipt] pool ${poolId}: FAILED before sending: ${reason}`);
    return { status: "failed", reason };
  }
}

// ---------------------------------------------------------- reconciliation

export interface ReconcileReader {
  poolCount(): Promise<bigint>;
  getPoolState(poolId: bigint): Promise<{ settled: boolean }>;
  achieverPayouts?(txHash: Hex): Promise<unknown[]>;
}

export interface ReconcileCounts {
  checked: number;
  written: number;
  pending: number;
  skipped: string[];
}

export const RECONCILE_MAX_POOLS = 25;

/**
 * Sweep pass: every settled pool whose receipt does not resolve gets it
 * written (or re-written) with inclusion asserted. A settled pool with no
 * known settle tx is skipped and named in the counts; the app never
 * fabricates a receipt it cannot cite.
 */
export async function reconcileSettlementReceipts(
  reader: ReconcileReader,
  settleTxOf: (poolId: bigint) => Promise<Hex | null>,
  outOfTime: () => boolean,
  deps: ReceiptDeps = liveReceiptDeps(),
): Promise<ReconcileCounts> {
  const counts: ReconcileCounts = { checked: 0, written: 0, pending: 0, skipped: [] };
  if (!deps.agentConfigured()) {
    counts.skipped.push("receipts not configured (ENS_AGENT_PRIVATE_KEY unset)");
    return counts;
  }
  const agent = await deps.agentWrite();
  if (agent === null) {
    counts.skipped.push("receipts not configured (parent not bootstrapped on Sepolia)");
    return counts;
  }
  const total = await reader.poolCount();
  const floor = total > BigInt(RECONCILE_MAX_POOLS) ? total - BigInt(RECONCILE_MAX_POOLS) : 0n;
  for (let poolId = total; poolId > floor; poolId--) {
    if (outOfTime()) break;
    try {
      const state = await reader.getPoolState(poolId);
      if (!state.settled) continue;
      const stored = await readStoredReceipt(poolId);
      if (stored?.status === "written") continue;
      counts.checked += 1;

      const onChain = await readPoolReceipt(poolId, deps.resolve);
      if (onChain?.receipt !== null && onChain?.receipt !== undefined) {
        if (stored !== null) await remember({ ...stored, status: "written", updatedAt: deps.now().toISOString() });
        continue;
      }

      const settleTx = stored?.settleTxHash ?? (await settleTxOf(poolId));
      if (settleTx === null) {
        counts.skipped.push(`pool ${poolId}: settled with no known settle tx`);
        continue;
      }
      let achieverCount = stored?.achieverCount;
      if (achieverCount === undefined) {
        if (reader.achieverPayouts === undefined) {
          counts.skipped.push(`pool ${poolId}: cannot count achievers`);
          continue;
        }
        achieverCount = (await reader.achieverPayouts(settleTx)).length;
      }
      const outcome = await writeSettlementReceipt(
        { poolId, settleTxHash: settleTx, achieverCount },
        { wait: true },
        deps,
      );
      if (outcome.status === "written") counts.written += 1;
      else if (outcome.status === "sent") counts.pending += 1;
      else counts.skipped.push(`pool ${poolId}: ${outcome.reason}`);
    } catch (err) {
      counts.skipped.push(`pool ${poolId}: ${errorMessage(err)}`);
    }
  }
  return counts;
}
