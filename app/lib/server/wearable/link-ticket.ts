// A short-lived, wallet-bound ticket that survives a top-level redirect.
//
// THE PROBLEM. Linking WHOOP is an OAuth redirect: the browser navigates away
// to WHOOP and comes back to our callback. A navigation cannot carry the
// x-gohealthme-* signature headers that lib/server/wallet-auth.ts uses, so the
// login route has no way to check the caller controls the address it is about
// to bind a WHOOP account to.
//
// WHY THAT MATTERS. Without a check, anyone could start the flow naming
// somebody else's wallet and attach their own WHOOP account to it. That is not
// a harmless prank: it overwrites the victim's real connection, so their own
// device stops backing their claims, and it points a stranger's sleep data at
// a wallet that gets paid. The Junction link route never needed this because
// Junction only ever creates an empty user record; a WHOOP grant is a live
// credential.
//
// THE FIX. /api/wearable/link verifies a signature the normal way, then mints
// a ticket naming that address. The browser carries the ticket through the
// redirect, and /api/whoop/login accepts nothing else.
//
// STATELESS ON PURPOSE. The ticket is an HMAC over the address and an expiry -
// no store, no cleanup, nothing to leak. wallet-auth.ts already documents why
// this app does not keep a nonce ledger: a replay window this short is bounded
// by the same header theft that would defeat the signature itself, and shared
// state on a hot path buys little against an attacker who can already read the
// victim's requests.
//
// The signing key is derived from WEARABLE_TOKEN_KEY rather than adding a
// second secret to configure, and derived rather than reused so a ticket can
// never be mistaken for, or used as, token-encryption material.

import { createHmac, timingSafeEqual } from "crypto";
import { isAddress } from "viem";

/** Long enough to finish a WHOOP consent screen, short enough to not matter. */
const TICKET_TTL_MS = 10 * 60 * 1000;

const KEY_LABEL = "wearable-link-ticket-v1";

function signingKey(): Buffer {
  const raw = process.env.WEARABLE_TOKEN_KEY;
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "Missing required env var WEARABLE_TOKEN_KEY. It is needed to sign " +
        "wearable link tickets. Generate one with: openssl rand -base64 32",
    );
  }
  const value = raw.trim();
  const master = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  return createHmac("sha256", master).update(KEY_LABEL).digest();
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string): string {
  return base64url(createHmac("sha256", signingKey()).update(payload).digest());
}

/** Mint a ticket that proves `address` was authenticated just now. */
export function mintLinkTicket(address: string): string {
  const payload = base64url(
    JSON.stringify({
      a: address.toLowerCase(),
      e: Date.now() + TICKET_TTL_MS,
    }),
  );
  return `${payload}.${sign(payload)}`;
}

/**
 * The address a ticket vouches for, or null when it is malformed, tampered
 * with, or expired. Never throws: the login route turns null into one plain
 * "start again from the dashboard" message, and telling an attacker which of
 * the three it was helps only them.
 */
export function readLinkTicket(ticket: string): string | null {
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = fromBase64url(sign(payload));
    provided = fromBase64url(signature);
  } catch {
    return null;
  }
  // Length must match before timingSafeEqual, which throws on a mismatch.
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(fromBase64url(payload).toString("utf8")) as {
      a?: unknown;
      e?: unknown;
    };
    if (typeof decoded.a !== "string" || !isAddress(decoded.a)) return null;
    if (typeof decoded.e !== "number" || decoded.e <= Date.now()) return null;
    return decoded.a;
  } catch {
    return null;
  }
}
