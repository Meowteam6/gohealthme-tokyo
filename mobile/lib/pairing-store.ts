// Where the device token lives: the iPhone Keychain, via expo-secure-store.
// It is a bearer credential for writing this wallet's health totals, so it
// never goes in AsyncStorage, logs, or the screen.

import * as SecureStore from "expo-secure-store";

import type { Pairing } from "./api";

const KEY = "gohealthme.pairing.v1";

export async function loadPairing(): Promise<Pairing | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Pairing>;
    if (typeof parsed.deviceToken === "string" && typeof parsed.address === "string") {
      return { deviceToken: parsed.deviceToken, address: parsed.address };
    }
  } catch {
    // Corrupt entry: treat as unpaired rather than crash on launch.
  }
  return null;
}

export async function savePairing(pairing: Pairing): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(pairing), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** The code inside a gohealthme://pair?code=XXXX-XXXX link, or null. */
export function codeFromUrl(url: string | null): string | null {
  if (url === null) return null;
  const match = /^gohealthme:\/\/pair\?(?:.*&)?code=([^&#]+)/i.exec(url);
  const raw = match?.[1];
  if (raw === undefined) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

const CONNECTED_KEY = "gohealthme.healthkit-asked.v1";

/**
 * Whether the Apple Health sheet has been shown on this phone. Launch-time
 * syncs wait for it: syncing before the player tapped Connect would read
 * nothing and report an empty sync as if something had gone wrong.
 */
export async function loadConnected(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CONNECTED_KEY)) === "1";
}

export async function saveConnected(): Promise<void> {
  await SecureStore.setItemAsync(CONNECTED_KEY, "1");
}
