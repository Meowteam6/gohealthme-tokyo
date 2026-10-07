// Popup-safe wearable connect flow, shared by every surface that lets a user
// link a real device (the pool-detail WearableCheck and the dashboard connect
// prompt). It lives here so the one correct implementation of the
// gesture-synchronous popup and the blocked-popup fallback cannot drift
// between callers.
//
// TWO PROVIDERS, TWO SHAPES. Junction's connect page lives on Junction's
// domain, so it gets its own tab and the popup dance below. WHOOP's OAuth ends
// back on our own /dashboard, so it takes over the CURRENT tab: a popup would
// land the user on the dashboard inside a window they then have to close,
// while the tab they were actually using sits there stale and still saying "no
// wearable connected". We do not know which shape we are getting until the
// route answers, so the blank popup is opened first either way and closed
// again if the answer turns out to be WHOOP.
//
// THE REQUEST IS SIGNED. /api/wearable/link requires proof of the wallet
// because a WHOOP grant is a live credential: without it anyone could attach
// their own WHOOP account to a stranger's address, overwrite that person's
// real connection, and point someone else's sleep data at a wallet that gets
// paid.

import {
  fetchWithWalletAuth,
  authBlockReason,
  type WalletAuthRequester,
} from "@/lib/client-auth";
import { isShell, shellPost } from "@/lib/shell";
import { isProviderId, type ProviderId } from "@/lib/wearable-providers";
import type { WearableMetric } from "@/lib/wearable-goal";
import type { SensorHold } from "@/lib/wearable-join-gate";
// Re-exported so existing callers keep importing it from here, while the
// server routes import the same implementation from the pure module.
export { metricLabel } from "@/lib/wearable-goal";

export {
  PROVIDER_IDS,
  isProviderId,
  type ProviderId as WearableProviderId,
} from "@/lib/wearable-providers";

/**
 * Raised when the browser blocked even the synchronous popup. Carries the real
 * connect URL so the caller can render a link the user taps directly - a
 * genuine gesture navigation is never blocked.
 */
export class PopupBlockedError extends Error {
  readonly linkUrl: string;
  constructor(linkUrl: string) {
    super("Your browser blocked the wearable connect window.");
    this.name = "PopupBlockedError";
    this.linkUrl = linkUrl;
  }
}

/**
 * Raised when a provider can only be linked on a phone. Not an error the user
 * caused and not something a retry fixes - Apple Health is readable only on
 * the device that holds it - so it carries the instructions to display rather
 * than an error message. Callers render it as guidance, never as a failure.
 */
export class PhoneLinkRequiredError extends Error {
  readonly instructions: string;
  /** The one-time code the phone app redeems, when the provider pairs by code. */
  readonly pairing: PhonePairing | null;
  /** Where to get the phone app, when the deployment names one. */
  readonly installUrl: string | null;
  constructor(
    instructions: string,
    pairing: PhonePairing | null = null,
    installUrl: string | null = null,
  ) {
    super("This device is connected from the phone app, not the browser.");
    this.name = "PhoneLinkRequiredError";
    this.instructions = instructions;
    this.pairing = pairing;
    this.installUrl = installUrl;
  }
}

/** A pairing code minted for this wallet by the link route. */
export interface PhonePairing {
  code: string;
  deepLink: string;
  expiresAt: number;
}

/** What the phone pairing panel renders: the link route's app-kind answer. */
export interface PhoneSteps {
  /** The server's fallback sentence, shown only when no code was minted. */
  instructions: string;
  pairing: PhonePairing | null;
  installUrl: string | null;
}

/**
 * Providers that pair from a phone app and never from a browser page. Known
 * on the client so an explicit pick of one skips the speculative popup: a
 * blank tab that opens and closes again is a flash on the very phone the
 * player is about to pair, and nothing was ever going to load in it.
 */
const PHONE_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>(["apple"]);

const PHONE_FALLBACK_INSTRUCTIONS =
  "Open the GoHealthMe app on your iPhone to finish pairing this device.";

/**
 * True on an iPhone, from the user agent. Only the iPhone can open the
 * GoHealthMe app by deep link, so this decides whether the pairing panel leads
 * with the deep link or with the code. An iPad or a Mac gets the code; the
 * app is an iPhone app and the wrong guess here is a dead button.
 */
export function isIphoneUserAgent(userAgent: string): boolean {
  return /\biPhone\b/.test(userAgent);
}

/**
 * A fresh pairing code for the one-tap "Get a new code", with no popup and no
 * navigation: the answer is rendered in place. Throws when the route answers
 * with a web link, which would mean the phone provider is no longer the one
 * being paired.
 */
export async function requestPhonePairing(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
): Promise<PhoneSteps> {
  const target = await fetchLinkTarget(address, requestAuth, "apple");
  if (target.kind !== "app") {
    throw new Error(
      "Apple Watch pairs from the iPhone app, and the server offered a web link instead.",
    );
  }
  return {
    instructions: target.instructions ?? PHONE_FALLBACK_INSTRUCTIONS,
    pairing: target.pairing,
    installUrl: target.installUrl,
  };
}

/** How often the pairing panel re-reads the provider list while a code is live. */
export const PAIR_POLL_INTERVAL_MS = 3_000;

/**
 * What the provider list says about the phone, for the pairing panel. Read
 * off the same answer the join gate uses, so "paired" here and "paired" in
 * the lobby can never disagree.
 *
 *   paired         the phone has stored a sync; `metrics` is what it counts
 *   awaiting-sync  linked (a code was redeemed) and nothing has arrived yet
 *   unreadable     linked, and the server could not say what it counts
 *   unpaired       Apple is not connected for this wallet
 */
export type PhonePairState =
  | { kind: "paired"; label: string; metrics: WearableMetric[] }
  | { kind: "awaiting-sync"; label: string }
  | { kind: "unreadable"; label: string }
  | { kind: "unpaired" };

export function phonePairingOf(options: ProviderOptions | undefined): PhonePairState {
  if (options === undefined || options.status !== "known") return { kind: "unpaired" };
  const apple = options.providers.find((p) => p.id === "apple");
  if (apple === undefined || !apple.configured || !apple.connected) {
    return { kind: "unpaired" };
  }
  switch (apple.capability) {
    case "awaiting-sync":
      return { kind: "awaiting-sync", label: apple.label };
    case "unknown":
      return { kind: "unreadable", label: apple.label };
    default:
      return {
        kind: "paired",
        label: apple.label,
        metrics: apple.observedMetrics ?? apple.metrics,
      };
  }
}

/** The one state the pairing panel is in. The phone's answer beats the code. */
export type PairPanelPhase =
  | "paired"
  | "awaiting-sync"
  | "unreadable"
  | "live"
  | "expired"
  | "no-code";

export function pairPanelPhase(
  pairing: PhonePairing | null,
  pair: PhonePairState,
  now: number,
): PairPanelPhase {
  if (pair.kind !== "unpaired") return pair.kind;
  if (pairing === null) return "no-code";
  return now < pairing.expiresAt ? "live" : "expired";
}

/**
 * Whether a pairing can still land, so polling is worth it: a code is live,
 * or the phone redeemed one and its first sync is still due, and either way
 * only inside the code's own ten minutes. Past that the next focus of the tab
 * re-reads on its own; a timer that never stops is a battery cost for nothing.
 *
 * A re-pair (`repair`) never polls: the wallet reads paired before the new
 * phone redeems the code and paired after, so there is nothing to notice.
 * Inside the iPhone app (`shell`) nothing polls either: the shell reports
 * the sync and the card re-reads on that word, which also keeps
 * /api/wearable/* under its per-address minute.
 */
export function pairPanelPolls(
  phase: PairPanelPhase,
  pairing: PhonePairing | null,
  now: number,
  repair = false,
  shell = false,
): boolean {
  if (repair || shell) return false;
  if (phase !== "live" && phase !== "awaiting-sync") return false;
  return pairing !== null && now < pairing.expiresAt;
}

function parsePairing(input: unknown): PhonePairing | null {
  if (typeof input !== "object" || input === null) return null;
  const { code, deepLink, expiresAt } = input as Record<string, unknown>;
  if (typeof code !== "string" || typeof deepLink !== "string") return null;
  if (!deepLink.startsWith("gohealthme://")) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return { code, deepLink, expiresAt };
}

/** Where the connect flow wants to send the user. */
interface LinkTarget {
  provider: ProviderId | null;
  /** "app" means the link is completed in a phone app, not this browser. */
  kind: "oauth" | "app";
  linkUrl: string | null;
  instructions: string | null;
  pairing: PhonePairing | null;
  installUrl: string | null;
}

/**
 * Ask our route for a fresh connect target. Surfaces the route's honest error
 * (a down, unconfigured, or unauthorized provider) rather than a bare status.
 */
export async function fetchLinkTarget(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
  provider?: ProviderId,
  returnTo?: string,
): Promise<LinkTarget> {
  const payload: Record<string, string> = { address };
  if (provider !== undefined) payload.provider = provider;
  // Where WHOOP's redirect should land. The server validates it as an
  // in-app path and ignores anything else.
  if (returnTo !== undefined) payload.next = returnTo;
  const sent = await fetchWithWalletAuth(
    "/api/wearable/link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    requestAuth,
  );

  const body = (await sent.response.json().catch(() => null)) as {
    provider?: unknown;
    kind?: unknown;
    linkUrl?: unknown;
    instructions?: unknown;
    pairing?: unknown;
    installUrl?: unknown;
    error?: unknown;
  } | null;

  if (sent.response.status === 401) {
    // The reader's own unfinished step, not a provider failure. Saying the
    // provider is down when they simply declined a signature would be a lie.
    throw new Error(
      authBlockReason(sent.auth) ??
        "Sign with your wallet to connect a device. Nothing is charged and no transaction is sent.",
    );
  }

  if (!sent.response.ok) {
    throw new Error(
      body !== null && typeof body.error === "string" && body.error !== ""
        ? body.error
        : `Link token request failed (${sent.response.status}).`,
    );
  }

  const kind = body?.kind === "app" ? "app" : "oauth";
  const linkUrl = typeof body?.linkUrl === "string" ? body.linkUrl : null;
  if (kind === "oauth" && linkUrl === null) {
    throw new Error("The connect flow did not return a link URL.");
  }

  return {
    provider: isProviderId(body?.provider) ? body.provider : null,
    kind,
    linkUrl,
    instructions:
      typeof body?.instructions === "string" ? body.instructions : null,
    pairing: parsePairing(body?.pairing),
    installUrl:
      typeof body?.installUrl === "string" && body.installUrl.startsWith("https://")
        ? body.installUrl
        : null,
  };
}

/**
 * Start linking a device.
 *
 * The window is opened SYNCHRONOUSLY inside the click's user-gesture tick. The
 * old order - `await fetch(...)` then `window.open(...)` - opened the window a
 * macrotask after the gesture, so the popup blocker killed it ("Popup was
 * blocked"). Here a blank window opens first and is navigated once the target
 * resolves. `noopener` is dropped on purpose: with it, window.open returns null
 * and there is no handle to navigate, so the opener reference is severed by
 * hand before the cross-origin navigation instead. If the browser blocked even
 * the synchronous open, `popup` is null and PopupBlockedError hands the URL
 * back so the UI can offer a link the user activates directly.
 *
 * Inside the iPhone app (lib/shell.ts) a WebView has no popup to give, so
 * Junction's page is handed to the shell, which opens it in the Safari sheet
 * and reports when that closes. WHOOP still takes the current page there.
 */
export async function startWearableLink(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
  provider?: ProviderId,
  /** In-app path a same-tab OAuth (WHOOP) returns to. Defaults to /dashboard. */
  returnTo?: string,
): Promise<void> {
  // An explicit pick of a phone provider has no page to open, so no window is
  // opened for it. The wallet's stored choice still goes through the popup
  // dance below: which shape it is comes back with the route's answer.
  const phoneOnly = provider !== undefined && PHONE_PROVIDERS.has(provider);
  const inShell = isShell();
  const popup = phoneOnly || inShell ? null : window.open("about:blank", "_blank");
  if (popup !== null) {
    try {
      // Static placeholder, built with DOM APIs (no markup parsing, so no
      // injection surface) and replaced by the cross-origin nav below.
      const doc = popup.document;
      doc.title = "Connecting your wearable";
      const msg = doc.createElement("p");
      msg.textContent = "Opening the secure wearable connect page...";
      msg.setAttribute("style", "font:16px system-ui;margin:2rem;color:#333");
      (doc.body ?? doc.documentElement).appendChild(msg);
    } catch {
      // A browser that refuses the write still navigates below; ignore.
    }
  }

  let target: LinkTarget;
  try {
    target = await fetchLinkTarget(address, requestAuth, provider, returnTo);
  } catch (err) {
    if (popup !== null && !popup.closed) popup.close();
    throw err;
  }

  // A provider that can only be linked on a phone (Apple Health exposes no web
  // OAuth) has no page for this browser to open.
  if (target.kind === "app") {
    if (popup !== null && !popup.closed) popup.close();
    if (target.linkUrl !== null) {
      window.location.href = target.linkUrl;
      return;
    }
    throw new PhoneLinkRequiredError(
      target.instructions ?? PHONE_FALLBACK_INSTRUCTIONS,
      target.pairing,
      target.installUrl,
    );
  }

  const linkUrl = target.linkUrl as string;

  // WHOOP comes back to our own dashboard, so it belongs in this tab. The
  // speculative popup is closed rather than left showing a placeholder.
  if (target.provider === "whoop") {
    if (popup !== null && !popup.closed) popup.close();
    window.location.href = linkUrl;
    return;
  }

  // The shell opens it in the Safari sheet; the surface that asked re-reads
  // the device when the sheet closes (useShellBrowserClosed).
  if (inShell) {
    shellPost({ type: "open-browser", url: linkUrl });
    return;
  }

  if (popup === null || popup.closed) {
    throw new PopupBlockedError(linkUrl);
  }

  try {
    // Sever the reverse-tabnabbing reference before the cross-origin nav.
    popup.opener = null;
  } catch {
    // Some browsers make opener read-only; the cross-origin nav still drops
    // our access to the window.
  }
  popup.location.replace(linkUrl);
}

export interface ProviderOption {
  id: ProviderId;
  label: string;
  /** Whether this deployment has credentials for it. */
  configured: boolean;
  /** Whether this wallet has actually linked it. */
  connected: boolean;
  /**
   * What this INTEGRATION can measure. Used to describe the provider in the
   * picker, so a person choosing between them can see the difference.
   */
  metrics: WearableMetric[];
  /**
   * What this WALLET's actual hardware has produced, when we know it.
   */
  observedMetrics: WearableMetric[] | null;
  /** Why this provider is not offered right now, in player copy (for example
   *  WHOOP's direct seats are full), or null. */
  note?: string | null;
  /**
   * How much the server could establish about this wallet's hardware.
   *
   *   observed  observedMetrics is the narrowed truth for this wallet.
   *   declared  the declared list is accurate for this wallet's hardware
   *             (every WHOOP strap is the same device).
   *   awaiting-sync  linked, answering, and nothing has arrived yet from a
   *             multi-brand provider, so its declared union says nothing about
   *             this device. Withholds the join until the first sync. Was
   *             "declared", which offered a WHOOP-via-Junction wallet steps
   *             runs it can never win.
   *   unknown   we could not find out. Withholds the join. This used to be
   *             collapsed into "declared", so a Junction outage offered a
   *             wallet the whole declared union on no evidence, cached for
   *             thirty minutes.
   */
  capability: ProviderCapability;
}

export type ProviderCapability =
  | "observed"
  | "declared"
  | "awaiting-sync"
  | "unknown";

function capabilityOf(value: unknown): ProviderCapability {
  return value === "observed" ||
    value === "awaiting-sync" ||
    value === "unknown"
    ? value
    : "declared";
}

/**
 * Why a capability answer is missing, which is NOT the same question as what
 * the answer is.
 *
 * "known"           we read it; `providers` and `selected` are the truth.
 * "unauthenticated" a wallet IS connected and we have no signature to read
 *                   with. The answer exists; we just have not asked.
 * "unavailable"     nobody is signed in, or the read failed outright.
 *
 * The middle case used to collapse into the last one, and that defeated the
 * join gate entirely: the client credential cache is module memory that dies
 * with the tab, so ANY hard load of a pool page starts unsigned, the read 401s,
 * and "capability unknown" was read as "capability fine". The gate only worked
 * for somebody who had signed in that tab within the last eight minutes.
 */
export type CapabilityStatus = "known" | "unauthenticated" | "unavailable";

export interface ProviderOptions {
  providers: ProviderOption[];
  selected: ProviderId | null;
  status: CapabilityStatus;
}

/** A metric array off the wire, or null when the field is absent or unusable. */
function metricList(value: unknown): WearableMetric[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((m): m is WearableMetric => typeof m === "string");
}

export function parseOptions(payload: unknown): ProviderOptions {
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const raw = Array.isArray(record.providers) ? record.providers : [];
  const providers = raw.flatMap((entry): ProviderOption[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const item = entry as Record<string, unknown>;
    if (!isProviderId(item.id)) return [];
    return [
      {
        id: item.id,
        label: typeof item.label === "string" ? item.label : item.id,
        configured: item.configured === true,
        connected: item.connected === true,
        metrics: metricList(item.metrics) ?? [],
        observedMetrics: metricList(item.observedMetrics),
        capability: capabilityOf(item.capability),
        note: typeof item.note === "string" && item.note !== "" ? item.note : null,
      },
    ];
  });
  const selected = isProviderId(record.selected) ? record.selected : null;
  return { providers, selected, status: "known" };
}

/** React-query key for the provider list, so the picker is read once. */
export function providerOptionsQueryKey(
  address: string | null,
): (string | null)[] {
  return ["wearable-providers", address];
}

/**
 * Which providers this wallet can choose between. Never throws: a picker that
 * cannot load must degrade to "no choice offered" rather than taking the
 * connect button off the screen.
 */
export async function fetchProviderOptions(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
): Promise<ProviderOptions> {
  try {
    const sent = await fetchWithWalletAuth(
      `/api/wearable/providers?address=${address}`,
      undefined,
      requestAuth,
    );
    if (sent.response.status === 401) {
      // A wallet IS connected here - the caller passed its address - and we
      // simply have no signature to read with. Reported as its own state so a
      // surface about to take an entry fee can ask for one instead of assuming
      // the answer is fine.
      return { providers: [], selected: null, status: "unauthenticated" };
    }
    if (!sent.response.ok) {
      return { providers: [], selected: null, status: "unavailable" };
    }
    return parseOptions((await sent.response.json()) as unknown);
  } catch {
    return { providers: [], selected: null, status: "unavailable" };
  }
}

/**
 * This page as an in-app path, for a same-tab OAuth to come back to. Drops a
 * leftover ?whoop= so a new outcome is the only one the page reads.
 */
export function currentReturnPath(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("whoop");
  return `${url.pathname}${url.search}`;
}

/**
 * What the dashboard should say after WHOOP redirects back, keyed on the
 * ?whoop= parameter the callback sets. Null when there is nothing to report.
 *
 * Declining on WHOOP's own screen is a normal choice and is worded as one -
 * it is not an error, and it must not read as though something broke.
 */
export function whoopReturnMessage(
  status: string | null,
): { tone: "ok" | "info" | "error"; message: string } | null {
  switch (status) {
    case "unavailable":
      return {
        tone: "error",
        message:
          "The WHOOP connection is not switched on here yet. That is a setup " +
          "problem on our side, not something you can retry.",
      };
    case "connected":
      return {
        tone: "ok",
        message: "WHOOP connected. Your sleep now backs your claims.",
      };
    case "declined":
      return {
        tone: "info",
        message:
          "You declined access on WHOOP's screen, so nothing was connected.",
      };
    case "expired":
      return {
        tone: "error",
        message:
          "That connect link timed out before it came back. Start the connection again.",
      };
    case "not-allowed":
      return {
        tone: "info",
        message:
          "WHOOP's direct seats are full. Pair through Junction instead; it covers WHOOP straps too.",
      };
    case "failed":
      return {
        tone: "error",
        message:
          "WHOOP could not be connected. Try again, and if it keeps failing the connection is not available right now.",
      };
    default:
      return null;
  }
}

/**
 * What the viewer's ACTIVE provider can measure, or null when that is not
 * known - nobody signed in, the signature is not cached, or the read failed.
 *
 * Null is load-bearing and must stay distinguishable from "measures nothing":
 * callers hold nothing back on null, because taking a pool off the board on a
 * guess about a device we have not identified is its own dead end.
 */
export function viewerMetricsOf(
  options: ProviderOptions | undefined,
): WearableMetric[] | null {
  if (options === undefined || options.selected === null) return null;
  const active = options.providers.find(
    (option) => option.id === options.selected,
  );
  if (active === undefined || !active.configured) return null;
  // A provider the wallet chose but never actually linked says nothing about
  // what will verify their claim, so it is not treated as known either.
  if (!active.connected) return null;
  // We could not establish anything about this device. Null withholds; falling
  // back to the declared union here is what let a Junction outage offer a
  // wallet all seven metrics on no evidence at all.
  if (active.capability === "unknown") return null;
  // Nothing has synced from a multi-brand provider. Its declared list is a
  // union across brands, not a fact about this device, so it is not an answer.
  if (active.capability === "awaiting-sync") return null;
  // Observed beats declared. The declared list is what the integration can
  // serve; the gate has to answer for the device this person is wearing.
  return active.observedMetrics ?? active.metrics;
}

/**
 * Why a LINKED device has no capability answer yet. Null when there is an
 * answer, or when nothing is linked (that is capabilityNeedsDevice's case).
 *
 *   awaiting-sync  linked, and nothing has arrived from the device yet.
 *                  Syncing the device fixes it.
 *   unreadable     linked, and the provider would not tell us what it
 *                  measures right now. Waiting fixes it; the device is fine.
 *
 * Both are holds, not refusals, and both are different from "pair a sensor":
 * sending somebody with a working, linked device to re-pair it is the
 * contradiction this exists to stop.
 */
export function capabilityHoldOf(
  options: ProviderOptions | undefined,
): SensorHold | null {
  if (options === undefined || options.status !== "known") return null;
  const active = linkedActive(options);
  if (active === null) return null;
  if (active.capability === "awaiting-sync") return "awaiting-sync";
  if (active.capability === "unknown") return "unreadable";
  return null;
}

/** The selected provider when it is configured AND linked, else null. */
function linkedActive(options: ProviderOptions): ProviderOption | null {
  if (options.selected === null) return null;
  const active = options.providers.find((o) => o.id === options.selected);
  if (active === undefined || !active.configured || !active.connected) {
    return null;
  }
  return active;
}


/**
 * Drop this wallet's device connection.
 *
 * Resolves to null when it worked, or to a sentence explaining why this
 * provider cannot be disconnected from here - Junction owns its own link, so
 * the honest answer names its connection page rather than pretending.
 *
 * Never throws for the 409: that is guidance, not a failure.
 */
export async function disconnectWearable(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
): Promise<string | null> {
  const sent = await fetchWithWalletAuth(
    "/api/wearable/disconnect",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    },
    requestAuth,
  );

  if (sent.response.ok) return null;

  const body = (await sent.response.json().catch(() => null)) as {
    error?: unknown;
  } | null;

  if (sent.response.status === 401) {
    throw new Error(
      authBlockReason(sent.auth) ??
        "Sign with your wallet to disconnect this device.",
    );
  }

  const reason =
    typeof body?.error === "string" && body.error !== ""
      ? body.error
      : "Could not disconnect the device right now.";

  // 409 means "this provider owns its own link" - a real answer with a next
  // step in it, so it is returned rather than thrown.
  if (sent.response.status === 409) return reason;
  throw new Error(reason);
}

/**
 * True when a wallet is connected and we have not established what its device
 * can measure - unsigned, still loading, or the read failed.
 *
 * A surface that is about to take money must treat this as "do not know yet",
 * never as "fine". Browsing on it is harmless; staking on it is the trap.
 */
export function capabilityUnknown(
  options: ProviderOptions | undefined,
): boolean {
  if (options === undefined) return true;
  if (options.status !== "known") return true;
  // Defined AS the absence of an answer from viewerMetricsOf, rather than
  // re-derived from `selected`. Those two drifted apart and the gate trusted
  // the wrong one: providerIdFor never returns null - it falls back to a
  // default - so `selected` is set for every signed wallet, including one that
  // has linked nothing. capabilityUnknown then said "known" while
  // viewerMetricsOf said "null", and null plus not-pending is exactly the pair
  // splitByVerifiability reads as "logged-out visitor, hold nothing back".
  // A wallet with no device could join a wearable pool, pay, then link a
  // device that cannot measure it.
  return viewerMetricsOf(options) === null;
}

/**
 * True when the capability is unknown because nothing is linked, rather than
 * because we have not asked. Different problem, different next action: signing
 * cannot help somebody who has no device.
 *
 * A linked device that has not synced, or that the provider will not describe
 * right now, is NOT this case (see capabilityHoldOf). It used to be, and the
 * lobby told a player with a working Junction link to "pair a sensor" while
 * the character card beside it said the sensor was linked.
 */
export function capabilityNeedsDevice(
  options: ProviderOptions | undefined,
): boolean {
  return (
    options !== undefined &&
    options.status === "known" &&
    viewerMetricsOf(options) === null &&
    capabilityHoldOf(options) === null
  );
}

/** True specifically when a signature would answer the question. */
export function capabilityNeedsSignature(
  options: ProviderOptions | undefined,
): boolean {
  return options?.status === "unauthenticated";
}
