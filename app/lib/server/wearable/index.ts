// Which provider backs a given wallet.
//
// Two integrations now answer the same questions (see ./types.ts), so
// something has to choose between them per user. The choice is stored per
// wallet address in the same Redis-or-file store the closed-beta access record
// uses, because it has to survive the browser: SPOTTER verifies claims from a
// cron long after the user has closed the tab, and it must read the same
// provider the user actually linked.
//
// RESOLUTION ORDER, most specific first:
//   1. the wallet's stored choice, when that provider is still configured
//   2. the only configured provider, when exactly one is
//   3. WEARABLE_PROVIDER_DEFAULT, when it names a configured provider
//   4. junction, the historical default
//
// Rule 1 is deliberately conditional. If WHOOP credentials are pulled from the
// environment, a wallet that chose WHOOP must fall back to something that can
// answer rather than throwing "missing env var" at every read - the user sees
// "connect a device", which is true and actionable, instead of a 500.

import { readJson, writeJson } from "@/lib/server/store";
import {
  appleAppAvailable,
  appleConfigured,
  appleProvider,
} from "@/lib/server/wearable/apple";
import {
  junctionConfigured,
  junctionProvider,
} from "@/lib/server/wearable/junction-provider";
import { whoopConfigured, whoopProvider } from "@/lib/server/wearable/whoop";
import { tokenStorageConfigured } from "@/lib/server/wearable/tokens";
import {
  isProviderId,
  PROVIDER_IDS,
  type ProviderId,
  type WearableProvider,
} from "@/lib/server/wearable/types";

export * from "@/lib/server/wearable/types";

const PROVIDERS: Record<ProviderId, WearableProvider> = {
  junction: junctionProvider,
  whoop: whoopProvider,
  apple: appleProvider,
};

function storeKey(address: string): string {
  return `wearable-provider:${address.toLowerCase()}`;
}

/**
 * Whether a provider can actually serve a request right now.
 *
 * WHOOP additionally requires the token-encryption key: it stores per-user
 * OAuth credentials, and without somewhere safe to put them the honest answer
 * is that the path is not available. Reporting it as configured and then
 * refusing every write would look like an outage.
 */
export function providerConfigured(id: ProviderId): boolean {
  // Exhaustive by construction. The previous if/else returned WHOOP's answer
  // for every id that was not junction, so registering a third provider would
  // have silently reported it as configured whenever WHOOP was - a wrong
  // answer that only shows up as an unexplained failure at link time. A record
  // keyed on ProviderId cannot compile once a provider is added without one.
  const checks: Record<ProviderId, () => boolean> = {
    junction: junctionConfigured,
    // WHOOP additionally needs somewhere safe to put per-user OAuth tokens;
    // without the key it is not available, rather than available-and-refusing.
    whoop: () => whoopConfigured() && tokenStorageConfigured(),
    // Apple holds no per-wallet credential: the phone pushes daily aggregates
    // into our own table, so there is nothing to encrypt at rest. It is
    // offered only when the phone app actually ships to players: a database
    // alone made Apple look pairable to people with no app to install, which
    // was a dead end in front of every wearable run.
    apple: () => appleConfigured() && appleAppAvailable(),
  };
  return checks[id]();
}

/** Every provider that could serve a link request, in preference order. */
export function availableProviders(): ProviderId[] {
  return PROVIDER_IDS.filter(providerConfigured);
}

interface StoredChoice {
  provider?: unknown;
  updatedAt?: unknown;
  /** Every choice, oldest first: { provider, at (epoch ms) }. */
  history?: unknown;
}

interface ChoiceEntry {
  provider: ProviderId;
  at: number;
}

/** Choices older than this are dropped from the history, except the newest
 *  of them, which is still the answer for any run that began after it. */
const HISTORY_KEEP_MS = 120 * 86_400_000;
/** Hard bound on one wallet's history, whatever its age. */
const HISTORY_MAX = 200;

/** The choice history a stored record encodes, oldest first. A record from
 *  before the history existed reads as its one choice, dated when it was
 *  stored (0 when unknown, which reads as "before any run"). */
function historyOf(record: StoredChoice | null): ChoiceEntry[] {
  if (record === null) return [];
  if (Array.isArray(record.history)) {
    return record.history
      .filter(
        (entry): entry is ChoiceEntry =>
          typeof entry === "object" &&
          entry !== null &&
          isProviderId((entry as ChoiceEntry).provider) &&
          typeof (entry as ChoiceEntry).at === "number",
      )
      .sort((a, b) => a.at - b.at);
  }
  if (isProviderId(record.provider)) {
    return [
      {
        provider: record.provider,
        at: typeof record.updatedAt === "number" ? record.updatedAt : 0,
      },
    ];
  }
  return [];
}

/** The provider a wallet has explicitly chosen, or null when it has not. */
export async function storedProviderId(
  address: string,
): Promise<ProviderId | null> {
  const record = await readJson<StoredChoice | null>(storeKey(address), null);
  const value = record?.provider;
  return isProviderId(value) ? value : null;
}

/**
 * Record a wallet's choice. Called when a link flow starts (before consent)
 * and when Apple data first arrives. The history is kept so the miss rule can
 * read the provider the wallet had when a run began (pinnedProviderId): the
 * current choice moves on one signed tap, and a run's evidence must not.
 */
export async function setProviderId(
  address: string,
  provider: ProviderId,
): Promise<void> {
  const key = storeKey(address);
  const now = Date.now();
  const history = historyOf(await readJson<StoredChoice | null>(key, null));
  history.push({ provider, at: now });
  const cutoff = now - HISTORY_KEEP_MS;
  const older = history.filter((entry) => entry.at < cutoff);
  const kept = [
    ...(older.length > 0 ? [older[older.length - 1]] : []),
    ...history.filter((entry) => entry.at >= cutoff),
  ].slice(-HISTORY_MAX);
  await writeJson(key, { provider, updatedAt: now, history: kept });
}

/**
 * The provider a run's evidence is read from: the wallet's choice at
 * `atSec` (the run's periodStart), or, when it had none yet, the first choice
 * it made after. Null when the wallet never chose one. A switch after that
 * moment does not move the pin, so the miss rule keeps reading the data the
 * run was played on.
 */
export async function pinnedProviderId(
  address: string,
  atSec: bigint,
): Promise<ProviderId | null> {
  const history = historyOf(
    await readJson<StoredChoice | null>(storeKey(address), null),
  );
  if (history.length === 0) return null;
  const atMs = Number(atSec) * 1000;
  let pinned: ProviderId | null = null;
  for (const entry of history) {
    if (entry.at <= atMs) pinned = entry.provider;
  }
  return pinned ?? history[0].provider;
}

function defaultProviderId(): ProviderId {
  const available = availableProviders();
  if (available.length === 1) return available[0];

  const configured = process.env.WEARABLE_PROVIDER_DEFAULT?.trim() ?? "";
  if (isProviderId(configured) && providerConfigured(configured)) {
    return configured;
  }
  return "junction";
}

/** The provider id that should serve this wallet. */
export async function providerIdFor(address: string): Promise<ProviderId> {
  const stored = await storedProviderId(address);
  if (stored !== null && providerConfigured(stored)) return stored;
  return defaultProviderId();
}

/** A provider by id, regardless of whether it is configured. */
export function providerById(id: ProviderId): WearableProvider {
  return PROVIDERS[id];
}

/** The provider that should serve this wallet. */
export async function providerFor(
  address: string,
): Promise<WearableProvider> {
  return providerById(await providerIdFor(address));
}

/**
 * Every ledger service name that identifies a wearable read, across all
 * providers. lib/claim-restore.ts mirrors this into the client bundle - it
 * cannot import from a server module - so a new provider must be added there
 * too or returning users land on the wrong proof tab.
 */
export function wearableReadServices(): string[] {
  return PROVIDER_IDS.map((id) => PROVIDERS[id].readService);
}
