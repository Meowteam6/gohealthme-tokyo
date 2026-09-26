// Framework-free rules for the peer-challenge layer (invite tokens, the
// challenger's framing message, the optional target label). Kept apart from any
// Supabase or React import so every rule here is unit-testable under vitest's
// node environment and shared verbatim by the create form, the signed write
// route, and the token-gated landing.
//
// The shapes mirror the Supabase schema exactly (table public.challenges,
// committed in supabase/migrations/20260926095900_challenges.sql; V3's copy lives in
// project lynhrbkspjsmqzywfhht):
//   contract_address   text  check ~ '^0x[0-9a-f]{40}$'  (half of the key)
//   invite_token       text  check ~ '^[A-Za-z0-9_-]{32,64}$'  (URL-safe)
//   pool_id            bigint check > 0
//   challenger_address text  check ~ '^0x[0-9a-f]{40}$'  (lowercased hex)
//   target_handle      text  nullable, char_length <= 40
//   message            text  nullable, char_length <= 280
// The database enforces all of these as CHECK constraints; these functions keep
// a bad value from ever reaching it and give the UI a reason string to show.
//
// HARD RULE: nothing here ever carries a health category. The goal lives
// on-chain in the pool goalSpec and is read live from the chain by the landing.
// message is the challenger's own framing text; target_handle is a display
// label the challenger typed. Neither is a copy of the goal.

import { proofPolicyOf } from "@/lib/contract";
import { launchGoalIssue } from "@/lib/launch-goal-check";

// ---------------------------------------------------------------- invite token

/** URL-safe base64url alphabet, 32-64 chars. Must match the DB CHECK exactly. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

/** Bytes of entropy per generated token. 24 bytes -> 32 base64url chars, which
 *  is 192 bits of entropy: unguessable, and inside the 32-64 char CHECK. */
export const INVITE_TOKEN_BYTES = 24;

export const TARGET_HANDLE_MAX = 40;
export const MESSAGE_MAX = 280;

/**
 * Encode raw bytes as URL-safe base64 with no padding, so the result is drawn
 * from exactly the [A-Za-z0-9_-] alphabet the token CHECK allows. Takes the
 * bytes as an argument (rather than reaching for a global) so it is pure and
 * testable; the caller supplies crypto-random bytes.
 */
export function base64UrlNoPad(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa is available in the browser, Node (>=16) and the edge runtime.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A fresh, unguessable invite token from crypto-random bytes. Server-only in
 * practice (the write route mints it), but pure enough to unit-test: pass a
 * deterministic randomBytes in tests, the live crypto in production.
 */
export function generateInviteToken(
  randomBytes: (n: number) => Uint8Array = cryptoRandomBytes,
): string {
  return base64UrlNoPad(randomBytes(INVITE_TOKEN_BYTES));
}

/** crypto.getRandomValues wrapper. Present in the browser, Node and the edge. */
function cryptoRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Whether a string is a well-formed invite token. The landing and the read
 *  route both call this before touching the database, so a malformed token
 *  never becomes a query. */
export function isValidInviteToken(raw: string): boolean {
  return INVITE_TOKEN_PATTERN.test(raw);
}

// ------------------------------------------------------------ challenger text

export type MessageCheck =
  | { ok: true; message: string | null }
  | { ok: false; reason: string };

/**
 * Normalize the optional framing message. Returns null for an absent or blank
 * value (the column is nullable) and rejects anything over the column length.
 * The message is user data rendered as-is, never interpreted, so no
 * character-class rule is applied beyond the length the schema allows.
 */
export function checkMessage(raw: string | null | undefined): MessageCheck {
  if (raw === null || raw === undefined) return { ok: true, message: null };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, message: null };
  // Count Unicode code points, matching Postgres char_length semantics rather
  // than JS UTF-16 units, so a multi-codepoint glyph is measured the same way
  // the CHECK constraint measures it.
  if ([...trimmed].length > MESSAGE_MAX) {
    return { ok: false, reason: `Keep the message under ${MESSAGE_MAX} characters.` };
  }
  return { ok: true, message: trimmed };
}

/**
 * Canonicalize a target handle the same way on both sides of the invite:
 * strip a leading @ (people type it), lowercase, trim. The create form stores
 * this canonical form and getChallengesForTargetHandle matches on it, so the
 * recipient's own claimed handle (already lowercase [a-z0-9_]) lines up exactly
 * with what the challenger aimed at. Blank stays blank.
 */
export function normalizeTargetHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").trim().toLowerCase();
}

export type TargetHandleCheck =
  | { ok: true; targetHandle: string | null }
  | { ok: false; reason: string };

/**
 * Normalize the optional target label (a name or handle the challenger typed to
 * remember who the challenge is for). Landing-only, and shown minimally; kept
 * loose on purpose (it is not the strict social handle) but bounded so it
 * cannot smuggle in arbitrary text.
 */
export function checkTargetHandle(
  raw: string | null | undefined,
): TargetHandleCheck {
  if (raw === null || raw === undefined) return { ok: true, targetHandle: null };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, targetHandle: null };
  if ([...trimmed].length > TARGET_HANDLE_MAX) {
    return {
      ok: false,
      reason: `Keep the name under ${TARGET_HANDLE_MAX} characters.`,
    };
  }
  return { ok: true, targetHandle: trimmed };
}

/** The share URL for a token, given an origin (e.g. window.location.origin).
 *  One place so the reveal card and any future surface build it identically. */
export function challengeShareUrl(origin: string, inviteToken: string): string {
  return `${origin.replace(/\/+$/, "")}/c/${inviteToken}`;
}

/** The query flag that marks the rally (backer) variant of a dare link. */
export const BACKER_PARAM = "as";
export const BACKER_VALUE = "backer";

/** The rally link friends are sent from the landing. Same token, but the page
 *  leads with "chip in" and hides accept, so a backer is never staked into
 *  the dare as a player. */
export function challengeBackerUrl(origin: string, inviteToken: string): string {
  return `${challengeShareUrl(origin, inviteToken)}?${BACKER_PARAM}=${BACKER_VALUE}`;
}

/** Whether a /c/[token] request is the backer variant. */
export function isBackerView(raw: string | string[] | undefined): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === BACKER_VALUE;
}

// ---------------------------------------------------------------- dare money

export interface DarePotInput {
  /** pool.balance: the seed reward + every fundPool top-up + every stake. */
  balance: bigint;
  entryFee: bigint;
  /** Accepted players, or null when the count could not be read. */
  participantCount: number | null;
  settled: boolean;
  cancelled: boolean;
  /** Sum of fundPool top-ups (PoolFunded), or null when not read. */
  contributed?: bigint | null;
}

export interface DarePot {
  /** What a winner collects on top of their own stake back: balance minus
   *  every player's stake. null when it cannot be stated honestly. */
  prize: bigint | null;
  /** The players' own money in the pool. */
  stakes: bigint | null;
  /** The challenger's own seed reward: prize minus friends' top-ups. */
  seed: bigint | null;
}

const clampZero = (v: bigint): bigint => (v < 0n ? 0n : v);

/**
 * Split a dare pool's balance into what is actually a reward and what is the
 * players' own stake. pool.balance counts both (joinPool adds the entry fee),
 * so showing it as "Reward" credits the challenger with the dared player's own
 * lock-in. Once a pool is settled or cancelled its balance tracks payouts and
 * refunds, not the reward, so every figure is null and the caller shows state
 * instead of a number.
 */
export function darePot(input: DarePotInput): DarePot {
  if (input.settled || input.cancelled || input.participantCount === null) {
    return { prize: null, stakes: null, seed: null };
  }
  const stakes = input.entryFee * BigInt(input.participantCount);
  const prize = clampZero(input.balance - stakes);
  const contributed = input.contributed ?? null;
  const seed = contributed === null ? null : clampZero(prize - contributed);
  return { prize, stakes, seed };
}

// ------------------------------------------------------------ wearable goals

/**
 * Why a goal cannot be a challenge, or null when it can. Every challenge is a
 * wearable run on a launch goal (lib/provider-capabilities LAUNCH_METRICS), so
 * whoever accepts can be checked by their own wearable. A proof marker
 * (document or photo) is refused: document proof is not offered for
 * challenges yet. The refusal is the same launch-goal sentence the create
 * forms show, so the server and the form never word it differently.
 */
export function challengeGoalIssue(goalSpec: string): string | null {
  if (proofPolicyOf(goalSpec).floor !== "wearable") return launchGoalIssue("");
  return launchGoalIssue(goalSpec);
}

/** What stops a live challenge from taking money on this build, or null.
 *  "checker": the goal needs the document checker and it is off. "payouts": a
 *  verified win could not pay. A wearable challenge never waits on the
 *  document checker. */
export function challengePauseReason(input: {
  goalSpec: string;
  documentCheckerAvailable: boolean;
  payoutsMisconfigured: boolean;
}): "checker" | "payouts" | null {
  if (
    proofPolicyOf(input.goalSpec).floor !== "wearable" &&
    !input.documentCheckerAvailable
  ) {
    return "checker";
  }
  return input.payoutsMisconfigured ? "payouts" : null;
}
