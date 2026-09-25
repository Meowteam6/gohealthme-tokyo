"use client";

// Per-device memory of the onboarding pass: which soft steps the player
// skipped and whether they finished it. A convenience, never a gate: when
// storage is blocked (private mode, cleared site data) it falls back to memory
// for the session, so the worst case is seeing the skippable steps again.

import { useCallback, useSyncExternalStore } from "react";
import type { StepId } from "@/lib/game/character";

interface OnboardingRecord {
  skipped: StepId[];
  done: boolean;
}

const EMPTY: OnboardingRecord = { skipped: [], done: false };
const memory = new Map<string, OnboardingRecord>();
const cache = new Map<string, { raw: string | null; value: OnboardingRecord }>();
const listeners = new Set<() => void>();

function keyOf(address: string): string {
  return `ghm.onboarding.${address.toLowerCase()}`;
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse(raw: string | null): OnboardingRecord {
  if (raw === null) return EMPTY;
  try {
    const value = JSON.parse(raw) as Partial<OnboardingRecord>;
    return {
      skipped: Array.isArray(value.skipped) ? (value.skipped as StepId[]) : [],
      done: value.done === true,
    };
  } catch {
    return EMPTY;
  }
}

function read(address: string): OnboardingRecord {
  const key = keyOf(address);
  const inMemory = memory.get(key);
  if (inMemory !== undefined) return inMemory;
  const raw = readRaw(key);
  // Stable identity per raw value, which useSyncExternalStore requires.
  const hit = cache.get(key);
  if (hit !== undefined && hit.raw === raw) return hit.value;
  const value = parse(raw);
  cache.set(key, { raw, value });
  return value;
}

function write(address: string, value: OnboardingRecord): void {
  const key = keyOf(address);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export interface Onboarding {
  skipped: ReadonlySet<StepId>;
  done: boolean;
  /** False on the server and the hydrating render. */
  hydrated: boolean;
  skip: (step: StepId) => void;
  finish: () => void;
  /** Re-open a step the player skipped (the character page's edit links). */
  reopen: (step: StepId) => void;
}

export function useOnboarding(address: string | null): Onboarding {
  const record = useSyncExternalStore(
    subscribe,
    () => (address === null ? EMPTY : read(address)),
    () => null,
  );
  const hydrated = record !== null;
  const value = record ?? EMPTY;

  const skip = useCallback(
    (step: StepId) => {
      if (address === null) return;
      const current = read(address);
      if (current.skipped.includes(step)) return;
      write(address, { ...current, skipped: [...current.skipped, step] });
    },
    [address],
  );
  const finish = useCallback(() => {
    if (address === null) return;
    write(address, { ...read(address), done: true });
  }, [address]);
  const reopen = useCallback(
    (step: StepId) => {
      if (address === null) return;
      const current = read(address);
      write(address, {
        done: false,
        skipped: current.skipped.filter((s) => s !== step),
      });
    },
    [address],
  );

  return {
    skipped: new Set(value.skipped),
    done: value.done,
    hydrated,
    skip,
    finish,
    reopen,
  };
}
