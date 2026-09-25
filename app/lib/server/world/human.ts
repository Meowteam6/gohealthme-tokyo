// The human <-> wallet binding: one human, one wallet; one wallet, one human.
//
// STORAGE (lib/server/store.ts primitives only):
//
//   world:nullifier:<nullifierHash>.json   { address }   the human's wallet
//   world:human:<addr>.json                HumanRecord   the wallet's human
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
// the proof was checked in and the protocol version. No name, no email, no
// health data, nothing from Junction. The nullifier is World's own per-app
// pseudonym for the human; it identifies nobody outside this app.

import { getAddress, isAddress } from "viem";
import { readJson, withLock, writeJson } from "@/lib/server/store";
import type { WorldMode } from "@/lib/server/world/config";
import type { ProtocolVersion } from "@/lib/server/world/payload";

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
}

/** One lock for every bind. A bind is a handful of small reads and writes,
 *  so serialising all of them costs nothing a user can feel. */
const BIND_LOCK = "world-bind";
const BIND_LOCK_TTL_MS = 5_000;

function nullifierKey(nullifierHash: string): string {
  return `world:nullifier:${nullifierHash}.json`;
}
function recordKey(lowerAddress: string): string {
  return `world:human:${lowerAddress}.json`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** The wallet a nullifier is bound to, checksummed, or null. */
export async function walletForHuman(
  nullifierHash: string,
): Promise<string | null> {
  const holder = await readJson<NullifierRecord | null>(
    nullifierKey(nullifierHash),
    null,
  );
  return holder === null ? null : getAddress(holder.address);
}

export async function bindHuman(params: {
  address: string;
  nullifierHash: string;
  mode: Exclude<WorldMode, "off">;
  protocolVersion: ProtocolVersion;
  now?: () => number;
}): Promise<BindResult> {
  const now = params.now ?? Date.now;
  const address = getAddress(params.address);
  const lower = address.toLowerCase();
  const { nullifierHash } = params;

  return withLock(BIND_LOCK, BIND_LOCK_TTL_MS, async (): Promise<BindResult> => {
    const existing = await readJson<HumanRecord | null>(recordKey(lower), null);
    if (existing !== null && existing.nullifierHash !== nullifierHash) {
      return {
        ok: false,
        status: 409,
        conflict: "wallet-has-other-human",
        reason:
          "This wallet already belongs to a different person. One human, one wallet: sign in with a wallet of your own, or use the one you verified with.",
      };
    }

    const holder = await readJson<NullifierRecord | null>(
      nullifierKey(nullifierHash),
      null,
    );
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
      // Same human, same wallet: a re-verification. Nothing to change.
      return { ok: true, record: existing, created: false };
    }

    const verifiedAt = new Date(now()).toISOString();
    // Uniqueness guard first (see the header for why).
    if (holder === null) {
      await writeJson<NullifierRecord>(nullifierKey(nullifierHash), {
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
    };
    await writeJson(recordKey(lower), record);
    return { ok: true, record, created: true };
  });
}

export async function getHumanRecord(
  address: string,
): Promise<HumanRecord | null> {
  if (!isAddress(address)) return null;
  return readJson<HumanRecord | null>(recordKey(address.toLowerCase()), null);
}

/** True when this wallet is bound to a human. */
export async function isVerifiedHuman(address: string): Promise<boolean> {
  return (await getHumanRecord(address)) !== null;
}

export async function humanStatus(address: string): Promise<HumanStatusView> {
  const record = await getHumanRecord(address);
  if (record === null) return { human: "unverified" };
  return { human: "verified", verifiedAt: record.verifiedAt };
}
