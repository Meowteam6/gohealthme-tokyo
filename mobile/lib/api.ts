// Typed client for the GoHealthMe backend, the same Next.js API the web app
// uses. The phone posts daily Apple Health aggregates and nothing else.
//
// WHY EVERY POST IS SIGNED
//
// What lands on the server decides whether a pool pays out real money. Every
// wallet address is public: it is on chain and in the app's own participant
// lists. So without a signature anyone who knew an address could post 20,000
// steps a day for a stranger and have SPOTTER pay on it. The wallet signature
// is the entire integrity story for a provider the server cannot pull from.

import { privateKeyToAccount } from "viem/accounts";

const API_BASE: string =
  process.env.EXPO_PUBLIC_API_BASE ?? "https://www.gohealthme.app";

// Wallet-auth header names — must match lib/server/wallet-auth.ts on the backend.
const ADDRESS_HEADER = "x-gohealthme-address";
const TIMESTAMP_HEADER = "x-gohealthme-timestamp";
const SIGNATURE_HEADER = "x-gohealthme-signature";

// Standard Hardhat/Anvil account #0. Public, zero-value, DEV ONLY.
// Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
const DEFAULT_DEV_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function devSignerKey(): `0x${string}` {
  const raw = process.env.EXPO_PUBLIC_DEV_SIGNER_KEY ?? DEFAULT_DEV_KEY;
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

/** The address the DEV signer controls — the sensible default for the input. */
export function devSignerAddress(): string {
  return privateKeyToAccount(devSignerKey()).address;
}

export function apiBase(): string {
  return API_BASE;
}

/**
 * Build the three wallet-auth headers the backend requires: an EIP-191
 * signature over "GoHealthMe: prove control of <address> at <ISO timestamp>".
 *
 * DEV-ONLY SIGNER. This signs with a well-known test key so the pilot app can
 * authenticate before the embedded wallet is wired in, which means the address
 * must be the dev signer's own. In production the Dynamic embedded wallet
 * signs this exact message and this function goes away. The key is public and
 * must never hold value.
 */
async function walletAuthHeaders(
  address: string,
): Promise<Record<string, string>> {
  const account = privateKeyToAccount(devSignerKey());
  if (account.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      `This build signs as ${account.address}, so it cannot prove control of ` +
        `${address}. Use the signer's own address, or wire a real wallet.`,
    );
  }
  const timestamp = new Date().toISOString();
  const message = `GoHealthMe: prove control of ${address} at ${timestamp}`;
  const signature = await account.signMessage({ message });
  return {
    [ADDRESS_HEADER]: address,
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: signature,
  };
}

export interface SyncResult {
  /** How many day rows the server actually stored. */
  stored: number;
}

export interface AggregateRow {
  metric: string;
  /** The wearer's LOCAL calendar day, YYYY-MM-DD. */
  day: string;
  value: number;
}

/**
 * Post daily aggregates for a wallet.
 *
 * The server validates the whole batch before storing any of it, so a
 * malformed row fails the request rather than silently dropping a day and
 * leaving a verdict to be computed from an incomplete week.
 */
export async function postAggregates(
  address: string,
  days: readonly AggregateRow[],
): Promise<SyncResult> {
  const headers = await walletAuthHeaders(address);
  const res = await fetch(`${API_BASE}/api/wearable/apple/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ address, days }),
  });

  const json = (await res.json().catch(() => ({}))) as Partial<SyncResult> & {
    error?: string;
  };

  if (!res.ok) {
    // The backend distinguishes an unconfigured deployment from a rejected
    // signature from a malformed batch, and the user can act on the
    // difference, so its wording is preferred over a generic message.
    throw new Error(json.error ?? `sync failed (${res.status})`);
  }
  return { stored: typeof json.stored === "number" ? json.stored : 0 };
}
