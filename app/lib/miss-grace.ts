// How long after a run ends SPOTTER waits before it may record a miss.
//
// A wearable syncs late: a watch sits in a drawer, a phone app opens hours
// after waking. SPOTTER only records a miss when the wearable covered the whole
// run, so it waits this long after periodEnd for the last nights to arrive.
// The same window delays settlement of runs that can record a miss, because
// settle() refunds anyone without a recorded result (HealthPoolsV3 B-2).
//
// Client-safe on purpose: next.config.ts exposes MISS_GRACE_HOURS to the
// browser, so the run page prints the same deadline the server enforces.
//
// Clamped to 1..18 hours. The contract lets only SPOTTER settle for 24h after
// periodEnd (SETTLE_GRACE); 18h of sync grace plus the 2h miss phase keeps
// both the miss write and the settle inside that window.

export const DEFAULT_MISS_GRACE_HOURS = 6;
export const MIN_MISS_GRACE_HOURS = 1;
export const MAX_MISS_GRACE_HOURS = 18;

export interface ParsedMissGrace {
  hours: number;
  /** True when the raw value was clamped or replaced by the default. */
  adjusted: boolean;
}

/** Parse MISS_GRACE_HOURS. Blank means the default; a number outside 1..18 is
 *  clamped; anything that is not a number falls back to the default. */
export function parseMissGraceHours(raw: string | undefined): ParsedMissGrace {
  const text = raw?.trim() ?? "";
  if (text === "") return { hours: DEFAULT_MISS_GRACE_HOURS, adjusted: false };
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { hours: DEFAULT_MISS_GRACE_HOURS, adjusted: true };
  }
  const value = Number(text);
  if (value < MIN_MISS_GRACE_HOURS) return { hours: MIN_MISS_GRACE_HOURS, adjusted: true };
  if (value > MAX_MISS_GRACE_HOURS) return { hours: MAX_MISS_GRACE_HOURS, adjusted: true };
  return { hours: value, adjusted: false };
}

let warned = false;

/** The configured grace in hours. Logs once when the value was adjusted. */
export function missGraceHours(): number {
  // Literal property access, not process.env[name]: next.config.ts inlines it
  // into the browser bundle, and only a literal can be inlined.
  const raw = process.env.MISS_GRACE_HOURS;
  const parsed = parseMissGraceHours(raw);
  if (parsed.adjusted && !warned) {
    warned = true;
    console.warn(
      `[miss-grace] MISS_GRACE_HOURS=${JSON.stringify(raw)} is outside 1..18 or not a number; using ${parsed.hours}h`,
    );
  }
  return parsed.hours;
}

export function missGraceSeconds(): number {
  return Math.round(missGraceHours() * 3600);
}

/** The moment SPOTTER may first record a miss on a run, in epoch ms. */
export function missDeadlineMs(periodEndSec: bigint | number): number {
  return (Number(periodEndSec) + missGraceSeconds()) * 1000;
}

/**
 * How long, past periodEnd + grace, settlement of a miss-eligible pool waits
 * for the sweep's miss phase and for players whose wearable shows a hit to
 * confirm it. A stuck miss phase must never strand the pool: at worst the
 * unjudged are refunded.
 */
export const MISS_PHASE_MAX_S = 2 * 3600;

/**
 * The latest moment a hit on a run that can record a miss can still be
 * confirmed, in epoch ms. The run settles by then whatever happens, and a hit
 * that is not recorded at settle gets its stake back without a share.
 */
export function missConfirmByMs(periodEndSec: bigint | number): number {
  return (Number(periodEndSec) + missGraceSeconds() + MISS_PHASE_MAX_S) * 1000;
}
