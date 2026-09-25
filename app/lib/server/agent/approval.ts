// Human approval records: SPOTTER asks, the achiever answers, the payout
// waits. World ID for Agents, ETHGlobal Tokyo 2026.
//
// THE PROTECTED ACTION. SPOTTER's run loop (run.ts) decides "pay" and then
// records the PASS on chain, which is what makes settle() move USDC. With
// WORLD_APPROVAL_MODE set, the record write waits on a record here reaching
// "approved". Nothing else in the money path changes: the sweep only settles
// claims that carry a record row, and no record row lands without an
// approval, so an unapproved PASS can never be paid by any path. An APPROVED
// claim with no record yet (the player confirmed and closed the tab) is
// queued for the sweep here, and the sweep drives its record write, so a
// confirmed win is never refunded for want of an open browser.
//
// WHAT AN APPROVAL PROVES. That one human consented to this payout, within
// the request's window. It never proves the goal: the wearable read and
// SPOTTER's verdict do that, before this module is ever consulted. A declined
// or expired request is not a failed goal either; it is a payout the human
// did not confirm, and the honest screen says so.
//
// STATE. One record per goalId, whole-document, written under a per-goal
// lock so "one active request per goal" holds across concurrent callers
// (the browser card and SPOTTER's own run can both ask in the same second).
//
//   none ---request---> pending ---approve---> approved   (terminal, good)
//                          |-------decline---> declined   (terminal)
//                          |-------expiry----> expired    (terminal, lazy)
//                          |-------cancel----> cancelled  (pool settled first)
//   declined | expired | cancelled ---request (attempt+1)---> pending
//
// Expiry is materialized lazily by whoever reads the record next, exactly
// once, so a TTL that passes with nobody watching still produces its ledger
// row the moment anyone looks. Every transition appends one row of kind
// "approval" to SPOTTER's ledger; the receipt and the /agent feed read those
// rows, never this store.
//
// ACTION AND SIGNAL. The World action is static, `settle` (registered in the
// Developer Portal; WORLD_APPROVAL_ACTION overrides it). World ID 4.0 only
// verifies Portal-created actions, so the payout is named by the signal,
// `<goalId>:<attempt>`, and the provider checks responses[0].signal_hash
// against it: a proof for one payout can never approve another.
//
// REPLAY. With a static action a human's nullifier is the same on every
// payout, so the one-shot key is scoped to the payout:
// `agent-approval-nullifier:<action>:<goalId>:<attempt>:<nullifier>`,
// consumed once through store.setNx. The same proof twice for one payout is
// refused; the same human confirming a new payout (a later goal, or a re-ask
// after a decline or expiry) is allowed. The full nullifier stays in this
// record; only a 10-char stub reaches the ledger.

import { randomUUID } from "crypto";
import { getAddress, isAddress } from "viem";
import { readJson, setNx, withLock, writeJson } from "@/lib/server/store";
import { appendLedger } from "@/lib/server/agent/ledger";
import { addPendingSettlement } from "@/lib/server/agent/lock";
import { optionalEnv } from "@/lib/server/env";
import {
  approvalMode,
  approvalProviderFor,
  type ApprovalChallenge,
  type ApprovalProvider,
  type ApprovalProviderName,
} from "@/lib/server/agent/approval-provider";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "declined"
  | "expired"
  | "cancelled";

export interface ApprovalRecord {
  requestId: string;
  /** Lower-cased goalId; the ledger key. */
  goalId: string;
  poolId: string;
  /** Checksummed achiever address: the only wallet that may answer. */
  address: string;
  /** 1 for the first ask; every re-ask after a decline or expiry adds one. */
  attempt: number;
  /** The static World action (`settle` by default). */
  action: string;
  /** `<goalId>:<attempt>`; the payout the proof is bound to via its signal.
   *  Absent on records written before the static action; derived then. */
  signal?: string;
  provider: ApprovalProviderName;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  /** Full nullifier, approved records only. Never leaves the server. */
  nullifier?: string;
  note?: string;
}

/** 90 seconds: long enough to open World App and tap, short enough that a
 *  request nobody answers does not hold a payout open. */
export const DEFAULT_APPROVAL_TTL_S = 90;
const MIN_TTL_S = 10;
const MAX_TTL_S = 600;

export function approvalTtlMs(): number {
  const raw = Number(
    optionalEnv("WORLD_APPROVAL_TTL_S", String(DEFAULT_APPROVAL_TTL_S)),
  );
  const seconds = Number.isFinite(raw)
    ? Math.min(MAX_TTL_S, Math.max(MIN_TTL_S, Math.floor(raw)))
    : DEFAULT_APPROVAL_TTL_S;
  return seconds * 1000;
}

/** The Developer Portal action every payout confirmation is proven against. */
export const DEFAULT_APPROVAL_ACTION = "settle";

/** The static World action: WORLD_APPROVAL_ACTION, else `settle`. It must be
 *  an action registered in the Developer Portal for the configured app. */
export function approvalAction(): string {
  const raw = optionalEnv("WORLD_APPROVAL_ACTION", "").trim();
  return raw === "" ? DEFAULT_APPROVAL_ACTION : raw;
}

/** The signal that binds a proof to one payout: `<goalId>:<attempt>`. */
export function approvalSignal(goalId: string, attempt: number): string {
  return `${goalId.toLowerCase()}:${attempt}`;
}

/** The signal a record's proof must carry. */
export function recordSignal(record: ApprovalRecord): string {
  return record.signal ?? approvalSignal(record.goalId, record.attempt);
}

/** One-shot key for a nullifier, scoped to the payout (see REPLAY above). */
export function approvalNullifierKey(
  record: Pick<ApprovalRecord, "action" | "goalId" | "attempt">,
  nullifier: string,
): string {
  return `agent-approval-nullifier:${record.action}:${record.goalId.toLowerCase()}:${record.attempt}:${nullifier}`;
}

/** What the ledger shows of a nullifier: "0x" plus eight hex chars. */
export function nullifierStub(nullifier: string): string {
  return nullifier.slice(0, 10);
}

export const REQUEST_ID_RE = /^apr_[0-9a-f-]{36}$/;

function recordKey(goalId: string): string {
  return `agent-approval-${goalId.toLowerCase()}.json`;
}

function pointerKey(requestId: string): string {
  return `agent-approval-request-${requestId}.json`;
}

function lockName(goalId: string): string {
  return `agent:approval:${goalId.toLowerCase()}`;
}

const LOCK_TTL_MS = 5_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function loadRaw(goalId: string): Promise<ApprovalRecord | null> {
  return readJson<ApprovalRecord | null>(recordKey(goalId), null);
}

async function save(record: ApprovalRecord): Promise<void> {
  await writeJson(recordKey(record.goalId), record);
}

function isDue(record: ApprovalRecord, nowMs: number): boolean {
  return record.status === "pending" && Date.parse(record.expiresAt) <= nowMs;
}

/** Caller holds the lock. Flips a due pending record to expired, once. */
async function expireLocked(
  record: ApprovalRecord,
  nowMs: number,
): Promise<ApprovalRecord> {
  const expired: ApprovalRecord = {
    ...record,
    status: "expired",
    completedAt: iso(nowMs),
    note: "no confirmation before the request expired; nothing moved",
  };
  await save(expired);
  await appendLedger(record.goalId, {
    kind: "approval",
    status: "expired",
    requestId: record.requestId,
    action: record.action,
    provider: record.provider,
    expiresAtIso: record.expiresAt,
    note: expired.note,
  });
  return expired;
}

/**
 * The current record for a goal, with expiry materialized. Null when SPOTTER
 * has never asked. Safe to call from any reader: the expiry write happens
 * under the lock and is idempotent.
 */
export async function readApproval(
  goalId: string,
  nowMs: number = Date.now(),
): Promise<ApprovalRecord | null> {
  const raw = await loadRaw(goalId);
  if (raw === null || !isDue(raw, nowMs)) return raw;
  return withLock(lockName(goalId), LOCK_TTL_MS, async () => {
    const fresh = await loadRaw(goalId);
    if (fresh === null) return null;
    return isDue(fresh, nowMs) ? expireLocked(fresh, nowMs) : fresh;
  });
}

export type ApprovalLookup =
  | { kind: "current"; record: ApprovalRecord }
  /** The id was real but a newer request replaced it. */
  | { kind: "superseded"; record: ApprovalRecord }
  | { kind: "unknown" };

/** Resolve a requestId (the only thing the complete route is handed). */
export async function lookupApproval(
  requestId: string,
  nowMs: number = Date.now(),
): Promise<ApprovalLookup> {
  if (!REQUEST_ID_RE.test(requestId)) return { kind: "unknown" };
  const pointer = await readJson<{ goalId: string } | null>(
    pointerKey(requestId),
    null,
  );
  if (pointer === null) return { kind: "unknown" };
  const record = await readApproval(pointer.goalId, nowMs);
  if (record === null) return { kind: "unknown" };
  return record.requestId === requestId
    ? { kind: "current", record }
    : { kind: "superseded", record };
}

export interface RequestApprovalArgs {
  goalId: string;
  poolId: bigint | string;
  address: string;
  provider: ApprovalProvider;
  /** "spotter" when the run loop asks on its own; "human" when the achiever
   *  presses "ask again". Only the ledger note differs. */
  askedBy: "spotter" | "human";
  ttlMs?: number;
  nowMs?: number;
}

export interface RequestApprovalResult {
  record: ApprovalRecord;
  /** False when an active request already existed and was handed back. */
  created: boolean;
  challenge: ApprovalChallenge;
}

/**
 * Ask the achiever to confirm. Idempotent: a pending (unexpired) or approved
 * record is returned as-is, so SPOTTER's poll loop and the browser card can
 * both call this freely. A declined, expired or cancelled record is replaced
 * by a fresh attempt with a new signal.
 */
export async function requestApproval(
  args: RequestApprovalArgs,
): Promise<RequestApprovalResult> {
  if (!isAddress(args.address)) {
    throw new Error("requestApproval: address must be a 0x address");
  }
  const goalId = args.goalId.toLowerCase();
  const address = getAddress(args.address);
  return withLock(lockName(goalId), LOCK_TTL_MS, async () => {
    const nowMs = args.nowMs ?? Date.now();
    let current = await loadRaw(goalId);
    if (current !== null && isDue(current, nowMs)) {
      current = await expireLocked(current, nowMs);
    }

    if (current !== null && current.status === "pending") {
      const remainingS = Math.ceil((Date.parse(current.expiresAt) - nowMs) / 1000);
      const challenge = await args.provider.challenge({
        action: current.action,
        ttlSeconds: remainingS,
      });
      return { record: current, created: false, challenge };
    }
    if (current !== null && current.status === "approved") {
      return {
        record: current,
        created: false,
        challenge: {
          provider: current.provider,
          mocked: current.provider === "mock",
        },
      };
    }

    const attempt = (current?.attempt ?? 0) + 1;
    const action = approvalAction();
    const signal = approvalSignal(goalId, attempt);
    const ttlMs = args.ttlMs ?? approvalTtlMs();
    const record: ApprovalRecord = {
      requestId: `apr_${randomUUID()}`,
      goalId,
      poolId: String(args.poolId),
      address,
      attempt,
      action,
      signal,
      provider: args.provider.name,
      status: "pending",
      createdAt: iso(nowMs),
      expiresAt: iso(nowMs + ttlMs),
    };
    const challenge = await args.provider.challenge({
      action,
      ttlSeconds: Math.ceil(ttlMs / 1000),
    });
    await save(record);
    await writeJson(pointerKey(record.requestId), { goalId });
    await appendLedger(goalId, {
      kind: "approval",
      status: "requested",
      requestId: record.requestId,
      action,
      provider: record.provider,
      expiresAtIso: record.expiresAt,
      note:
        args.askedBy === "spotter"
          ? "asked you to confirm this payout with a fresh World ID check before anything moves"
          : "you asked SPOTTER to check again; a fresh request is open",
    });
    return { record, created: true, challenge };
  });
}

export type CompleteDecision =
  | { decision: "approve"; proof: unknown }
  | { decision: "decline" };

export type CompleteOutcome =
  | {
      status: "approved" | "declined" | "expired" | "cancelled";
      record: ApprovalRecord;
    }
  /** The proof did not verify. The request stays pending so the human can
   *  try again inside the window; the reason is safe to show. */
  | { status: "rejected"; reason: string; record: ApprovalRecord }
  /** A valid signer, but not the wallet this request is for. */
  | { status: "forbidden"; record: ApprovalRecord }
  | { status: "superseded"; record: ApprovalRecord }
  | { status: "unknown" };

/**
 * The human's answer. `address` must be a VERIFIED signer (wallet-auth), never
 * a value from the body. Idempotent: answering a request that already
 * finished returns its state unchanged.
 */
export async function completeApproval(args: {
  requestId: string;
  address: string;
  decision: CompleteDecision;
  provider: ApprovalProvider;
  nowMs?: number;
}): Promise<CompleteOutcome> {
  const nowMs = args.nowMs ?? Date.now();
  const found = await lookupApproval(args.requestId, nowMs);
  if (found.kind === "unknown") return { status: "unknown" };
  if (found.kind === "superseded") {
    return { status: "superseded", record: found.record };
  }
  const goalId = found.record.goalId;

  return withLock(lockName(goalId), LOCK_TTL_MS, async () => {
    let current = await loadRaw(goalId);
    if (current === null) return { status: "unknown" };
    if (current.requestId !== args.requestId) {
      return { status: "superseded", record: current };
    }
    if (!isAddress(args.address) || getAddress(args.address) !== current.address) {
      return { status: "forbidden", record: current };
    }
    if (isDue(current, nowMs)) current = await expireLocked(current, nowMs);
    if (current.status !== "pending") {
      return { status: current.status, record: current };
    }

    if (args.decision.decision === "decline") {
      const declined: ApprovalRecord = {
        ...current,
        status: "declined",
        completedAt: iso(nowMs),
        note: "you declined; nothing moved, and your stake comes back when the pool closes",
      };
      await save(declined);
      await appendLedger(goalId, {
        kind: "approval",
        status: "declined",
        requestId: current.requestId,
        action: current.action,
        provider: current.provider,
        expiresAtIso: current.expiresAt,
        note: declined.note,
      });
      return { status: "declined", record: declined };
    }

    const verified = await args.provider.verify({
      action: current.action,
      signal: recordSignal(current),
      address: current.address,
      proof: args.decision.proof,
    });
    if (!verified.ok) {
      return { status: "rejected", reason: verified.reason, record: current };
    }
    // One human, one consent, per payout. The action is static, so the key
    // carries goalId and attempt: the same proof can never approve twice,
    // while the same human may confirm a different payout.
    const first = await setNx(
      approvalNullifierKey(current, verified.nullifier),
      current.requestId,
    );
    if (!first) {
      return {
        status: "rejected",
        reason: "that proof was already used for this request",
        record: current,
      };
    }
    const approved: ApprovalRecord = {
      ...current,
      status: "approved",
      completedAt: iso(nowMs),
      nullifier: verified.nullifier,
      note: "you confirmed; SPOTTER is recording the result and will settle when the pool closes",
    };
    await save(approved);
    await appendLedger(goalId, {
      kind: "approval",
      status: "approved",
      requestId: current.requestId,
      action: current.action,
      provider: current.provider,
      expiresAtIso: current.expiresAt,
      nullifierStub: nullifierStub(verified.nullifier),
      note: approved.note,
    });
    // Queue the claim for the settlement sweep, due now. The record write
    // runs on the next browser poll, but a player who confirms and closes the
    // tab has no next poll: without this the sweep never sees the claim, the
    // pool phase settles its pool, and a confirmed win becomes a refund. The
    // sweep records approved, unrecorded claims (app/api/agent/sweep).
    await addPendingSettlement(goalId, Math.floor(nowMs / 1000));
    return { status: "approved", record: approved };
  });
}

/**
 * SPOTTER withdraws an open request, because the pool settled underneath it
 * and the payout can no longer happen. A record that is not pending is left
 * alone and returned unchanged.
 */
export async function cancelApproval(
  goalId: string,
  note: string,
  nowMs: number = Date.now(),
): Promise<ApprovalRecord | null> {
  return withLock(lockName(goalId), LOCK_TTL_MS, async () => {
    const current = await loadRaw(goalId);
    if (current === null) return null;
    if (isDue(current, nowMs)) return expireLocked(current, nowMs);
    if (current.status !== "pending") return current;
    const cancelled: ApprovalRecord = {
      ...current,
      status: "cancelled",
      completedAt: iso(nowMs),
      note,
    };
    await save(cancelled);
    await appendLedger(goalId, {
      kind: "approval",
      status: "cancelled",
      requestId: current.requestId,
      action: current.action,
      provider: current.provider,
      expiresAtIso: current.expiresAt,
      note,
    });
    return cancelled;
  });
}

// ---------------------------------------------------------------- the gate

export type GateOutcome =
  /** WORLD_APPROVAL_MODE unset: the caller proceeds exactly as before. */
  | { status: "off" }
  | { status: "approved"; record: ApprovalRecord }
  | { status: "awaiting"; record: ApprovalRecord }
  | { status: "declined" | "expired" | "cancelled"; record: ApprovalRecord }
  /** The pool settled and SPOTTER never asked: there is nothing to confirm
   *  and no payout to protect. The caller reports the claim unpayable. */
  | { status: "unpayable" };

/**
 * What run.ts calls right before the record write. Returns without touching
 * the store when the mode is off. Otherwise: an approved record lets the
 * write proceed; no record makes SPOTTER ask (one ledger row, one request);
 * anything else reports the human's answer, or the lack of one, and the
 * caller writes nothing on chain.
 *
 * A declined or expired record is NOT re-asked here. SPOTTER asks once per
 * decision; only the human, through the card's "ask again", opens a new
 * request. Otherwise every poll after a decline would nag.
 */
export async function approvalGate(args: {
  goalId: string;
  poolId: bigint;
  address: string;
  /** Whether the pool already settled; read from chain by the caller. */
  poolSettled: () => Promise<boolean>;
  nowMs?: number;
}): Promise<GateOutcome> {
  const mode = approvalMode();
  if (mode === "off") return { status: "off" };
  const provider = approvalProviderFor(mode);
  const nowMs = args.nowMs ?? Date.now();

  const current = await readApproval(args.goalId, nowMs);

  // Settled is checked BEFORE approved. An approval on a settled pool guards
  // nothing: settle() is one-shot and already refunded this claim (B-2), so
  // the record write would revert SETTLED after the player was told
  // "confirmed". The sweep records approved claims before the pool phase can
  // settle their pool, so reaching this means that race was lost.
  if (await args.poolSettled()) {
    if (current === null || current.status === "approved") return { status: "unpayable" };
    if (current.status === "pending") {
      const cancelled = await cancelApproval(
        args.goalId,
        "the pool settled before you confirmed; nothing moved, and your stake comes back with the pool's refund",
        nowMs,
      );
      // Approved in the same instant the settle landed: still unpayable.
      if (cancelled === null || cancelled.status === "approved") return { status: "unpayable" };
      return { status: cancelled.status === "pending" ? "awaiting" : cancelled.status, record: cancelled };
    }
    return { status: current.status, record: current };
  }

  if (current?.status === "approved") return { status: "approved", record: current };

  if (current === null) {
    const asked = await requestApproval({
      goalId: args.goalId,
      poolId: args.poolId,
      address: args.address,
      provider,
      askedBy: "spotter",
      nowMs,
    });
    return { status: "awaiting", record: asked.record };
  }
  if (current.status === "pending") return { status: "awaiting", record: current };
  return { status: current.status, record: current };
}
