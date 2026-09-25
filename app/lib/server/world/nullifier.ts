// Nullifier canonicalisation.
//
// World hands the nullifier back in two renderings depending on the path:
// hex in the IDKit payload (`responses[0].nullifier`) and, per the integrate
// doc, a decimal string that should be stored as NUMERIC(78,0). The store
// here is a key-value store, so one canonical string is what makes "same
// human" comparable: 0x-prefixed, lowercase, zero-padded to 32 bytes.

const HEX_RE = /^0x[0-9a-fA-F]{1,64}$/;
const DEC_RE = /^[0-9]{1,78}$/;

/** Canonical 0x + 64 lowercase hex chars, or null when the input is not a
 *  nullifier at all (wrong type, wrong shape, or zero). */
export function normalizeNullifier(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  let big: bigint;
  if (HEX_RE.test(value)) big = BigInt(value);
  else if (DEC_RE.test(value)) big = BigInt(value);
  else return null;
  if (big === 0n) return null;
  // A value wider than 32 bytes is not a field element and cannot have come
  // from World; refuse rather than truncate.
  if (big >= 1n << 256n) return null;
  return `0x${big.toString(16).padStart(64, "0")}`;
}

/** Decimal rendering of a canonical nullifier (the NUMERIC(78,0) form). */
export function nullifierToDecimal(canonical: string): string {
  return BigInt(canonical).toString(10);
}
