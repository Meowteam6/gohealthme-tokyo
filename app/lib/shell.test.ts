// The page's side of the iPhone app bridge (lib/shell.ts). Pinned: the shell
// is known by its user-agent token AND the bridge the WebView injects, never
// one alone; a post with no bridge is a no-op, never a throw; events the shell
// dispatches round-trip through onShellEvent as typed data and anything
// malformed is dropped; the injected status is read defensively; and the
// server render always says "not the shell" so markup never flashes.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SHELL_EVENT,
  hasShellBridge,
  isShell,
  isShellUserAgent,
  onShellEvent,
  parseShellEvent,
  resetShellStatusCache,
  shellPost,
  shellStatus,
} from "@/lib/shell";
import { useShell } from "@/lib/shell-hooks";

const SHELL_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GoHealthMeShell/1.0.0";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** A window with the bridge the WebView injects, and a real event target. */
function shellWindow(injected?: unknown) {
  const postMessage = vi.fn<(message: string) => void>();
  const win = Object.assign(new EventTarget(), {
    ReactNativeWebView: {
      postMessage,
      injectedObjectJson:
        injected === undefined ? undefined : () => (typeof injected === "string" ? injected : JSON.stringify(injected)),
    },
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { userAgent: SHELL_UA });
  return { win, postMessage };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetShellStatusCache();
});

describe("shell detection", () => {
  it("knows the shell by its user-agent token and nothing else", () => {
    expect(isShellUserAgent(SHELL_UA)).toBe(true);
    expect(isShellUserAgent(SAFARI_UA)).toBe(false);
    expect(isShellUserAgent("GoHealthMeShell")).toBe(false);
    expect(isShellUserAgent("")).toBe(false);
  });

  it("has a bridge only when the WebView injected postMessage", () => {
    expect(hasShellBridge()).toBe(false);
    vi.stubGlobal("window", {});
    expect(hasShellBridge()).toBe(false);
    vi.stubGlobal("window", { ReactNativeWebView: {} });
    expect(hasShellBridge()).toBe(false);
    shellWindow();
    expect(hasShellBridge()).toBe(true);
  });

  it("is the shell only with both the token and the bridge", () => {
    expect(isShell()).toBe(false);
    shellWindow();
    expect(isShell()).toBe(true);
    // Safari on the same iPhone: no bridge, no shell.
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", { userAgent: SAFARI_UA });
    expect(isShell()).toBe(false);
    // Something spoofing the token in a plain browser: no bridge, no shell.
    vi.stubGlobal("navigator", { userAgent: SHELL_UA });
    expect(isShell()).toBe(false);
  });

  it("renders false on the server even when the shell is present at import", () => {
    shellWindow();
    function Probe() {
      return createElement("span", null, String(useShell()));
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>false</span>");
  });
});

describe("shellPost", () => {
  it("is a no-op without the bridge", () => {
    expect(() => shellPost({ type: "sync" })).not.toThrow();
    expect(shellPost({ type: "sync" })).toBe(false);
  });

  it("posts one versioned JSON string through the bridge", () => {
    const { postMessage } = shellWindow();
    expect(shellPost({ type: "pair", code: "7KQ4MN9P" })).toBe(true);
    expect(shellPost({ type: "open-browser", url: "https://link.tryvital.io/x" })).toBe(true);
    expect(postMessage.mock.calls.map(([raw]) => JSON.parse(raw) as unknown)).toEqual([
      { v: 1, type: "pair", code: "7KQ4MN9P" },
      { v: 1, type: "open-browser", url: "https://link.tryvital.io/x" },
    ]);
  });
});

describe("parseShellEvent", () => {
  it("reads the three event kinds the shell dispatches", () => {
    expect(parseShellEvent({ type: "browser-closed" })).toEqual({ type: "browser-closed" });
    expect(
      parseShellEvent({ type: "status", healthAvailable: true, paired: { address: "0xabc" }, healthAsked: false }),
    ).toEqual({ type: "status", status: { healthAvailable: true, paired: { address: "0xabc" }, healthAsked: false } });
    expect(parseShellEvent({ type: "pair-status", status: "health-sheet" })).toEqual({
      type: "pair-status",
      pair: { status: "health-sheet" },
    });
    expect(
      parseShellEvent({ type: "pair-status", status: "synced", stored: 75, covered: 31, daysWithData: 31, unread: ["steps"] }),
    ).toEqual({
      type: "pair-status",
      pair: { status: "synced", stored: 75, covered: 31, daysWithData: 31, unread: ["steps"] },
    });
    expect(
      parseShellEvent({ type: "pair-status", status: "failed", reason: "invalid-code", message: "That code did not work." }),
    ).toEqual({
      type: "pair-status",
      pair: { status: "failed", reason: "invalid-code", message: "That code did not work." },
    });
  });

  it("accepts the detail as a JSON string too", () => {
    expect(parseShellEvent(JSON.stringify({ type: "browser-closed" }))).toEqual({ type: "browser-closed" });
  });

  it("fills a synced event's counts with zero and a failure's unknown reason as server", () => {
    expect(parseShellEvent({ type: "pair-status", status: "synced" })).toEqual({
      type: "pair-status",
      pair: { status: "synced", stored: 0, covered: 0, daysWithData: 0, unread: [] },
    });
    expect(parseShellEvent({ type: "pair-status", status: "failed", reason: "mystery" })).toEqual({
      type: "pair-status",
      pair: { status: "failed", reason: "server", message: "" },
    });
  });

  it("drops anything that is not one of the shell's events", () => {
    expect(parseShellEvent(undefined)).toBeNull();
    expect(parseShellEvent(null)).toBeNull();
    expect(parseShellEvent("not json")).toBeNull();
    expect(parseShellEvent([])).toBeNull();
    expect(parseShellEvent({ type: "reset" })).toBeNull();
    expect(parseShellEvent({ type: "pair-status", status: "dancing" })).toBeNull();
    expect(parseShellEvent({ type: "status", healthAvailable: "yes" })).toBeNull();
  });
});

describe("onShellEvent", () => {
  it("hands a dispatched event to the handler, typed, and stops after unsubscribe", () => {
    const { win } = shellWindow();
    const seen: unknown[] = [];
    const off = onShellEvent((event) => seen.push(event));
    win.dispatchEvent(new CustomEvent(SHELL_EVENT, { detail: { type: "pair-status", status: "syncing" } }));
    win.dispatchEvent(new CustomEvent(SHELL_EVENT, { detail: { type: "nonsense" } }));
    win.dispatchEvent(new CustomEvent(SHELL_EVENT, { detail: { type: "browser-closed" } }));
    expect(seen).toEqual([
      { type: "pair-status", pair: { status: "syncing" } },
      { type: "browser-closed" },
    ]);
    off();
    win.dispatchEvent(new CustomEvent(SHELL_EVENT, { detail: { type: "browser-closed" } }));
    expect(seen).toHaveLength(2);
  });

  it("subscribes to nothing without a window", () => {
    expect(() => onShellEvent(() => undefined)()).not.toThrow();
  });
});

describe("shellStatus", () => {
  it("reads the injected object, and null when it is missing or broken", () => {
    expect(shellStatus()).toBeNull();
    shellWindow();
    expect(shellStatus()).toBeNull();
    shellWindow("{not json");
    expect(shellStatus()).toBeNull();
    shellWindow({ healthAvailable: false, paired: null, healthAsked: true });
    expect(shellStatus()).toEqual({ healthAvailable: false, paired: null, healthAsked: true });
  });

  it("prefers the status the shell pushed after load", () => {
    const { win } = shellWindow({ healthAvailable: true, paired: null, healthAsked: false });
    const off = onShellEvent(() => undefined);
    win.dispatchEvent(
      new CustomEvent(SHELL_EVENT, {
        detail: { type: "status", healthAvailable: true, paired: { address: "0xabc" }, healthAsked: true },
      }),
    );
    expect(shellStatus()).toEqual({ healthAvailable: true, paired: { address: "0xabc" }, healthAsked: true });
    off();
  });
});
