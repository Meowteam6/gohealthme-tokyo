// The sweep's per-pool miss-phase record, in the shared store (Redis in prod,
// JSON files locally).
//
// One record per pool, written only by the settlement sweep, which is single
// flight (its own lock), so a read-modify-write here never races another
// writer. The run loop and the settle paths only READ it:
//
//   evaluated  every participant the miss phase has judged after the grace,
//              with the basis ("miss", or why nothing was recorded)
//   done       every participant is judged: the pool may settle now
//   closed     the pool settled (or was cancelled, or can never record a
//              miss) and every recorded miss has its closing ledger row;
//              the sweep never looks at this pool again
//
// A missing record reads as "nothing judged yet", which holds a
// miss-eligible pool until its hold deadline: the safe direction.

import { readJson, writeJson } from "@/lib/server/store";

export interface MissPoolRecord {
  evaluated: Record<string, string>;
  done: boolean;
  closed: boolean;
}

function missPoolKey(poolId: bigint): string {
  return `agent-miss-pool-${poolId.toString()}.json`;
}

export async function readMissPool(poolId: bigint): Promise<MissPoolRecord> {
  const stored = await readJson<Partial<MissPoolRecord> | null>(
    missPoolKey(poolId),
    null,
  );
  return {
    evaluated:
      stored?.evaluated !== undefined && typeof stored.evaluated === "object"
        ? { ...stored.evaluated }
        : {},
    done: stored?.done === true,
    closed: stored?.closed === true,
  };
}

export async function writeMissPool(
  poolId: bigint,
  record: MissPoolRecord,
): Promise<void> {
  await writeJson(missPoolKey(poolId), record);
}

/** The settle paths' question: has the miss phase judged every player? A
 *  store failure answers no, which holds the pool rather than settling it
 *  under a miss that was never judged. */
export async function missPhaseDone(poolId: bigint): Promise<boolean> {
  try {
    return (await readMissPool(poolId)).done;
  } catch (err) {
    console.error(
      `[miss] could not read the miss phase for pool ${poolId}; holding settlement: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}
