// The channel between the website and the shell around it.
//
// PAGE -> SHELL. The page calls window.ReactNativeWebView.postMessage with one
// JSON string: { v: 1, type, ...fields }. Only the messages below are acted
// on, and only when the WebView's current URL is on the site's own origin
// (components/WebShell.tsx checks that before parsing). The WebView also
// visits WHOOP's and Junction's OAuth pages, and nothing those pages post may
// ever start native pairing or open a browser.
//
//   { v: 1, type: "hello" }                       the page is up, send status
//   { v: 1, type: "pair", code }                  redeem this pairing code now
//   { v: 1, type: "sync" }                        read Apple Health again
//   { v: 1, type: "open-settings" }               open the iOS Settings app
//   { v: 1, type: "open-browser", url }           open an http(s) URL in the Safari sheet
//
// SHELL -> PAGE. The shell injects a script that dispatches one CustomEvent
// named gohealthme:shell on window, with the detail below. The page listens
// with window.addEventListener("gohealthme:shell", (e) => e.detail).
//
//   { type: "status", healthAvailable, paired: { address } | null, healthAsked }
//   { type: "pair-status", status: "redeeming" | "redeemed" | "health-sheet" | "syncing" }
//   { type: "pair-status", status: "synced", stored, covered, daysWithData, unread }
//   { type: "pair-status", status: "failed", reason, message }
//   { type: "browser-closed" }
//
// The shell can also move the WebView itself: navigateScript(url) replaces
// the page it holds, the way back to the site when a third-party page died.
//
// The device token never crosses this channel in either direction. Pure, so
// vitest covers the parsing and the escaping.

export type PageMessage =
  | { type: "hello" }
  | { type: "pair"; code: string }
  | { type: "sync" }
  | { type: "open-settings" }
  | { type: "open-browser"; url: string };

export type PairFailureReason =
  | "invalid-code"
  | "save-failed"
  | "health-unreadable"
  | "revoked"
  | "network"
  | "server";

/** One step of native pairing, as the page sees it. */
export type PairStatus =
  | { status: "redeeming" }
  | { status: "redeemed" }
  | { status: "health-sheet" }
  | { status: "syncing" }
  | { status: "synced"; stored: number; covered: number; daysWithData: number; unread: string[] }
  | { status: "failed"; reason: PairFailureReason; message: string };

export interface ShellStatus {
  healthAvailable: boolean;
  paired: { address: string } | null;
  healthAsked: boolean;
}

export type ShellEvent =
  | ({ type: "status" } & ShellStatus)
  | ({ type: "pair-status" } & PairStatus)
  | { type: "browser-closed" };

const MAX_CODE_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse one postMessage payload. Anything unexpected is null, silently. */
export function parsePageMessage(raw: unknown): PageMessage | null {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== 1) return null;

  switch (parsed.type) {
    case "hello":
    case "sync":
    case "open-settings":
      return { type: parsed.type };
    case "pair": {
      const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
      if (code === "" || code.length > MAX_CODE_LENGTH) return null;
      return { type: "pair", code };
    }
    case "open-browser": {
      const url = typeof parsed.url === "string" ? parsed.url : "";
      if (originOf(url) === null) return null;
      return { type: "open-browser", url };
    }
    default:
      return null;
  }
}

/**
 * The script the shell injects to hand the page one event. JSON is a valid JS
 * expression, and the two line separators JSON leaves raw are escaped so no
 * string inside the detail can end the statement early.
 */
export function shellEventScript(detail: ShellEvent): string {
  const json = JSON.stringify(detail)
    .split(String.fromCharCode(0x2028))
    .join("\\u2028")
    .split(String.fromCharCode(0x2029))
    .join("\\u2029")
    .split("<")
    .join("\\u003c");
  return `window.dispatchEvent(new CustomEvent('gohealthme:shell',{detail:${json}}));true;`;
}

/** The script that replaces whatever page the WebView holds with `url`. */
export function navigateScript(url: string): string {
  return `location.replace(${JSON.stringify(url)});true;`;
}

/** scheme://host[:port] of an http(s) URL, lower-cased, default port dropped; null otherwise. */
export function originOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const match = /^(https?):\/\/(?:[^/?#@]*@)?([^/?#:]+)(?::(\d+))?(?=[/?#]|$)/i.exec(url);
  if (match === null) return null;
  const scheme = match[1]?.toLowerCase() ?? "";
  const host = match[2]?.toLowerCase() ?? "";
  const port = match[3];
  if (host === "") return null;
  const defaultPort = scheme === "https" ? "443" : "80";
  const suffix = port === undefined || port === defaultPort ? "" : `:${port}`;
  return `${scheme}://${host}${suffix}`;
}

/** Whether `url` is a page on `siteOrigin` (itself an origin string from originOf). */
export function isOnOrigin(url: unknown, siteOrigin: string): boolean {
  const origin = originOf(url);
  return origin !== null && origin === originOf(siteOrigin);
}
