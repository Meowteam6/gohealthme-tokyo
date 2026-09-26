// Typed client for the GoHealthMe backend, the same Next.js API the web app
// uses. The phone does two things there: redeem a pairing code once, then post
// daily Apple Health aggregates.
//
// WHY A DEVICE TOKEN AND NOT A WALLET
//
// What lands on the server decides whether a pool pays out. Every wallet
// address is public, so the phone must prove it speaks for one. Players sign
// in on the web with whatever wallet they already use, and a wallet inside
// this app would only match theirs for one kind of wallet. So the signed-in
// web session vouches for the phone instead: it shows a one-time code, the
// phone redeems it here for a device token, and every sync carries that token.
// The server writes under the wallet the token was issued for and ignores any
// address the phone could name.

// The V4 deployment. Never the V3 pilot at www.gohealthme.app, which is frozen.
const API_BASE: string =
  process.env.EXPO_PUBLIC_API_BASE ?? "https://gohealthme-tokyo.vercel.app";

export function apiBase(): string {
  return API_BASE;
}

/** Raised when the server no longer recognises this phone's token. */
export class NotPairedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotPairedError";
  }
}

export interface Pairing {
  deviceToken: string;
  address: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof json.error === "string" && json.error !== "" ? json.error : fallback;
}

/** Exchange the code the website showed for this phone's device token. */
export async function redeemCode(code: string): Promise<Pairing> {
  const res = await fetch(`${API_BASE}/api/wearable/apple/pair/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `pairing failed (${res.status})`));
  }
  const json = (await res.json()) as { deviceToken?: unknown; address?: unknown };
  if (typeof json.deviceToken !== "string" || typeof json.address !== "string") {
    throw new Error("The server answered without a pairing. Try a new code.");
  }
  return { deviceToken: json.deviceToken, address: json.address };
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
 * Post daily aggregates for the paired wallet.
 *
 * The server validates the whole batch before storing any of it, so a
 * malformed row fails the request rather than silently dropping a day and
 * leaving a verdict to be computed from an incomplete week.
 */
export async function postAggregates(
  deviceToken: string,
  days: readonly AggregateRow[],
): Promise<SyncResult> {
  const res = await fetch(`${API_BASE}/api/wearable/apple/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({ days }),
  });

  if (res.status === 401) {
    // Revoked (the wallet paired another phone) or never valid. Only pairing
    // again fixes it, and the screen says so.
    throw new NotPairedError(await readError(res, "This iPhone is not paired."));
  }
  if (!res.ok) {
    // The backend distinguishes an unconfigured deployment from a malformed
    // batch, and the user can act on the difference, so its wording is
    // preferred over a generic message.
    throw new Error(await readError(res, `sync failed (${res.status})`));
  }
  const json = (await res.json().catch(() => ({}))) as Partial<SyncResult>;
  return { stored: typeof json.stored === "number" ? json.stored : 0 };
}
