"use client";

// One shared one-second clock for every countdown and run timer on the page.
// A store rather than a per-component effect: no setState after render, one
// interval however many timers are mounted, and null on the server and the
// hydrating render so markup always matches.

import { useSyncExternalStore } from "react";

let current: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  current = Math.floor(Date.now() / 1000);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    current = Math.floor(Date.now() / 1000);
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function snapshot(): number | null {
  return current;
}

function serverSnapshot(): number | null {
  return null;
}

/** Whole seconds since the epoch, ticking once a second; null before mount. */
export function useNowSeconds(): number | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
