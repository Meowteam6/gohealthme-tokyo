// The pre-launch kill switches, as every surface reads them (Andre,
// 2026-09-30: "env flags so prod can turn the World ID gate and Base staking
// off or on without a code change, and the UI says so plainly when one is
// off"). The server reads the env (lib/server/kill-switches.ts) and GET
// /api/switches hands the answer to the browser; this module is the shared,
// client-safe half: the shape, the parser, the state the join decides on, and
// the words a player reads. Pure and node-tested.
//
// A switch that is TRUE is thrown: that thing is OFF for now.
//
// What the money-in switch pauses: new stakes (joinPool), new challenges and
// public challenges (createPool), chipping in (fundPool) and the test USDC
// faucet. What it never pauses: anything that moves money a player already
// has in (SPOTTER's payouts, the settlement sweep, withdraw, refund, the
// creator's leftover sweep, gas for those). See docs/WORLD.md "Kill switches".

export interface Switches {
  /** True while World ID is switched off (KILL_WORLD_ID). */
  worldId: boolean;
  /** True while new money into Base is switched off (KILL_BASE_MONEY_IN). */
  baseMoneyIn: boolean;
  /** The operator's plain-text note for players (KILL_REASON), or null. */
  reason: string | null;
}

/** Longest KILL_REASON a player is shown. */
export const KILL_REASON_MAX = 200;

/**
 * An operator note fit for a player's screen: control characters and line
 * breaks become spaces, runs of whitespace collapse, the ends are trimmed and
 * the length is capped. Rendered as text by React, never as markup. Empty is
 * null.
 */
export function cleanKillReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, KILL_REASON_MAX)
    .trim();
  return text === "" ? null : text;
}

function recordOf(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

/** `GET /api/switches` -> Switches, or null when the answer is unusable. */
export function parseSwitches(payload: unknown): Switches | null {
  const body = recordOf(payload);
  if (typeof body.worldId !== "boolean" || typeof body.baseMoneyIn !== "boolean") {
    return null;
  }
  return {
    worldId: body.worldId,
    baseMoneyIn: body.baseMoneyIn,
    reason: cleanKillReason(body.reason),
  };
}

/**
 * Whether new money may go in, as the join and the create forms decide on it.
 * Same rule as every other join check (lib/game/join-checks.ts): a read that
 * has not answered holds ("loading"), one that failed locks behind a retry
 * ("error"). Neither is ever "open".
 */
export type MoneyInState = "open" | "paused" | "loading" | "error";

export function moneyInStateOf(q: {
  data: Switches | undefined;
  isError: boolean;
}): MoneyInState {
  if (q.data !== undefined) return q.data.baseMoneyIn ? "paused" : "open";
  return q.isError ? "error" : "loading";
}

/** Append the operator's note, when there is one, as its own sentence. */
export function withKillReason(line: string, reason: string | null): string {
  return reason === null ? line : `${line} ${reason}`;
}

export const MONEY_IN_PAUSED_TITLE = "New stakes are paused for now";

/** The promise every paused surface makes about money already in. */
export const MONEY_ALREADY_IN_LINE = "Money already in still pays out and refunds as normal.";

/** The whole line a paused surface shows, reason last. */
export function moneyInPausedDetail(reason: string | null): string {
  return withKillReason(`New stakes are paused for now. ${MONEY_ALREADY_IN_LINE}`, reason);
}

/** A new challenge while new money is paused (the create forms and the
 *  create preflight at /api/challenges/health). */
export function challengeCreatePausedDetail(reason: string | null, charged: "has been" | "was"): string {
  return withKillReason(
    `New stakes are paused for now, so no new challenge can start. ${MONEY_ALREADY_IN_LINE} Nothing ${charged} charged.`,
    reason,
  );
}

/** Adding to a pot while new money is paused (chip in, top up). */
export function addToPotPausedDetail(reason: string | null): string {
  return withKillReason(
    `Adding to the pot is paused for now, along with new stakes. ${MONEY_ALREADY_IN_LINE} Nothing has been charged.`,
    reason,
  );
}

/** Character creation's step 2 while World ID is switched off. */
export function worldPausedLine(reason: string | null): string {
  return withKillReason("World ID is paused for now, so the list is the way in.", reason);
}
