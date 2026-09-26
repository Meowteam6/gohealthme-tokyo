"use client";

// The "What do you wear?" answer, remembered on this device so the landing
// and the lobby agree. A convenience, never state that matters: with storage
// blocked it lives in memory for the visit, and it renders nothing picked on
// the server and the hydrating render so markup always matches.

import { useCallback, useSyncExternalStore } from "react";
import { WEAR_STORAGE_KEY, isWearableBrand, type WearableBrand } from "@/lib/game/wearable-fit";

let memory: WearableBrand | null = null;
const listeners = new Set<() => void>();

function read(): WearableBrand | null {
  if (memory !== null) return memory;
  try {
    const raw = window.localStorage.getItem(WEAR_STORAGE_KEY);
    return isWearableBrand(raw) ? raw : null;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useWearPick(): [WearableBrand | null, (brand: WearableBrand) => void] {
  const pick = useSyncExternalStore(subscribe, read, () => null);
  const setPick = useCallback((brand: WearableBrand) => {
    try {
      window.localStorage.setItem(WEAR_STORAGE_KEY, brand);
      memory = null;
    } catch {
      memory = brand;
    }
    listeners.forEach((l) => l());
  }, []);
  return [pick, setPick];
}
