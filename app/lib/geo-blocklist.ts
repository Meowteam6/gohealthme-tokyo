// Geo-exclusion for the self-staked real-money pilot.
//
// WHY THIS EXISTS
// The pilot runs a self-staked commitment pool (participants stake their own
// USDC on hitting their own goal; achievers split the forfeited stakes). That
// is the DietBet/HealthyWage "commitment device" lane, which is defensible as a
// skill contest rather than gambling — but a handful of US states restrict even
// skill contests, or bar contests that require an entry stake ("consideration")
// at all. Until counsel confirms otherwise, the pilot must not admit residents
// of those states. The full analysis and the source list live in the pilot
// compliance brief; this module is the code the gate consults.
//
// SCOPE / HONEST LIMITATION
// This is the guard, not the gate. Nothing yet COLLECTS a participant's state,
// so importing this alone does not block anyone. The closed-beta access gate
// (to be ported from the arbiterpay `feat/family-access-gate` branch) is what
// must call `stateBlockReason` before granting access and refuse on a non-null
// reason. This module is dependency-free and safe to import from a client
// component so the gate UI can tell the truth about why a state is excluded.
//
// The list is drawn from comparable paid-entry skill platforms (Skillz,
// WorldWinner) and states barring consideration in skill contests. It is a
// conservative default for a 5-10 person pilot and is NOT legal advice — counsel
// confirms the final list before real USDC moves.

/** Why a state is on the list. Drives the message the gate shows. */
export type BlockCategory = "skill-staking" | "consideration";

/**
 * The 14 US states excluded from the self-staked pilot, keyed by USPS code.
 *   - skill-staking: restricts paid-entry skill contests (Skillz/WorldWinner
 *     exclusion set).
 *   - consideration: bars contests that require an entry stake outright.
 * Frozen so a caller cannot mutate the policy at runtime.
 */
export const BLOCKED_STATES: Readonly<Record<string, BlockCategory>> = Object.freeze({
  AZ: "skill-staking",
  AR: "skill-staking",
  CT: "skill-staking",
  DE: "skill-staking",
  LA: "skill-staking",
  MT: "skill-staking",
  SC: "skill-staking",
  SD: "skill-staking",
  TN: "skill-staking",
  CO: "consideration",
  MD: "consideration",
  NE: "consideration",
  ND: "consideration",
  VT: "consideration",
});

/**
 * Full names of the blocked states, so the guard resolves "Colorado" as well as
 * "CO". Only the blocked states need names: for a blocklist, any input that does
 * not resolve to a blocked code is simply allowed, so unlisted states never need
 * to be recognised.
 */
const BLOCKED_NAME_TO_CODE: Readonly<Record<string, string>> = Object.freeze({
  arizona: "AZ",
  arkansas: "AR",
  connecticut: "CT",
  delaware: "DE",
  louisiana: "LA",
  montana: "MT",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  colorado: "CO",
  maryland: "MD",
  nebraska: "NE",
  "north dakota": "ND",
  vermont: "VT",
});

/**
 * Resolve a US state code or full name to an uppercase USPS code.
 *
 * A two-letter input is taken as a code verbatim (upper-cased); anything else is
 * matched against the blocked-state names. Returns null when the input is empty
 * or is a non-code string we do not recognise. Because this backs a blocklist,
 * an unrecognised full name (e.g. a misspelling, or an allowed state we did not
 * map) resolves to null and is therefore treated as allowed — a fail-open the
 * gate must account for by collecting a canonical code from a fixed list, not
 * free text.
 */
export function normalizeStateCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return BLOCKED_NAME_TO_CODE[trimmed.toLowerCase()] ?? null;
}

/** True when the given state (code or name) is excluded from the pilot. */
export function isStateBlocked(input: string | null | undefined): boolean {
  const code = normalizeStateCode(input);
  return code != null && Object.prototype.hasOwnProperty.call(BLOCKED_STATES, code);
}

/**
 * null when the state may join the pilot; a human-readable reason when it is
 * excluded. The gate refuses on any non-null return and shows the reason.
 */
export function stateBlockReason(input: string | null | undefined): string | null {
  const code = normalizeStateCode(input);
  if (code == null || !Object.prototype.hasOwnProperty.call(BLOCKED_STATES, code)) {
    return null;
  }
  return BLOCKED_STATES[code] === "skill-staking"
    ? "The self-staked pilot is not yet available in your state, which restricts paid skill contests."
    : "The self-staked pilot is not yet available in your state, which restricts contests that require an entry stake.";
}
