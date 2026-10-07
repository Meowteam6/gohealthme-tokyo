// The page's side of the iPhone app bridge. The GoHealthMe iPhone app
// (mobile/components/WebShell.tsx) loads this site in a WebView, appends
// "GoHealthMeShell/<version>" to the user agent and injects
// window.ReactNativeWebView. The page is the shell only when BOTH are there:
// the token alone is a string anyone can send, and the bridge alone is any
// react-native-webview. Inside the shell three things change on the page:
// sign-in is email only (Base and WalletConnect cannot complete in a
// WebView), Apple Watch pairing is one tap (the page hands the code to the
// shell instead of showing it), and Junction's connect page opens in the
// Safari sheet instead of a popup. Nothing else knows the shell exists.
//
// THE WIRE, shared with mobile/lib/shell/bridge.ts. Page -> shell is one JSON
// string through postMessage: { v: 1, type, ...fields }. Shell -> page is a
// CustomEvent named gohealthme:shell on window whose detail is one of:
//
//   { type: "status", healthAvailable, paired: { address } | null, healthAsked }
//   { type: "pair-status", status: "redeeming" | "redeemed" | "health-sheet" | "syncing" }
//   { type: "pair-status", status: "synced", stored, covered, daysWithData, unread }
//   { type: "pair-status", status: "failed", reason, message }
//   { type: "browser-closed" }
//
// The shell's answer at load rides injectedObjectJson() with the status
// fields. Every read here is defensive: a malformed detail is dropped, never
// thrown, because the WebView also visits OAuth pages we do not control.

import { useEffect, useRef, useSyncExternalStore } from "react";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
      injectedObjectJson?: () => string;
    };
  }
}

/** The CustomEvent the shell dispatches on window. */
export const SHELL_EVENT = "gohealthme:shell";

/** True when the user agent carries the shell's token. Not enough on its own. */
export function isShellUserAgent(userAgent: string): boolean {
  return /\bGoHealthMeShell\//.test(userAgent);
}

function bridgeOf(): NonNullable<Window["ReactNativeWebView"]> | null {
  if (typeof window === "undefined") return null;
  const bridge = window.ReactNativeWebView;
  return bridge !== undefined && typeof bridge.postMessage === "function" ? bridge : null;
}

/** True when the WebView injected its postMessage bridge into this page. */
export function hasShellBridge(): boolean {
  return bridgeOf() !== null;
}

/** True inside the GoHealthMe iPhone app: the token AND the bridge. Client only. */
export function isShell(): boolean {
  return (
    typeof navigator !== "undefined" &&
    isShellUserAgent(navigator.userAgent) &&
    hasShellBridge()
  );
}

// The answer never changes within a page's life, so there is nothing to
// subscribe to. The server snapshot is false so the server render and the
// first client render agree and nothing flashes from one layout to the other.
const noSubscribe = () => () => {};
const notShell = () => false;

/** Whether this page runs inside the iPhone app. False on the server. */
export function useShell(): boolean {
  return useSyncExternalStore(noSubscribe, isShell, notShell);
}

/** What the page can ask the shell to do. */
export type ShellMessage =
  | { type: "hello" }
  | { type: "pair"; code: string }
  | { type: "sync" }
  | { type: "open-settings" }
  | { type: "open-browser"; url: string };

/**
 * Hand the shell one message. True when it was posted. A no-op without the
 * bridge, so callers can post unconditionally where the shell is a detail.
 */
export function shellPost(message: ShellMessage): boolean {
  const bridge = bridgeOf();
  if (bridge === null) return false;
  try {
    bridge.postMessage(JSON.stringify({ v: 1, ...message }));
    return true;
  } catch {
    return false;
  }
}

/** Why native pairing stopped, as the shell names it. */
export type ShellPairFailure =
  | "invalid-code"
  | "save-failed"
  | "health-unreadable"
  | "revoked"
  | "network"
  | "server";

const PAIR_FAILURES: ReadonlySet<string> = new Set<ShellPairFailure>([
  "invalid-code",
  "save-failed",
  "health-unreadable",
  "revoked",
  "network",
  "server",
]);

/** One step of native pairing, in the order the shell reports them. */
export type ShellPairStatus =
  | { status: "redeeming" }
  | { status: "redeemed" }
  | { status: "health-sheet" }
  | { status: "syncing" }
  | { status: "synced"; stored: number; covered: number; daysWithData: number; unread: string[] }
  | { status: "failed"; reason: ShellPairFailure; message: string };

/** What the shell knows about this phone. */
export interface ShellStatus {
  /** False on an iPad or a simulator: Apple Health cannot be read there. */
  healthAvailable: boolean;
  /** The wallet this phone is paired to, when it is. */
  paired: { address: string } | null;
  /** Whether iOS has already shown the Health sheet on this phone. */
  healthAsked: boolean;
}

export type ShellEvent =
  | { type: "status"; status: ShellStatus }
  | { type: "pair-status"; pair: ShellPairStatus }
  | { type: "browser-closed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseStatus(record: Record<string, unknown>): ShellStatus | null {
  if (typeof record.healthAvailable !== "boolean") return null;
  const paired =
    isRecord(record.paired) && typeof record.paired.address === "string"
      ? { address: record.paired.address }
      : null;
  return {
    healthAvailable: record.healthAvailable,
    paired,
    healthAsked: record.healthAsked === true,
  };
}

function parsePairStatus(record: Record<string, unknown>): ShellPairStatus | null {
  switch (record.status) {
    case "redeeming":
    case "redeemed":
    case "health-sheet":
    case "syncing":
      return { status: record.status };
    case "synced":
      return {
        status: "synced",
        stored: count(record.stored),
        covered: count(record.covered),
        daysWithData: count(record.daysWithData),
        unread: Array.isArray(record.unread)
          ? record.unread.filter((m): m is string => typeof m === "string")
          : [],
      };
    case "failed":
      return {
        status: "failed",
        reason:
          typeof record.reason === "string" && PAIR_FAILURES.has(record.reason)
            ? (record.reason as ShellPairFailure)
            : "server",
        message: typeof record.message === "string" ? record.message : "",
      };
    default:
      return null;
  }
}

/** Parse one event detail from the shell. Null for anything unexpected. */
export function parseShellEvent(detail: unknown): ShellEvent | null {
  let value = detail;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "browser-closed":
      return { type: "browser-closed" };
    case "status": {
      const status = parseStatus(value);
      return status === null ? null : { type: "status", status };
    }
    case "pair-status": {
      const pair = parsePairStatus(value);
      return pair === null ? null : { type: "pair-status", pair };
    }
    default:
      return null;
  }
}

// The latest status the shell pushed after load. Every listener below
// records it, so a read after the push sees the phone as it is now.
let pushed: ShellStatus | null = null;
let injected: { raw: string; value: ShellStatus | null } | null = null;

/**
 * Listen for the shell's events. Returns the unsubscribe. Subscribes to
 * nothing without a window, so it is safe to call from any effect.
 */
export function onShellEvent(handler: (event: ShellEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (raw: Event) => {
    const event = parseShellEvent((raw as CustomEvent<unknown>).detail);
    if (event === null) return;
    if (event.type === "status") pushed = event.status;
    handler(event);
  };
  window.addEventListener(SHELL_EVENT, listener);
  return () => window.removeEventListener(SHELL_EVENT, listener);
}

/**
 * What the shell knows about this phone: the status it pushed, else the
 * object it injected at load. Null outside the shell or when unreadable.
 */
export function shellStatus(): ShellStatus | null {
  if (pushed !== null) return pushed;
  const bridge = bridgeOf();
  if (bridge === null || typeof bridge.injectedObjectJson !== "function") return null;
  let raw: string;
  try {
    raw = bridge.injectedObjectJson();
  } catch {
    return null;
  }
  // Stable identity per raw string, which useSyncExternalStore requires.
  if (injected !== null && injected.raw === raw) return injected.value;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    parsed = null;
  }
  const value = isRecord(parsed) ? parseStatus(parsed) : null;
  injected = { raw, value };
  return value;
}

/** Forgets the pushed and injected status. For tests. */
export function resetShellStatusCache(): void {
  pushed = null;
  injected = null;
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
