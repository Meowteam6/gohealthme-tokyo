// Encrypted, per-wallet OAuth token storage.
//
// The Junction integration never needed this: Junction holds the user mapping
// and we hold one API key. A direct provider integration inverts that - WHOOP
// hands us an access token and a refresh token per user, and those tokens ARE
// the user's health data as far as an attacker is concerned. Two rules follow.
//
// ONE RECORD PER WALLET, NOT ONE BLOB.
// The first version of this (recovered from the pre-Junction tree) kept every
// user's tokens in a single JSON document and did read-modify-write on it.
// lib/server/store.ts documents at length why that shape loses writes on
// serverless: two functions read the same document and the second write erases
// the first. Losing a token record silently disconnects a user mid-pool. Each
// wallet gets its own key so writes never contend.
//
// ENCRYPTED AT REST.
// Redis is a managed third party and a refresh token is long-lived, so tokens
// are sealed with AES-256-GCM under WEARABLE_TOKEN_KEY before they are
// written. GCM is authenticated: a tampered record fails to open rather than
// decrypting to something attacker-chosen. The key is required whenever a
// direct provider is configured - there is deliberately no plaintext fallback,
// because a fallback is what turns "we forgot to set the key in prod" into
// "we stored everyone's health credentials in the clear".
//
// ROTATION IS SERIALISED.
// WHOOP rotates the refresh token on every refresh and invalidates the old
// access token as it does. Two concurrent refreshes therefore race: one wins,
// and the loser has just spent a refresh token that is now dead, which
// disconnects the user for no reason. Every read-refresh-write runs under a
// per-address lock, which store.ts provides.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { deleteKey, readJson, withLock, writeJson } from "@/lib/server/store";
import type { ProviderId } from "@/lib/server/wearable/types";

/** OAuth material for one wallet at one provider. */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix ms at which the access token expires. */
  expiresAt: number;
  /** Scopes actually granted, space separated, as the provider reported them. */
  scope: string;
  /** Unix ms the record was written, for support and staleness reporting. */
  updatedAt: number;
}

/** The sealed form written to the store. Version tag allows key rotation. */
interface SealedRecord {
  v: 1;
  /** base64 initialisation vector. */
  iv: string;
  /** base64 ciphertext. */
  ct: string;
  /** base64 GCM authentication tag. */
  tag: string;
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * How long one refresh may hold a wallet's token lock.
 *
 * Must exceed the upstream request timeout it is protecting, with margin. It
 * was 15s, exactly equal to the WHOOP timeout: a refresh that took the full
 * budget lost the lock at the instant it was writing, so a second caller could
 * acquire it and spend the same rotating refresh token. That is the precise
 * race this lock exists to prevent, and the TTL made it reachable.
 */
const REFRESH_LOCK_TTL_MS = 45_000;
/** How long a caller waits for that lock before failing loudly. */
const REFRESH_LOCK_WAIT_MS = 50_000;

function storeKey(provider: ProviderId, address: string): string {
  return `wearable-tokens:${provider}:${address.toLowerCase()}`;
}

function lockName(provider: ProviderId, address: string): string {
  return `wearable-tokens:${provider}:${address.toLowerCase()}`;
}

/**
 * The 32-byte record key. Accepts base64 or hex so operators can paste
 * whatever `openssl rand` gave them, and rejects anything that is not exactly
 * 32 bytes rather than silently padding a short key into a weak one.
 */
function recordKey(): Buffer {
  const raw = process.env.WEARABLE_TOKEN_KEY;
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "Missing required env var WEARABLE_TOKEN_KEY. A direct wearable " +
        "provider stores per-user OAuth tokens, which must be encrypted at " +
        "rest. Generate one with: openssl rand -base64 32",
    );
  }
  const value = raw.trim();
  const decoded = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `WEARABLE_TOKEN_KEY must decode to exactly ${KEY_BYTES} bytes, got ` +
        `${decoded.length}. Generate one with: openssl rand -base64 32`,
    );
  }
  return decoded;
}

/** True when token storage is usable. Lets callers report a clear reason. */
export function tokenStorageConfigured(): boolean {
  try {
    recordKey();
    return true;
  } catch {
    return false;
  }
}

function seal(tokens: StoredTokens): SealedRecord {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, recordKey(), iv);
  const ct = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function open(record: SealedRecord): StoredTokens {
  const decipher = createDecipheriv(
    ALGORITHM,
    recordKey(),
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(record.ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plain) as StoredTokens;
}

function isSealed(value: unknown): value is SealedRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    typeof record.iv === "string" &&
    typeof record.ct === "string" &&
    typeof record.tag === "string"
  );
}

/**
 * This wallet's tokens, or null when it has never linked (or the record can no
 * longer be opened). A record that fails to open is treated as absent and
 * logged: the only honest recovery is to re-link, and refusing to answer would
 * strand the user with an error they cannot act on.
 */
export async function readTokens(
  provider: ProviderId,
  address: string,
): Promise<StoredTokens | null> {
  const stored = await readJson<unknown>(storeKey(provider, address), null);
  if (stored === null) return null;
  if (!isSealed(stored)) {
    console.error(
      `[wearable/tokens] ${provider} record for ${address.toLowerCase()} is ` +
        "not in the sealed format; treating as unlinked",
    );
    return null;
  }
  try {
    return open(stored);
  } catch (err) {
    console.error(
      `[wearable/tokens] could not open ${provider} record for ` +
        `${address.toLowerCase()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
    return null;
  }
}

/** Write this wallet's tokens, replacing whatever was there. */
export async function writeTokens(
  provider: ProviderId,
  address: string,
  tokens: Omit<StoredTokens, "updatedAt">,
): Promise<void> {
  await writeJson(
    storeKey(provider, address),
    seal({ ...tokens, updatedAt: Date.now() }),
  );
}

/** Forget this wallet's connection. Missing records are not an error. */
export async function clearTokens(
  provider: ProviderId,
  address: string,
): Promise<void> {
  await deleteKey(storeKey(provider, address));
}

/**
 * Run a read-refresh-write cycle while holding this wallet's token lock, so
 * two concurrent polls cannot both spend the same rotating refresh token.
 *
 * `fn` receives the current tokens (null when unlinked) and returns the
 * tokens to persist, or null to leave the record untouched.
 */
export async function withTokenLock<T>(
  provider: ProviderId,
  address: string,
  fn: (current: StoredTokens | null) => Promise<{
    tokens: Omit<StoredTokens, "updatedAt"> | null;
    result: T;
  }>,
): Promise<T> {
  return withLock(
    lockName(provider, address),
    REFRESH_LOCK_TTL_MS,
    async () => {
      const current = await readTokens(provider, address);
      const { tokens, result } = await fn(current);
      if (tokens !== null) await writeTokens(provider, address, tokens);
      return result;
    },
    REFRESH_LOCK_WAIT_MS,
  );
}
