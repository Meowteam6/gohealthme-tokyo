"use client";

// React hooks over lib/shell.ts, in their own module because lib/shell.ts is
// also imported by server code (wearable-connect runs in route handlers),
// and the App Router refuses a hook import on that path.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { isShell, onShellEvent, shellStatus, type ShellStatus } from "./shell";

// The answer never changes within a page's life, so there is nothing to
// subscribe to. The server snapshot is false so the server render and the
// first client render agree and nothing flashes from one layout to the other.
const noSubscribe = () => () => {};
const notShell = () => false;

/** Whether this page runs inside the iPhone app. False on the server. */
export function useShell(): boolean {
  return useSyncExternalStore(noSubscribe, isShell, notShell);
}

function subscribeStatus(listener: () => void): () => void {
  return onShellEvent((event) => {
    if (event.type === "status") listener();
  });
}
const noStatus = () => null;

/** The shell's status for this phone, live. Null on the server and outside the shell. */
export function useShellStatus(): ShellStatus | null {
  return useSyncExternalStore(subscribeStatus, shellStatus, noStatus);
}

/**
 * Runs `onClosed` when the shell's Safari sheet closes, so a surface that
 * sent a connect page there can re-read what the device now reports.
 */
export function useShellBrowserClosed(onClosed: () => void): void {
  const latest = useRef(onClosed);
  useEffect(() => {
    latest.current = onClosed;
  }, [onClosed]);
  useEffect(
    () =>
      onShellEvent((event) => {
        if (event.type === "browser-closed") latest.current();
      }),
    [],
  );
}
