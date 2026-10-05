// Pairing the GoHealthMe iPhone app to a wallet, without a wallet on the phone.
//
// THE PROBLEM. Apple Health data is pushed by the phone, and what it pushes
// decides whether a pool pays. The server must know which wallet a phone
// speaks for. The V3 app proved that with a wallet signature made by a
// hard-coded public test key, so every phone posted as the same address and no
// real player could ever sync their own days.
//
// WHY NOT A WALLET ON THE PHONE. Players sign in on the web with whatever
// wallet they already use: MetaMask, Coinbase Smart Wallet, a Dynamic embedded
// wallet. An embedded wallet in the phone app would only match the web address
// for the last kind, and everyone else would pair a phone to an address that
// is not theirs. The web session already proves who the player is, so the web
// vouches for the phone instead.
//
// THE FLOW.
//   1. The player, signed in on the web, starts the Apple link. The link route
//      has already verified their wallet signature, and mints a pairing code
//      here: short, single use, ten minutes.
//   2. The player types the code into the phone app, or opens its deep link.
//   3. The phone redeems it for a device token, a long random bearer secret
//      kept in the iPhone Keychain. Only its hash is stored here.
//   4. Every sync carries the device token, and the server writes under the
//      address the token was issued for, never an address the phone names.
//
// ONE PHONE PER WALLET. Pairing again revokes the previous device token, so a
// lost or replaced phone is cut off by pairing the new one.
//
// PROVIDER CHOICE IS NOT MADE HERE. Redeeming a code switches nothing: a
// wallet with a working Junction or WHOOP link keeps it until the phone has
// actually delivered data. The first sync that stores a row after a pairing
// records Apple as the wallet's provider, once. Later syncs only store days,
// so a player who pairs Apple and then picks WHOOP on the web is not flipped
// back to Apple by the next background sync.

import { createHash, randomBytes, randomInt } from "crypto";
import { getAddress, isAddress, type Address } from "viem";

import {
  deleteKey,
  getNx,
  readJson,
  setNx,
  writeJson,
} from "@/lib/server/store";

/** Long enough to find the phone and open the app, short enough to not matter. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * No 0/O, 1/I/L: the code is read off one screen and typed on another.
 * 31 symbols, 8 characters: about 8.5e11 codes, against a ten minute life and
 * the per-IP rate limit on /api/wearable/*.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

/** The phone app's URL scheme, from mobile/app.json. */
const DEEP_LINK_BASE = "gohealthme://pair";

export interface PairingCode {
  /** Displayed as XXXX-XXXX; accepted with or without the dash. */
  code: string;
  /** Opens the phone app with the code filled in. */
  deepLink: string;
  expiresAt: number;
}

interface DeviceRecord {
  address: Address;
  pairedAt: number;
  /** Set once the first sync after pairing has stored data. */
  confirmed: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codeKey(code: string): string {
  return `apple-pair:${sha256(code)}`;
}

function deviceKey(token: string): string {
  return `apple-device:${sha256(token)}`;
}

function currentDeviceKey(address: string): string {
  return `apple-device-for:${address.toLowerCase()}`;
}

/** Upper-case and strip separators, so "abcd-efgh" and "ABCDEFGH" match. */
export function normalizePairingCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return code;
}

function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Mint a pairing code for a wallet the caller has ALREADY authenticated.
 * Never call this with an address taken from a request body unchecked.
 */
export async function mintPairingCode(
  address: string,
  now: number = Date.now(),
): Promise<PairingCode> {
  if (!isAddress(address, { strict: false })) {
    throw new Error("mintPairingCode: invalid address");
  }
  const owner = getAddress(address.toLowerCase());

  // A collision with a live code is astronomically unlikely, but setNx makes
  // it impossible rather than unlikely: a second wallet can never overwrite
  // the first wallet's pending code.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    const created = await setNx(codeKey(code), owner, PAIRING_CODE_TTL_MS);
    if (!created) continue;
    const shown = formatCode(code);
    return {
      code: shown,
      deepLink: `${DEEP_LINK_BASE}?code=${encodeURIComponent(shown)}`,
      expiresAt: now + PAIRING_CODE_TTL_MS,
    };
  }
  throw new Error("Could not mint a pairing code");
}

export type RedeemResult =
  | { ok: true; deviceToken: string; address: Address }
  | { ok: false; reason: "invalid" };

/**
 * Exchange a pairing code for a device token. Single use: of two phones racing
 * the same code, exactly one wins. Every failure is the same "invalid", because
 * telling a guesser whether a code was expired, used or never existed only
 * helps the guesser.
 */
export async function redeemPairingCode(input: string): Promise<RedeemResult> {
  const code = normalizePairingCode(input);
  if (code === null) return { ok: false, reason: "invalid" };

  const stored = await getNx(codeKey(code));
  if (stored === null || !isAddress(stored, { strict: false })) return { ok: false, reason: "invalid" };

  const claimed = await setNx(`${codeKey(code)}:used`, "1", PAIRING_CODE_TTL_MS);
  if (!claimed) return { ok: false, reason: "invalid" };
  await deleteKey(codeKey(code));

  const address = getAddress(stored);
  const deviceToken = randomBytes(32).toString("base64url");

  // Revoke the phone this wallet paired before, if any.
  const previous = await readJson<{ tokenHash?: unknown } | null>(
    currentDeviceKey(address),
    null,
  );
  if (typeof previous?.tokenHash === "string") {
    await deleteKey(`apple-device:${previous.tokenHash}`);
  }

  const record: DeviceRecord = { address, pairedAt: Date.now(), confirmed: false };
  await writeJson(deviceKey(deviceToken), record);
  await writeJson(currentDeviceKey(address), { tokenHash: sha256(deviceToken) });

  return { ok: true, deviceToken, address };
}

export interface PairedDevice {
  address: Address;
  confirmed: boolean;
}

/** The wallet a device token speaks for, or null when it is unknown or revoked. */
export async function deviceForToken(token: string): Promise<PairedDevice | null> {
  if (token.length < 32 || token.length > 128) return null;
  const record = await readJson<DeviceRecord | null>(deviceKey(token), null);
  if (record === null || typeof record.address !== "string" || !isAddress(record.address)) {
    return null;
  }
  // The per-wallet pointer is the source of truth for which phone is current.
  // Checking it too means a revoked record resurrected by a write racing a
  // re-pair still cannot authenticate.
  const current = await readJson<{ tokenHash?: unknown } | null>(
    currentDeviceKey(record.address),
    null,
  );
  if (current?.tokenHash !== sha256(token)) return null;
  return { address: getAddress(record.address), confirmed: record.confirmed === true };
}

/** Mark a device's first delivery, so later syncs never re-record the provider. */
export async function confirmDevice(token: string): Promise<void> {
  const record = await readJson<DeviceRecord | null>(deviceKey(token), null);
  if (record === null) return;
  await writeJson(deviceKey(token), { ...record, confirmed: true });
}

/** The device token carried as `Authorization: Bearer <token>`, or null. */
export function readDeviceToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match === null ? null : match[1];
}
