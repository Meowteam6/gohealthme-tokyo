// The pure pieces behind one-tap Apple Watch pairing inside the iPhone app
// (components/PhonePairPanel.tsx renders them). Pinned: a code is handed to
// the shell exactly once, never when it has already expired; which shell
// reports mean the code was spent; a sync with nothing in it is not a
// pairing; and every report the shell can send has one line and the taps
// that fix it, so no state inside the app is a dead end.

import { describe, expect, it } from "vitest";
import type { ShellPairStatus } from "@/lib/shell";
import {
  SHELL_ALLOW_HEALTH,
  SHELL_CODE_FAILED,
  SHELL_NOTHING_SYNCED,
  SHELL_PAIRING,
  SHELL_READING,
  SHELL_SYNCED,
  marksRedeemed,
  pairPostFor,
  shellPairView,
  syncedWithData,
} from "@/lib/shell-pairing";

const PAIRING = {
  code: "7KQ4MN9P",
  deepLink: "gohealthme://pair?code=7KQ4MN9P",
  expiresAt: 1_800_000_000_000,
};
const FRESH = PAIRING.expiresAt - 60_000;

const SYNCED: ShellPairStatus = { status: "synced", stored: 75, covered: 31, daysWithData: 31, unread: [] };
const EMPTY: ShellPairStatus = { status: "synced", stored: 0, covered: 0, daysWithData: 0, unread: [] };
function failed(reason: Extract<ShellPairStatus, { status: "failed" }>["reason"], message = ""): ShellPairStatus {
  return { status: "failed", reason, message };
}

describe("pairPostFor", () => {
  it("posts a live code once, and never the same code twice", () => {
    expect(pairPostFor(null, PAIRING, FRESH)).toEqual({ type: "pair", code: "7KQ4MN9P" });
    // Posted already (a StrictMode double effect, a re-render): nothing.
    expect(pairPostFor("7KQ4MN9P", PAIRING, FRESH)).toBeNull();
    // A new code from "Get a new code" goes out again.
    expect(pairPostFor("7KQ4MN9P", { ...PAIRING, code: "A1B2C3D4" }, FRESH)).toEqual({
      type: "pair",
      code: "A1B2C3D4",
    });
  });

  it("posts nothing without a code or for a code already expired", () => {
    expect(pairPostFor(null, null, FRESH)).toBeNull();
    expect(pairPostFor(null, PAIRING, PAIRING.expiresAt)).toBeNull();
  });
});

describe("marksRedeemed", () => {
  it("is true from the moment the shell has the code redeemed", () => {
    expect(marksRedeemed({ status: "redeeming" })).toBe(false);
    expect(marksRedeemed({ status: "redeemed" })).toBe(true);
    expect(marksRedeemed({ status: "health-sheet" })).toBe(true);
    expect(marksRedeemed({ status: "syncing" })).toBe(true);
    expect(marksRedeemed(SYNCED)).toBe(true);
    expect(marksRedeemed(EMPTY)).toBe(true);
  });

  it("reads a failure by where it can happen", () => {
    // Before the token exists. A server failure is here too: the redeem
    // route itself answers 502 and 503, so on its own it proves nothing about
    // the code. Once redeemed, the card's accumulated flag already carries it.
    expect(marksRedeemed(failed("invalid-code"))).toBe(false);
    expect(marksRedeemed(failed("save-failed"))).toBe(false);
    expect(marksRedeemed(failed("network"))).toBe(false);
    expect(marksRedeemed(failed("server"))).toBe(false);
    // Only a paired phone can hit these.
    expect(marksRedeemed(failed("health-unreadable"))).toBe(true);
    expect(marksRedeemed(failed("revoked"))).toBe(true);
  });
});

describe("syncedWithData", () => {
  it("is a sync that stored or covered something, and nothing else", () => {
    expect(syncedWithData(SYNCED)).toBe(true);
    expect(syncedWithData({ ...EMPTY, covered: 1 })).toBe(true);
    expect(syncedWithData(EMPTY)).toBe(false);
    expect(syncedWithData({ status: "syncing" })).toBe(false);
    expect(syncedWithData(null)).toBe(false);
  });
});

describe("shellPairView", () => {
  it("says what is happening while the shell works, with a quiet way out", () => {
    for (const status of [null, { status: "redeeming" }, { status: "redeemed" }] as const) {
      const view = shellPairView(status, false);
      expect(view.line).toBe(SHELL_PAIRING);
      expect(view.failed).toBe(false);
      expect(view.actions.map((a) => a.kind)).toEqual(["new-code"]);
    }
    expect(shellPairView({ status: "health-sheet" }, true).line).toBe(SHELL_ALLOW_HEALTH);
    expect(shellPairView({ status: "syncing" }, true).line).toBe(SHELL_READING);
    expect(shellPairView(SYNCED, true)).toEqual({ line: SHELL_SYNCED, failed: false, actions: [] });
  });

  it("names a code that did not work and offers a new one", () => {
    for (const reason of ["invalid-code", "save-failed"] as const) {
      const view = shellPairView(failed(reason, "Server wording the card does not repeat."), false);
      expect(view.line).toBe(SHELL_CODE_FAILED);
      expect(view.failed).toBe(true);
      expect(view.actions).toEqual([{ kind: "new-code", label: "Get a new code" }]);
    }
  });

  it("carries the app's own line for Health it could not read, with a retry", () => {
    const view = shellPairView(failed("health-unreadable", "Health could not be read."), true);
    expect(view.line).toBe("Health could not be read.");
    expect(view.actions).toEqual([{ kind: "sync", label: "Try again" }]);
    // The shell sent no words: the page has its own.
    expect(shellPairView(failed("health-unreadable"), true).line).toMatch(/Health could not be read/);
  });

  it("offers Pair again when another phone took the pairing", () => {
    const view = shellPairView(failed("revoked", "This iPhone is no longer paired."), true);
    expect(view.line).toBe("This iPhone is no longer paired.");
    expect(view.actions).toEqual([{ kind: "new-code", label: "Pair again" }]);
  });

  it("retries a network or server failure where it happened: the sync once paired, the code before", () => {
    expect(shellPairView(failed("network", "Could not reach GoHealthMe."), false).actions).toEqual([
      { kind: "repost", label: "Try again" },
    ]);
    expect(shellPairView(failed("network", "Could not reach GoHealthMe."), true).actions).toEqual([
      { kind: "sync", label: "Try again" },
    ]);
    expect(shellPairView(failed("server", "Sync is not configured here."), true)).toEqual({
      line: "Sync is not configured here.",
      failed: true,
      actions: [{ kind: "sync", label: "Try again" }],
    });
  });

  it("offers a new code when the server failed the redeem itself, since the shell will not retry that code", () => {
    // The redeem route answers 502 on a storage fault and 503 unconfigured.
    // The shell keeps the code in its attempted set after that, so a repost
    // would be swallowed and a sync has no pairing to run on. Only a fresh
    // code moves this forward.
    expect(shellPairView(failed("server", "Could not pair right now."), false)).toEqual({
      line: "Could not pair right now.",
      failed: true,
      actions: [{ kind: "new-code", label: "Get a new code" }],
    });
    expect(shellPairView(failed("server"), false).actions).toEqual([
      { kind: "new-code", label: "Get a new code" },
    ]);
  });

  it("treats a sync with nothing in it as not paired, with the two taps that fix it", () => {
    const view = shellPairView(EMPTY, true);
    expect(view.line).toBe(SHELL_NOTHING_SYNCED);
    expect(view.failed).toBe(true);
    expect(view.actions).toEqual([
      { kind: "sync", label: "Try again" },
      { kind: "open-settings", label: "Open Settings" },
    ]);
  });

  it("keeps the product's words in every line", () => {
    const statuses: (ShellPairStatus | null)[] = [
      null,
      { status: "redeeming" },
      { status: "health-sheet" },
      { status: "syncing" },
      SYNCED,
      EMPTY,
      failed("invalid-code"),
      failed("save-failed"),
      failed("health-unreadable"),
      failed("revoked"),
      failed("network"),
      failed("server"),
    ];
    for (const status of statuses) {
      const view = shellPairView(status, true);
      const words = [view.line, ...view.actions.map((a) => a.label)].join(" ");
      expect(words).not.toMatch(/[!—]/);
      expect(words).not.toMatch(/\b(runs?|pools?|dares?|bets?|wagers?|odds|winners?)\b/i);
      expect(words).not.toMatch(/env|undefined|null|capability|[A-Z_]{6,}/);
    }
  });
});
