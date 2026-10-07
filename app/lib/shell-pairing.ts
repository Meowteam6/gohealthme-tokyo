// One-tap Apple Watch pairing inside the iPhone app, the pure part. In a
// browser the pairing card shows a code the phone redeems; inside the shell
// (lib/shell.ts) the page is already on the phone, so the card hands the code
// to the shell and the shell redeems it, asks iOS for Health and syncs. The
// shell reports each step back as a pair-status event; this module decides
// what to post, what each report means and what the card says for it, so
// components/PhonePairPanel.tsx only renders.
//
// Every line here is one the app on the phone already says, or the plan's
// own words. Nothing explains the bridge to the player.

import type { ShellMessage, ShellPairStatus } from "@/lib/shell";
import type { PhonePairing } from "@/lib/wearable-connect";

export const SHELL_PAIRING = "Pairing this iPhone";
export const SHELL_ALLOW_HEALTH = "Allow Apple Health when iOS asks";
export const SHELL_READING = "Reading the last 30 days of Apple Health";
export const SHELL_SYNCED = "Synced. Checking what it counts";
export const SHELL_CODE_FAILED = "That code did not work";
/** The app's own line (mobile/lib/sync.ts NOTHING_SYNCED), word for word. */
export const SHELL_NOTHING_SYNCED =
  "Nothing synced. Check that GoHealthMe is allowed in Settings > Health > Data Access";
/** Fallbacks when the shell sends a failure with no words. */
const SHELL_HEALTH_UNREADABLE =
  "Health could not be read. Check Health access in Settings and try again.";
const SHELL_REVOKED = "This iPhone is no longer paired.";
const SHELL_FAILED = "That did not go through.";
/** Shown where Pair would be when Apple Health cannot be read on this device. */
export const SHELL_NO_HEALTH =
  "Apple Health is not available on this device, so Apple Watch pairing is off here.";

/**
 * The message that hands a code to the shell, or null when there is nothing
 * to post: no code, a code already handed over (`lastPosted`), or a code
 * past its ten minutes. One post per code is the rule: the redeem is
 * single-use, so a second post would only turn a good code into a 400.
 */
export function pairPostFor(
  lastPosted: string | null,
  pairing: PhonePairing | null,
  now: number,
): ShellMessage | null {
  if (pairing === null || pairing.code === lastPosted) return null;
  if (now >= pairing.expiresAt) return null;
  return { type: "pair", code: pairing.code };
}

/**
 * True once the shell's report means the code was spent on this phone. From
 * then on the code's expiry no longer matters, and a retry is a sync, not a
 * new code. A failure is placed by where it can happen: a bad code, a
 * refused Keychain save, a network error or a server error can all come
 * before the token exists (the redeem route itself answers 502 and 503);
 * Health or a revoked token only after. The card accumulates this over the
 * code's reports, so a server error after a redeem keeps the redeemed flag.
 */
export function marksRedeemed(status: ShellPairStatus): boolean {
  switch (status.status) {
    case "redeeming":
      return false;
    case "failed":
      return status.reason === "health-unreadable" || status.reason === "revoked";
    default:
      return true;
  }
}

/** True for a sync that stored a row or covered a day. An empty sync pairs nothing. */
export function syncedWithData(status: ShellPairStatus | null): boolean {
  return status !== null && status.status === "synced" && (status.stored > 0 || status.covered > 0);
}

/** A tap the shell card offers. The kinds are what the card does on it. */
export type ShellPairAction =
  | { kind: "new-code"; label: string }
  | { kind: "sync"; label: string }
  | { kind: "repost"; label: string }
  | { kind: "open-settings"; label: string };

export interface ShellPairView {
  /** The one status line. */
  line: string;
  /** True when the player has to act for pairing to go on. */
  failed: boolean;
  /** The taps offered, the one that fixes it first. */
  actions: ShellPairAction[];
}

const NEW_CODE: ShellPairAction = { kind: "new-code", label: "Get a new code" };
const PAIR_AGAIN: ShellPairAction = { kind: "new-code", label: "Pair again" };
const SYNC_AGAIN: ShellPairAction = { kind: "sync", label: "Try again" };
const POST_AGAIN: ShellPairAction = { kind: "repost", label: "Try again" };
const OPEN_SETTINGS: ShellPairAction = { kind: "open-settings", label: "Open Settings" };

/**
 * What the card says for the shell's latest report on the code, and the
 * taps that go with it. `redeemed` is marksRedeemed accumulated over the
 * code's reports, so a network failure retries the right step.
 */
export function shellPairView(status: ShellPairStatus | null, redeemed: boolean): ShellPairView {
  if (status === null || status.status === "redeeming" || status.status === "redeemed") {
    // The shell answers within a moment. The quiet way out is for the one
    // case it never does.
    return { line: SHELL_PAIRING, failed: false, actions: [NEW_CODE] };
  }
  switch (status.status) {
    case "health-sheet":
      return { line: SHELL_ALLOW_HEALTH, failed: false, actions: [] };
    case "syncing":
      return { line: SHELL_READING, failed: false, actions: [] };
    case "synced":
      return syncedWithData(status)
        ? { line: SHELL_SYNCED, failed: false, actions: [] }
        : { line: SHELL_NOTHING_SYNCED, failed: true, actions: [SYNC_AGAIN, OPEN_SETTINGS] };
    case "failed": {
      const said = status.message.trim();
      switch (status.reason) {
        case "invalid-code":
        case "save-failed":
          // The server's sentence talks about a code the player never saw.
          return { line: SHELL_CODE_FAILED, failed: true, actions: [NEW_CODE] };
        case "health-unreadable":
          return { line: said === "" ? SHELL_HEALTH_UNREADABLE : said, failed: true, actions: [SYNC_AGAIN] };
        case "revoked":
          return { line: said === "" ? SHELL_REVOKED : said, failed: true, actions: [PAIR_AGAIN] };
        case "network":
          return {
            line: said === "" ? SHELL_FAILED : said,
            failed: true,
            actions: [redeemed ? SYNC_AGAIN : POST_AGAIN],
          };
        case "server":
          // Before the redeem the shell keeps the failed code in its attempted
          // set, so a repost would be swallowed; only a new code moves on.
          return {
            line: said === "" ? SHELL_FAILED : said,
            failed: true,
            actions: [redeemed ? SYNC_AGAIN : NEW_CODE],
          };
      }
    }
  }
}
