// Server-side cache for address -> name resolution (server only).
//
// A feed page renders dozens of names and every one is a chain walk through
// the universal resolver on Sepolia. The answer changes only when a wallet
// claims a name, and the claim route knows when that happens, so the cache
// is long on hits, short on misses, and invalidated by the writer rather
// than by guessing.
//
// Two layers: module memory (free, per lambda) and the shared store (Redis in
// prod, tmpdir JSON locally) so a cold lambda still skips the chain walk. A
// store failure degrades to the chain read; it never fails a page.

import { readJson, writeJson, deleteKey } from "@/lib/server/store";

export const RESOLVE_HIT_TTL_MS = 5 * 60 * 1000;
export const RESOLVE_MISS_TTL_MS = 45 * 1000;

interface CachedName {
  name: string | null;
  at: number;
}

const memory = new Map<string, CachedName>();

function key(address: string): string {
  return address.toLowerCase();
}

function file(address: string): string {
  return `ens-resolve-${key(address)}.json`;
}

function fresh(entry: CachedName, now: number): boolean {
  const ttl = entry.name === null ? RESOLVE_MISS_TTL_MS : RESOLVE_HIT_TTL_MS;
  return now - entry.at >= 0 && now - entry.at < ttl;
}

/**
 * The cached name for an address, or the resolver's answer (which is then
 * cached). `resolver` is the real chain read; this function never invents a
 * value and never hides a resolver failure behind a stale hit.
 */
export async function cachedResolvedName(
  address: string,
  resolver: (address: string) => Promise<string | null>,
  now: number = Date.now(),
): Promise<string | null> {
  const k = key(address);
  const inMemory = memory.get(k);
  if (inMemory !== undefined && fresh(inMemory, now)) return inMemory.name;

  let stored: CachedName | null = null;
  try {
    stored = await readJson<CachedName | null>(file(address), null);
  } catch {
    stored = null;
  }
  if (stored !== null && fresh(stored, now)) {
    memory.set(k, stored);
    return stored.name;
  }

  const name = await resolver(address);
  const entry: CachedName = { name, at: now };
  memory.set(k, entry);
  try {
    await writeJson(file(address), entry);
  } catch {
    // The next cold lambda resolves again. Slower, never wrong.
  }
  return name;
}

/** Drop both layers for an address; the claim route calls this after a mint. */
export async function invalidateResolvedName(address: string): Promise<void> {
  memory.delete(key(address));
  try {
    await deleteKey(file(address));
  } catch {
    // A stale store entry ages out within the miss TTL at worst.
  }
}

/** Test seam. */
export function resetResolveCache(): void {
  memory.clear();
}
