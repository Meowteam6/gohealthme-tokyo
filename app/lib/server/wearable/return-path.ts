// Where a WHOOP connect returns to, once WHOOP's consent screen is done.
//
// WHY THIS EXISTS. The OAuth round trip always landed on /dashboard. A player
// pairing WHOOP from character creation has not finished onboarding, so the
// access gate renders character creation on top of /dashboard, the dashboard's
// return note never mounts, and "connected", "declined" or "failed" was never
// reported at the moment it happened. The flow now carries the page it started
// on and comes back there.
//
// WHY IT IS STRICT. The value arrives in a query string and a cookie, so it is
// caller-controlled. Anything but a same-origin path would make our callback an
// open redirect: a link that bounces through a trusted domain to an attacker's.
// Only a plain absolute path on this origin is accepted; everything else falls
// back to the dashboard.

/** Longest path accepted. A real in-app return path is a few dozen chars. */
const MAX_LENGTH = 512;

/** The page a connect returns to when no usable path was given. */
export const DEFAULT_RETURN_PATH = "/dashboard";

/**
 * The value as a same-origin path (pathname plus query), or null when it is
 * anything else: absolute URLs, protocol-relative "//host", backslash tricks,
 * control characters, or the WHOOP routes themselves (which would loop).
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith("/")) return null;
  // "//evil.test" and "/\evil.test" are read by browsers as another host.
  if (value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  const base = "https://return-path.invalid";
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    return null;
  }
  if (parsed.origin !== base) return null;
  if (parsed.pathname.startsWith("/api/")) return null;

  // Drop a stale outcome so the new one is the only one the page reads.
  parsed.searchParams.delete("whoop");
  return `${parsed.pathname}${parsed.search}`;
}
