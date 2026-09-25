// Browser-side memo for GET /api/ens/resolve. A feed renders the same few
// wallets many times; one fetch per address per page life is enough, and
// concurrent mounts share the in-flight request rather than racing it.
// Framework-free so the rule is unit-testable in node.

export type ResolveFetch = (address: string) => Promise<string | null>;

const names = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function cachedName(address: string): string | null | undefined {
  return names.get(address.toLowerCase());
}

export function rememberName(address: string, name: string | null): void {
  names.set(address.toLowerCase(), name);
}

export function forgetName(address: string): void {
  names.delete(address.toLowerCase());
  inflight.delete(address.toLowerCase());
}

export function resetClientNameCache(): void {
  names.clear();
  inflight.clear();
}

/**
 * Resolve once per address; later callers get the memo or join the in-flight
 * request. A failed fetch is not memoized, so a flaky network retries on the
 * next mount instead of pinning a wrong blank.
 */
export async function resolveOnce(
  address: string,
  fetchName: ResolveFetch,
): Promise<string | null> {
  const key = address.toLowerCase();
  const known = names.get(key);
  if (known !== undefined) return known;
  const pending = inflight.get(key);
  if (pending !== undefined) return pending;
  const attempt = (async () => {
    try {
      const name = await fetchName(address);
      names.set(key, name);
      return name;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, attempt);
  return attempt;
}

/** The default fetcher against the app's own route. */
export async function fetchResolvedName(address: string): Promise<string | null> {
  const response = await fetch(`/api/ens/resolve?address=${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`resolve failed with ${response.status}`);
  const body = (await response.json()) as { name?: string | null };
  return typeof body.name === "string" && body.name !== "" ? body.name : null;
}
