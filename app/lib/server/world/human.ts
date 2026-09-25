// The human <-> wallet binding: one human, one wallet; one wallet, one human.
//
// STORAGE (lib/server/store.ts primitives only), per namespace <ns>
// ("mock", "live-staging", "live-production"; see config.ts):
//
//   world:<ns>:nullifier:<nullifierHash>.json   { address }   the human's wallet
//   world:<ns>:human:<addr>.json                HumanRecord   the wallet's human
//
// A record in one namespace never answers a read in another. That is the
// whole point: a preview and production can share one KV, and a mock identity
// typed on the preview must never count as a real human on production.
//
// LEGACY keys (world:nullifier:..., world:human:..., written before the
// namespaces existed) are still honoured so nobody already verified is sent
// back through the step, but only where they can have come from: a legacy
// record with mode "mock" belongs to "mock", one with mode "live" to
// "live-staging" (production never ran World before the split). The
// "live-production" namespace never reads a legacy key.
//
// Every bind runs under ONE named lock (store.withLock, SET NX PX in Redis
// and a process-local map in the file fallback), so the read-check-write
// below cannot interleave with another bind: two verifications racing for
// the same wallet, or the same human on two wallets, resolve to exactly one
// winner. ZADD NX and SADD were considered and rejected because a set takes
// a second member without complaint, and SET NX has no portable read of the
// holder; the lock is the store's own answer for "these two writes move
// together" (see applyCounterDelta).
//
// The reverse index (nullifier -> wallet) is written FIRST because it is the
// uniqueness guard: a crash between the two writes leaves a human pointing at
// a wallet with no record, which no other wallet can claim, and the next
// verification by that wallet finds itself as the holder and writes the
// record. The reverse order would open a window in which one human could
// bind two wallets.
//
// WHAT IS STORED: the wallet address, the nullifier, a timestamp, the mode
// the proof was checked in, the protocol version and which World credential
// verified (Orb, passport, Selfie Check, ...). No name, no email, no
// health data, nothing from Junction. The nullifier is World's own per-app
// pseudonym for the human; it identifies nobody outside this app.

import { getAddress, isAddress } from "viem";
import { readJson, withLock, writeJson } from "@/lib/server/store";
import {
  namespaceFor,
  worldEnvironment,
  worldNamespace,
  type WorldMode,
  type WorldNamespace,
} from "@/lib/server/world/config";
import type { ProtocolVersion } from "@/lib/server/world/payload";
import type { WorldCredential } from "@/lib/world/credentials";

export interface HumanRecord {
  /** Checksummed wallet address. */
  address: string;
  /** Canonical 0x hex nullifier (see nullifier.ts). */
  nullifierHash: string;
  /** ISO-8601 of the first successful verification for this wallet. */
  verifiedAt: string;
  /** "live" means World verified it; "mock" means the event build did not. */
  mode: Exclude<WorldMode, "off">;
  protocolVersion: ProtocolVersion;
  /** The credential the latest verification used (Orb, passport, Selfie
   *  Check, ...). Absent on records written before 2026-09-26, which were all
   *  Orb-level. null when World verified an identifier this app does not
   *  know. Recorded, never used to refuse (docs/WORLD.md, "Credentials"). */
  credential?: WorldCredential | null;
}

interface NullifierRecord {
  /** Checksummed wallet address this human is bound to. */
  address: string;
  verifiedAt: string;
}

export type BindConflict = "wallet-has-other-human" | "human-has-other-wallet";

export type BindResult =
  | { ok: true; record: HumanRecord; created: boolean }
  | {
      ok: false;
      status: 409;
      conflict: BindConflict;
      reason: string;
      /** The wallet this human is already bound to (human-has-other-wallet). */
      otherWallet?: string;
    };

export interface HumanStatusView {
  human: "verified" | "unverified";
  verifiedAt?: string;
  /** The credential the record was proven with, when known. */
  credential?: WorldCredential | null;
  /** The mode the RECORD was proven in (not the deployment's), so a mocked
   *  verification is always labelled as mocked. */
  proofMode?: Exclude<WorldMode, "off">;
}

/** One lock for every bind. A bind is a handful of small reads and writes,
 *  so serialising all of them costs nothing a user can feel. */
const BIND_LOCK = "world-bind";
const BIND_LOCK_TTL_MS = 5_000;

function nullifierKey(ns: WorldNamespace, nullifierHash: string): string {
  return `world:${ns}:nullifier:${nullifierHash}.json`;
}
function recordKey(ns: WorldNamespace, lowerAddress: string): string {
  return `world:${ns}:human:${lowerAddress}.json`;
}
function legacyNullifierKey(nullifierHash: string): string {
  return `world:nullifier:${nullifierHash}.json`;
}
function legacyRecordKey(lowerAddress: string): string {
  return `world:human:${lowerAddress}.json`;
}

/** The namespace a legacy record belongs to (see the header). */
function legacyNamespaceOf(mode: unknown): WorldNamespace | null {
  if (mode === "mock") return "mock";
  if (mode === "live") return "live-staging";
  return null;
}

/** The wallet's record in `ns`, falling back to a legacy record that belongs
 *  to `ns`. */
async function readRecord(
  ns: WorldNamespace,
  lower: string,
): Promise<HumanRecord | null> {
  const current = await readJson<HumanRecord | null>(recordKey(ns, lower), null);
  if (current !== null || ns === "live-production") return current;
  const legacy = await readJson<HumanRecord | null>(legacyRecordKey(lower), null);
  if (legacy === null || legacyNamespaceOf(legacy.mode) !== ns) return null;
  return legacy;
}

/** The nullifier holder in `ns`, falling back to a legacy holder whose own
 *  record belongs to `ns`. A legacy holder with no record (a crash between the
 *  two writes) is honoured in both pre-split namespaces, so the uniqueness
 *  guard never opens a gap. */
async function readHolder(
  ns: WorldNamespace,
  nullifierHash: string,
): Promise<NullifierRecord | null> {
  const current = await readJson<NullifierRecord | null>(
    nullifierKey(ns, nullifierHash),
    null,
  );
  if (current !== null || ns === "live-production") return current;
  const legacy = await readJson<NullifierRecord | null>(
    legacyNullifierKey(nullifierHash),
    null,
  );
  if (legacy === null || typeof legacy.address !== "string") return null;
  const legacyRecord = await readJson<HumanRecord | null>(
    legacyRecordKey(legacy.address.toLowerCase()),
    null,
  );
  if (legacyRecord === null) return legacy;
  return legacyNamespaceOf(legacyRecord.mode) === ns ? legacy : null;
}

/** The namespace a read uses: the caller's, else this deployment's. */
function resolveNamespace(ns: WorldNamespace | undefined): WorldNamespace | null {
  return ns ?? worldNamespace();
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** The wallet a nullifier is bound to, checksummed, or null. */
export async function walletForHuman(
  nullifierHash: string,
  namespace?: WorldNamespace,
): Promise<string | null> {
  const ns = resolveNamespace(namespace);
  if (ns === null) return null;
  const holder = await readHolder(ns, nullifierHash);
  return holder === null ? null : getAddress(holder.address);
}

export async function bindHuman(params: {
  address: string;
  nullifierHash: string;
  mode: Exclude<WorldMode, "off">;
  protocolVersion: ProtocolVersion;
  /** The credential that verified; stored on the record. */
  credential?: WorldCredential | null;
  /** Defaults to the mode's namespace in this deployment's World environment. */
  namespace?: WorldNamespace;
  now?: () => number;
}): Promise<BindResult> {
  const now = params.now ?? Date.now;
  const address = getAddress(params.address);
  const lower = address.toLowerCase();
  const { nullifierHash } = params;
  const ns = params.namespace ?? namespaceFor(params.mode, worldEnvironment());
  if ((ns === "mock") !== (params.mode === "mock")) {
    // A mock proof can never be written where live reads, or the reverse.
    throw new Error(`bindHuman: mode ${params.mode} cannot bind in namespace ${ns}`);
  }

  return withLock(BIND_LOCK, BIND_LOCK_TTL_MS, async (): Promise<BindResult> => {
    const existing = await readRecord(ns, lower);
    if (existing !== null && existing.nullifierHash !== nullifierHash) {
      return {
        ok: false,
        status: 409,
        conflict: "wallet-has-other-human",
        reason:
          "This wallet already belongs to a different person. One human, one wallet: sign in with a wallet of your own, or use the one you verified with.",
      };
    }

    const holder = await readHolder(ns, nullifierHash);
    if (holder !== null && holder.address.toLowerCase() !== lower) {
      const otherWallet = getAddress(holder.address);
      return {
        ok: false,
        status: 409,
        conflict: "human-has-other-wallet",
        otherWallet,
        reason: `You already proved you're one human with wallet ${shortAddress(otherWallet)}. Sign in with that wallet to keep playing. One human, one entry.`,
      };
    }

    if (existing !== null) {
      // Same human, same wallet: a re-verification. Only the credential can
      // move (a Selfie Check player who later visits an Orb, say); keep the
      // record's credential current so the feed shows the latest one.
      if (
        params.credential !== undefined &&
        existing.credential !== params.credential
      ) {
        const updated: HumanRecord = { ...existing, credential: params.credential };
        await writeJson(recordKey(ns, lower), updated);
        return { ok: true, record: updated, created: false };
      }
      return { ok: true, record: existing, created: false };
    }

    const verifiedAt = new Date(now()).toISOString();
    // Uniqueness guard first (see the header for why).
    if (holder === null) {
      await writeJson<NullifierRecord>(nullifierKey(ns, nullifierHash), {
        address,
        verifiedAt,
      });
    }
    const record: HumanRecord = {
      address,
      nullifierHash,
      verifiedAt: holder?.verifiedAt ?? verifiedAt,
      mode: params.mode,
      protocolVersion: params.protocolVersion,
      ...(params.credential === undefined ? {} : { credential: params.credential }),
    };
    await writeJson(recordKey(ns, lower), record);
    return { ok: true, record, created: true };
  });
}

/** The wallet's human record in `namespace` (default: this deployment's).
 *  Null when prove-human is off, the address is not one, or nothing is bound. */
export async function getHumanRecord(
  address: string,
  namespace?: WorldNamespace,
): Promise<HumanRecord | null> {
  if (!isAddress(address)) return null;
  const ns = resolveNamespace(namespace);
  if (ns === null) return null;
  return readRecord(ns, address.toLowerCase());
}

/** True when this wallet is bound to a human in this deployment's namespace. */
export async function isVerifiedHuman(
  address: string,
  namespace?: WorldNamespace,
): Promise<boolean> {
  return (await getHumanRecord(address, namespace)) !== null;
}

export async function humanStatus(
  address: string,
  namespace?: WorldNamespace,
): Promise<HumanStatusView> {
  const record = await getHumanRecord(address, namespace);
  if (record === null) return { human: "unverified" };
  return {
    human: "verified",
    verifiedAt: record.verifiedAt,
    proofMode: record.mode,
    ...(record.credential === undefined ? {} : { credential: record.credential }),
  };
}
