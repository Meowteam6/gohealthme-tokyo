// Closed-beta access control for the family-and-friends launch.
//
// GoHealthMe is opening to a closed group: a person signs in, requests access,
// and an admin (Andre) approves or denies it at /admin. Approval is keyed on the
// WALLET ADDRESS, because that is the only identity the server can actually
// verify — an EIP-191 signature (lib/server/wallet-auth.ts) proves control of an
// address, whereas the email a user types at sign-in never reaches the server.
// The request captures a typed name / email / reason ONLY so the admin has a
// human basis for the decision; none of it is trusted as identity.
//
// STORAGE. One record per address (access:<addr-lowercased>.json), plus a
// sorted-set index (access-index.zset, scored by request time) so the admin page
// lists requests newest-first without scanning. This mirrors the claim and
// agent-ledger shapes in store.ts: per-entity keys never clobber each other under
// concurrency, and the sorted set is the time-ordered view. The whole-blob
// read-modify-write path is deliberately avoided (see store.ts:14-25).
//
// ENFORCEMENT. isAllowed() is the real server-side gate: a gated route calls it
// before doing gated work, and it fails closed. It is genuinely enforced where it
// is safe to add today (see the challenges create route). It is NOT bolted onto
// the unauthenticated money routes (balance/withdraw, unlink/payout): those are
// out of scope for this change per the deferred money-path security triage
// (CLAUDE.md "No stopgaps"). For those routes the client AccessGate is a UX gate
// until that triage lands — a flagged, tracked exception, not a silent one.
//
// GEO COMPLIANCE. requestAccess is the authoritative geo gate: it consults
// stateBlockReason (lib/geo-blocklist.ts) on the submitted US state and refuses
// the request (403) when the state is excluded from the self-staked pilot. The
// client form pre-checks the same function for a fast, honest message, but the
// server refusal is the real one — a hand-built POST from a blocked state is
// rejected here, not merely hidden in the UI. Admins bypass the geo gate.
//
// APPROVAL BY WORLD ID (ETHGlobal Tokyo 2026). When WORLD_VERIFY_MODE is set
// (lib/server/world/config.ts), a wallet that has proven it is one human
// (lib/server/world/human.ts) counts as approved, with `source: "world"`. That
// is character creation step 2 replacing the wait for Andre at /admin. The
// admin allowlist stays as the owner switch, and the stored request records
// are untouched, so unsetting the mode returns the gate to exactly the
// closed-beta behaviour above. In "mock" mode (event build, proofs mocked) this
// opens the beta to anyone who completes the mock step: deliberate for the
// hackathon deployment, never for one with the pilot's real users.
//
// WORLD PAUSED (KILL_WORLD_ID, 2026-09-30). New World proofs stop, and the
// bindings already made keep answering "approved" here, so nobody who got in
// through World is locked out by the pause. The list and the admins work as
// always.

import { getAddress, isAddress } from "viem";
import { optionalEnv } from "@/lib/server/env";
import { readJson, writeJson, zaddNx, zrevrange } from "@/lib/server/store";
import { stateBlockReason } from "@/lib/geo-blocklist";
import { boundWorldNamespace } from "@/lib/server/world/config";
import { isVerifiedHuman } from "@/lib/server/world/human";

/** "none" means no request has ever been made for this address. */
export type AccessStatus = "none" | "pending" | "approved" | "denied";

/** Why the gate answered the way it did. "world" is a proven human on a
 *  deployment with prove-human enabled; "request" is the closed-beta record. */
export type AccessSource = "admin" | "world" | "request" | "none";

export interface AccessRecord {
  /** Checksummed address the record belongs to. */
  address: string;
  status: Exclude<AccessStatus, "none">;
  /** Typed at request time, for the admin's human decision only. May be "". */
  name: string;
  email: string;
  reason: string;
  /**
   * The US state (USPS code or name) the requester declared, for the geo
   * compliance gate. May be "" for records created before the state field
   * existed, or for admins. Persisted so the decision is auditable.
   */
  state: string;
  /** ISO-8601. When the (most recent) request was made. */
  requestedAt: string;
  /** ISO-8601 of the approve/deny, or null while pending. */
  decidedAt: string | null;
  /** Checksummed admin address that decided, or null while pending. */
  decidedBy: string | null;
}

/** What the client gate needs: this address's status, and whether it is admin. */
export interface AccessStatusView {
  status: AccessStatus;
  isAdmin: boolean;
  source: AccessSource;
}

export type RequestResult =
  | { ok: true; record: AccessRecord }
  | { ok: false; status: number; reason: string };

export type DecideResult =
  | { ok: true; record: AccessRecord }
  | { ok: false; status: number; reason: string };

const INDEX_KEY = "access-index.zset";
const NAME_MAX = 80;
const EMAIL_MAX = 160;
const REASON_MAX = 500;
const STATE_MAX = 40;

function recordKey(address: string): string {
  return `access:${address.toLowerCase()}.json`;
}

function capText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/**
 * Admin addresses from ADMIN_ADDRESSES (comma- or whitespace-separated),
 * validated and checksummed. An unset or all-invalid value yields an empty list,
 * which means nobody can approve — the gate stays closed rather than open.
 */
export function adminAddresses(): string[] {
  const raw = optionalEnv("ADMIN_ADDRESSES", "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const trimmed = part.trim();
    if (trimmed === "" || !isAddress(trimmed)) continue;
    const checksummed = getAddress(trimmed);
    if (seen.has(checksummed)) continue;
    seen.add(checksummed);
    out.push(checksummed);
  }
  return out;
}

export function isAdmin(address: string | null | undefined): boolean {
  if (typeof address !== "string" || !isAddress(address)) return false;
  const checksummed = getAddress(address);
  return adminAddresses().includes(checksummed);
}

export async function getAccessRecord(
  address: string,
): Promise<AccessRecord | null> {
  if (!isAddress(address)) return null;
  return readJson<AccessRecord | null>(recordKey(address), null);
}

/**
 * True when World is configured on this deployment AND this wallet has proven
 * it is one human. False, without touching the store, when World is not
 * configured, so a deployment without World never pays for the read.
 *
 * KILL_WORLD_ID pauses NEW proofs only: a binding World already made keeps
 * counting here (boundWorldNamespace), so a World-verified player keeps their
 * gate, their challenge pages, withdraw and refund while World is switched
 * off (Andre, 2026-09-30).
 */
async function approvedByWorld(address: string): Promise<boolean> {
  const namespace = boundWorldNamespace();
  if (namespace === null) return false;
  return isVerifiedHuman(address, namespace);
}

/**
 * The gate's read: an admin always resolves to "approved", a proven human
 * resolves to "approved" when prove-human is on, everyone else to their
 * stored status ("none" when they have never asked).
 */
export async function getAccessStatus(
  address: string,
): Promise<AccessStatusView> {
  if (!isAddress(address)) return { status: "none", isAdmin: false, source: "none" };
  if (isAdmin(address)) return { status: "approved", isAdmin: true, source: "admin" };
  if (await approvedByWorld(address)) {
    return { status: "approved", isAdmin: false, source: "world" };
  }
  const record = await getAccessRecord(address);
  if (record === null) return { status: "none", isAdmin: false, source: "none" };
  return { status: record.status, isAdmin: false, source: "request" };
}

/**
 * Record (or refresh) an access request. Idempotent by design: an already
 * approved or still pending address is returned unchanged, so a double-submit or
 * a re-signed retry never resets a decision or bumps a queue position. A denied
 * or never-seen address (re)opens as pending.
 *
 * Fails closed on geo: a submitted state that stateBlockReason excludes is
 * refused with 403 BEFORE any record is written, so a blocked-state requester
 * never enters the queue. The check runs after the admin bypass (admins have no
 * state to declare) and before the idempotent existing-record path, so it cannot
 * be sidestepped by a prior record.
 */
export async function requestAccess(params: {
  address: string;
  name?: unknown;
  email?: unknown;
  reason?: unknown;
  state?: unknown;
}): Promise<RequestResult> {
  const { address } = params;
  if (!isAddress(address)) {
    return { ok: false, status: 400, reason: "address must be a 0x address" };
  }
  const checksummed = getAddress(address);

  // Admins are implicitly approved and have no request to file.
  if (isAdmin(checksummed)) {
    return {
      ok: true,
      record: {
        address: checksummed,
        status: "approved",
        name: "",
        email: "",
        reason: "",
        state: "",
        requestedAt: new Date().toISOString(),
        decidedAt: new Date().toISOString(),
        decidedBy: checksummed,
      },
    };
  }

  // Authoritative geo gate. A blocked state is refused before anything is
  // written; the client form pre-checks the same function, but this is the real
  // refusal a hand-built POST cannot talk its way past.
  const state = capText(params.state, STATE_MAX);
  const geoReason = stateBlockReason(state);
  if (geoReason !== null) {
    return { ok: false, status: 403, reason: geoReason };
  }

  const existing = await getAccessRecord(checksummed);
  if (existing !== null && existing.status !== "denied") {
    // approved or pending: leave the decision and the original request intact.
    return { ok: true, record: existing };
  }

  const record: AccessRecord = {
    address: checksummed,
    status: "pending",
    name: capText(params.name, NAME_MAX),
    email: capText(params.email, EMAIL_MAX),
    reason: capText(params.reason, REASON_MAX),
    state,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
  };
  await writeJson(recordKey(checksummed), record);
  // Idempotent by member: a re-request after denial keeps its first index score,
  // which is fine — the record's requestedAt carries the fresh time for display.
  await zaddNx(INDEX_KEY, checksummed.toLowerCase(), Date.parse(record.requestedAt));
  return { ok: true, record };
}

/** Approve or deny a request. 404 when there is nothing to decide. */
export async function decideAccess(params: {
  address: string;
  decision: "approve" | "deny";
  adminAddress: string;
}): Promise<DecideResult> {
  const { address, decision, adminAddress } = params;
  if (!isAddress(address)) {
    return { ok: false, status: 400, reason: "address must be a 0x address" };
  }
  const existing = await getAccessRecord(address);
  if (existing === null) {
    return { ok: false, status: 404, reason: "no access request for that address" };
  }
  const record: AccessRecord = {
    ...existing,
    status: decision === "approve" ? "approved" : "denied",
    decidedAt: new Date().toISOString(),
    decidedBy: isAddress(adminAddress) ? getAddress(adminAddress) : null,
  };
  await writeJson(recordKey(address), record);
  return { ok: true, record };
}

/** All requests, newest first, for the admin page. */
export async function listAccessRequests(limit = 250): Promise<AccessRecord[]> {
  const members = await zrevrange(INDEX_KEY, limit);
  const records = await Promise.all(
    members.map((m) => getAccessRecord(m.member)),
  );
  return records.filter((r): r is AccessRecord => r !== null);
}

/**
 * The real gate. True when the address may use gated features. Admins always
 * pass; a proven human passes when prove-human is on; everyone else must be
 * explicitly approved. Fails closed on anything else.
 */
export async function isAllowed(address: string | null | undefined): Promise<boolean> {
  if (typeof address !== "string" || !isAddress(address)) return false;
  // When the closed-beta gate is disabled (open demo), the SERVER enforcement is
  // off too. Otherwise the client gate opens but money-out routes (withdraw,
  // evidence, challenges) still reject every wallet, so the faucet can credit
  // the ledger but never deliver USDC on-chain. Same flag AccessGate reads, so
  // client and server agree.
  if (process.env.NEXT_PUBLIC_ACCESS_GATE_DISABLED === "1") return true;
  if (isAdmin(address)) return true;
  if (await approvedByWorld(address)) return true;
  const record = await getAccessRecord(address);
  return record?.status === "approved";
}
