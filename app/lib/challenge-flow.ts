// The one challenge flow (Andre, 2026-09-27), as pure steps with the wallet
// and the network injected, so every branch is unit-testable.
//
// THE GAME. A challenge is equal stakes on the same goal. I stake S, my
// friend matches S. One hits and one misses: the hitter gets their S back plus
// the other S. Both hit: both get S back. Nobody hits: every stake comes back.
// Anyone can add extra to the pot; it is split evenly among whoever hits, and
// if nobody hits it goes to whoever started the challenge (the contract's
// sweep). On chain that is a commitment pool, HealthPoolsV3 bountyModel 2,
// entryFee S, initialFunding E (the creator's optional extra, default 0).
//
// THE ORDER, and the rules it keeps:
//   1. PREFLIGHT BEFORE MONEY. /api/challenges/health must say the invite
//      store can take the row the share links depend on, before the create is
//      offered. An unready build refuses with nothing charged.
//   2. CREATE. createPool(S, E). Only E is pulled here; a throw means nothing
//      moved, and the flow says so.
//   3. THE CREATOR JOINS ON THE CHALLENGE PAGE. The creator's own S is pulled
//      by joinPool on /pools/<id>, behind the same join gate every stake goes
//      through (lib/wearable-join-gate.ts). This flow never joins by itself.
//   4. THE FRIEND'S NAME, if one was given, is written once the pool exists
//      (POST /api/challenges), so the challenge lands under their "Invited to
//      you". A refused invite never undoes the challenge: the Match my stake
//      link on the challenge page still reaches them.

import type { Hex } from "viem";
import { parseUsdc } from "@/lib/contract";
import { checkTargetHandle, normalizeTargetHandle } from "@/lib/challenges";
import { launchGoalIssue } from "@/lib/launch-goal-check";

/** The initiative every challenge pool carries; the lobby and the challenge
 *  pages tell a challenge from a public group challenge by it. */
export const CHALLENGE_INITIATIVE = "challenge";
/** Commitment pools only: a stake that goes anywhere goes to a player who hit
 *  their own goal, never to the creator. */
export const CHALLENGE_BOUNTY_MODEL = 2;

const SECONDS_PER_DAY = 86_400n;

export type HealthCheck = { ok: true } | { ok: false; message: string };

export type MintResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

export const HEALTH_UNREACHABLE_MESSAGE =
  "Could not confirm challenges are live right now. Nothing was charged. Try again in a moment.";

const INVITE_FAILED_MESSAGE = "Could not save the invite.";

// ------------------------------------------------------------------ the form

/** What the create form reads, before any money moves. */
export interface ChallengeForm {
  /** A launch goal, trimmed (lib/launch-goal-check). */
  goal: string;
  /** S: every player's stake, in uUSDC. Above zero. */
  stake: bigint;
  /** E: the creator's extra in the pot at create, in uUSDC. Zero or more. */
  extra: bigint;
  /** The friend's handle, canonical (no @, lowercase), or null. */
  targetHandle: string | null;
}

export type ChallengeFormRead = { ok: true; form: ChallengeForm } | { ok: false; reason: string };

const STAKE_REASON =
  "Put up a stake above zero. It is your own money on the line, and your friend matches it.";
const EXTRA_REASON = "Add the extra as a number of USDC, or leave it at 0.";

/** A USDC amount the player typed, or null when it is not one. */
function usdcOf(raw: string): bigint | null {
  try {
    return parseUsdc(raw.trim());
  } catch {
    return null;
  }
}

/** Read the create form into a challenge, or the one reason it cannot be. */
export function readChallengeForm(input: {
  goal: string;
  stake: string;
  extra: string;
  friend: string;
}): ChallengeFormRead {
  const goal = input.goal.trim();
  if (goal === "") {
    return { ok: false, reason: 'Pick your goal, for example "Sleep at least 7 hours for 1 night".' };
  }
  const issue = launchGoalIssue(goal);
  if (issue !== null) return { ok: false, reason: issue };

  const stake = input.stake.trim() === "" ? null : usdcOf(input.stake);
  if (stake === null || stake <= 0n) return { ok: false, reason: STAKE_REASON };

  const extra = input.extra.trim() === "" ? 0n : usdcOf(input.extra);
  if (extra === null || extra < 0n) return { ok: false, reason: EXTRA_REASON };

  const target = checkTargetHandle(normalizeTargetHandle(input.friend));
  if (!target.ok) return { ok: false, reason: target.reason };

  return { ok: true, form: { goal, stake, extra, targetHandle: target.targetHandle } };
}

// ------------------------------------------------------------ the create call

export interface ChallengeCreateCall {
  functionName: "createPool";
  args: readonly [string, string, bigint, bigint, bigint, number, bigint];
}

/**
 * The createPool call for a challenge: a commitment pool with entryFee S and
 * initialFunding E, running from now for the chosen days. `deposit` is what
 * the wallet sends at create: E alone, never S (joinPool pulls S).
 */
export function challengeCreateCall(input: {
  goal: string;
  stake: bigint;
  extra: bigint;
  durationDays: number;
  nowSeconds: bigint;
}): { deposit: bigint; call: ChallengeCreateCall } {
  const periodEnd = input.nowSeconds + BigInt(input.durationDays) * SECONDS_PER_DAY;
  return {
    deposit: input.extra,
    call: {
      functionName: "createPool",
      args: [
        CHALLENGE_INITIATIVE,
        input.goal,
        input.stake,
        input.nowSeconds,
        periodEnd,
        CHALLENGE_BOUNTY_MODEL,
        input.extra,
      ],
    },
  };
}

// ------------------------------------------------------------------ the flow

export interface ChallengeFlowSteps {
  checkHealth(): Promise<HealthCheck>;
  /** Approve (when E > 0) + createPool. Resolves to the tx hash once the pool
   *  exists; throws when nothing moved. */
  deposit(amount: bigint, call: ChallengeCreateCall): Promise<Hex>;
  resolvePoolId(depositHash: Hex): Promise<bigint>;
  /** Write the invite row naming the friend. Signed; never needed for the
   *  challenge itself. */
  mintInvite(poolId: bigint, targetHandle: string): Promise<MintResult>;
}

export type ChallengeInvite =
  | { kind: "none" }
  | { kind: "sent"; targetHandle: string }
  | { kind: "failed"; targetHandle: string; message: string };

export type ChallengeFlowResult =
  | { kind: "unavailable"; message: string }
  | { kind: "depositFailed" }
  /** The pool exists (and any extra is in it) but its id did not read yet. */
  | { kind: "unresolved"; depositHash: Hex }
  | {
      kind: "created";
      poolId: bigint;
      /** Where the creator stakes S: the challenge page's join, gated. */
      joinHref: string;
      stake: bigint;
      extra: bigint;
      invite: ChallengeInvite;
    };

/** Run the create from the top: preflight, createPool, the pool id, the
 *  friend's invite. Never joins: the creator stakes on the challenge page. */
export async function runChallengeFlow(
  steps: ChallengeFlowSteps,
  input: { form: ChallengeForm; durationDays: number; nowSeconds: bigint },
): Promise<ChallengeFlowResult> {
  const { form } = input;

  let health: HealthCheck;
  try {
    health = await steps.checkHealth();
  } catch {
    return { kind: "unavailable", message: HEALTH_UNREACHABLE_MESSAGE };
  }
  if (!health.ok) return { kind: "unavailable", message: health.message };

  const { deposit, call } = challengeCreateCall({
    goal: form.goal,
    stake: form.stake,
    extra: form.extra,
    durationDays: input.durationDays,
    nowSeconds: input.nowSeconds,
  });
  let depositHash: Hex;
  try {
    depositHash = await steps.deposit(deposit, call);
  } catch {
    return { kind: "depositFailed" };
  }

  let poolId: bigint;
  try {
    poolId = await steps.resolvePoolId(depositHash);
  } catch {
    return { kind: "unresolved", depositHash };
  }

  let invite: ChallengeInvite = { kind: "none" };
  if (form.targetHandle !== null) {
    const targetHandle = form.targetHandle;
    try {
      const minted = await steps.mintInvite(poolId, targetHandle);
      invite = minted.ok
        ? { kind: "sent", targetHandle }
        : { kind: "failed", targetHandle, message: minted.message };
    } catch {
      invite = { kind: "failed", targetHandle, message: INVITE_FAILED_MESSAGE };
    }
  }

  return {
    kind: "created",
    poolId,
    joinHref: `/pools/${poolId.toString()}`,
    stake: form.stake,
    extra: form.extra,
    invite,
  };
}

/**
 * Read /api/challenges/health. Any non-ok answer carries the server's player
 * copy; a network failure throws so runChallengeFlow reports it as
 * unreachable.
 */
export async function fetchChallengesHealth(
  fetchImpl: typeof fetch = fetch,
): Promise<HealthCheck> {
  const response = await fetchImpl("/api/challenges/health", {
    cache: "no-store",
  });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  return {
    ok: false,
    message:
      typeof body.error === "string" && body.error !== ""
        ? body.error
        : HEALTH_UNREACHABLE_MESSAGE,
  };
}
