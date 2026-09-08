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
import { isProviderId, type ProviderId } from "@/lib/wearable-providers";
import type { WearableMetric } from "@/lib/wearable-goal";
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
  constructor(instructions: string) {
    super("This device is connected from the phone app, not the browser.");
    this.name = "PhoneLinkRequiredError";
    this.instructions = instructions;
  }
}

/** Where the connect flow wants to send the user. */
interface LinkTarget {
  provider: ProviderId | null;
  /** "app" means the link is completed in a phone app, not this browser. */
  kind: "oauth" | "app";
  linkUrl: string | null;
  instructions: string | null;
}

/**
 * Ask our route for a fresh connect target. Surfaces the route's honest error
 * (a down, unconfigured, or unauthorized provider) rather than a bare status.
 */
export async function fetchLinkTarget(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
  provider?: ProviderId,
): Promise<LinkTarget> {
  const sent = await fetchWithWalletAuth(
    "/api/wearable/link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        provider === undefined ? { address } : { address, provider },
      ),
    },
    requestAuth,
  );

  const body = (await sent.response.json().catch(() => null)) as {
    provider?: unknown;
    kind?: unknown;
    linkUrl?: unknown;
    instructions?: unknown;
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
 */
export async function startWearableLink(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
  provider?: ProviderId,
): Promise<void> {
  const popup = window.open("about:blank", "_blank");
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
    target = await fetchLinkTarget(address, requestAuth, provider);
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
      target.instructions ??
        "Open the GoHealthMe app on your phone to finish connecting this device.",
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
   * What this WALLET's actual hardware has produced, or null when the declared
   * list is already accurate for every device. The gate prefers this: Junction
   * declares a sleep score even for a tracker that has none, and a phone
   * provider declares sleep even for somebody with no watch.
   */
  observedMetrics: WearableMetric[] | null;
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

function parseOptions(payload: unknown): ProviderOptions {
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
  // Observed beats declared. This is the whole point: the declared list is
  // what the integration can serve, and the gate has to answer for the device
  // this person is actually wearing. Null means declared is already accurate.
  return active.observedMetrics ?? active.metrics;
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
 */
export function capabilityNeedsDevice(
  options: ProviderOptions | undefined,
): boolean {
  return (
    options !== undefined &&
    options.status === "known" &&
    viewerMetricsOf(options) === null
  );
}

/** True specifically when a signature would answer the question. */
export function capabilityNeedsSignature(
  options: ProviderOptions | undefined,
): boolean {
  return options?.status === "unauthenticated";
}
