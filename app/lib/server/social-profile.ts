// Read and write GoHealthMe social profiles in Supabase.
//
// READS go through the anon client (RLS: SELECT-only). WRITES go through the
// service-role client and are only ever called after an EIP-191 signature has
// proven the caller controls the address being written - the route enforces
// that, this module assumes it.
//
// A profile is public identity ONLY: a wallet address, a handle, an optional
// avatar glyph. There is no health column anywhere in the schema, so nothing
// this module can read or write is health-revealing. On-chain stats (wins,
// USDC) are derived separately in social-stats.ts, never stored here.

import {
  getSupabaseAnon,
  getSupabaseServiceRole,
} from "@/lib/server/supabase";
import { checkEmoji, checkHandle, normalizeAddress } from "@/lib/social";
// --- ens ---
import { mintHandleNameBestEffort } from "@/lib/server/ens/claim";
// --- end ens ---

const PROFILES_TABLE = "profiles";

export interface Profile {
  address: string; // lowercased 0x hex
  handle: string; // lowercased, [a-z0-9_]{3,20}
  emoji: string | null; // avatar glyph, user data
}

interface ProfileRow {
  address: string;
  handle: string;
  emoji: string | null;
}

function rowToProfile(row: ProfileRow): Profile {
  return { address: row.address, handle: row.handle, emoji: row.emoji };
}

/** The profile store could not answer (not configured, or a query error).
 *  Distinct from "no such handle" so a real, shared profile never 404s
 *  during an outage. */
export class ProfileLookupError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ProfileLookupError";
  }
}

/**
 * The profile that claimed a handle, or null when the handle is unclaimed.
 * Throws ProfileLookupError when the store cannot answer: null must only ever
 * mean "nobody owns this handle", because the page turns it into a 404.
 */
export async function getProfileByHandle(
  rawHandle: string,
): Promise<Profile | null> {
  const check = checkHandle(rawHandle);
  if (!check.ok) return null;
  const supabase = getSupabaseAnon();
  if (supabase === null) {
    throw new ProfileLookupError("profile store is not configured on this deployment");
  }

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .select("address, handle, emoji")
    .eq("handle", check.handle)
    .maybeSingle<ProfileRow>();

  if (error !== null) throw new ProfileLookupError("profile lookup failed", error);
  if (data === null) return null;
  return rowToProfile(data);
}

/** The profile a wallet claimed, or null when it has none. */
export async function getProfileByAddress(
  rawAddress: string,
): Promise<Profile | null> {
  const address = normalizeAddress(rawAddress);
  if (address === null) return null;
  const supabase = getSupabaseAnon();
  if (supabase === null) return null;

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .select("address, handle, emoji")
    .eq("address", address)
    .maybeSingle<ProfileRow>();

  if (error !== null || data === null) return null;
  return rowToProfile(data);
}

// A batch resolve caps its input so one request cannot ask the database for an
// unbounded IN list. Callers (the display-name hook, the named feed) never need
// more than a page of names at once.
export const RESOLVE_MAX = 100;

/**
 * Map a batch of addresses to the profiles that claimed them. Unknown or
 * malformed addresses are simply absent from the returned map; the caller
 * falls back to a truncated address for those. Keys are lowercased addresses.
 */
export async function resolveProfiles(
  rawAddresses: string[],
): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();

  const addresses = Array.from(
    new Set(
      rawAddresses
        .map((a) => normalizeAddress(a))
        .filter((a): a is string => a !== null),
    ),
  ).slice(0, RESOLVE_MAX);

  if (addresses.length === 0) return out;
  const supabase = getSupabaseAnon();
  if (supabase === null) return out;

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .select("address, handle, emoji")
    .in("address", addresses);

  if (error !== null || data === null) return out;
  for (const row of data as ProfileRow[]) {
    out.set(row.address, rowToProfile(row));
  }
  return out;
}

export type ClaimResult =
  | { ok: true; profile: Profile }
  | { ok: false; status: number; reason: string };

/**
 * Claim (or re-claim) a handle for a wallet. The caller MUST already have
 * proven control of `rawAddress` with a wallet signature - this function does
 * not check that; it trusts its route.
 *
 * Upsert is keyed by address, so a wallet setting a new handle replaces its old
 * one and frees the old handle. A handle already held by a DIFFERENT wallet
 * trips the unique(handle) constraint and comes back as a taken-handle
 * conflict rather than a generic error.
 */
export async function claimHandle(params: {
  rawAddress: string;
  rawHandle: string;
  rawEmoji: string | null | undefined;
  /** Set by the ENS claim route, which minted the name before caching it here. */
  skipEns?: boolean;
}): Promise<ClaimResult> {
  const address = normalizeAddress(params.rawAddress);
  if (address === null) {
    return { ok: false, status: 400, reason: "That is not a valid address." };
  }
  const handleCheck = checkHandle(params.rawHandle);
  if (!handleCheck.ok) {
    return { ok: false, status: 400, reason: handleCheck.reason };
  }
  const emojiCheck = checkEmoji(params.rawEmoji);
  if (!emojiCheck.ok) {
    return { ok: false, status: 400, reason: emojiCheck.reason };
  }

  const supabase = getSupabaseServiceRole();
  if (supabase === null) {
    return {
      ok: false,
      status: 503,
      reason: "Handle claiming is not configured on this deployment.",
    };
  }

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .upsert(
      {
        address,
        handle: handleCheck.handle,
        emoji: emojiCheck.emoji,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "address" },
    )
    .select("address, handle, emoji")
    .maybeSingle<ProfileRow>();

  if (error !== null) {
    // 23505 = unique_violation. On this table it can only be the handle unique
    // index (address collisions are resolved by onConflict), so it always
    // means the handle is taken by another wallet.
    if (error.code === "23505") {
      return { ok: false, status: 409, reason: "That handle is already taken." };
    }
    return {
      ok: false,
      status: 500,
      reason: "Could not save the handle. Try again.",
    };
  }
  if (data === null) {
    return {
      ok: false,
      status: 500,
      reason: "Could not save the handle. Try again.",
    };
  }
  // --- ens ---
  // ENS is the source of truth for a participant's name; this row is its
  // cache. A handle claimed here is also minted as <handle>.gohealthme.eth on
  // ENSv2 Sepolia when it is a valid label and the owner key is configured.
  // Best effort: the profile write already succeeded, so a Sepolia problem is
  // logged loudly and never reported as a handle failure.
  if (params.skipEns !== true) {
    await mintHandleNameBestEffort(address, handleCheck.handle);
  }
  // --- end ens ---
  return { ok: true, profile: rowToProfile(data) };
}
