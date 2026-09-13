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
    // into our own table, so there is nothing to encrypt at rest.
    apple: appleConfigured,
  };
  return checks[id]();
}

/** Every provider that could serve a link request, in preference order. */
export function availableProviders(): ProviderId[] {
  return PROVIDER_IDS.filter(providerConfigured);
}

/** The provider a wallet has explicitly chosen, or null when it has not. */
export async function storedProviderId(
  address: string,
): Promise<ProviderId | null> {
  const record = await readJson<{ provider?: unknown } | null>(
    storeKey(address),
    null,
  );
  const value = record?.provider;
  return isProviderId(value) ? value : null;
}

/** Record a wallet's choice. Called when a link flow starts. */
export async function setProviderId(
  address: string,
  provider: ProviderId,
): Promise<void> {
  await writeJson(storeKey(address), { provider, updatedAt: Date.now() });
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
