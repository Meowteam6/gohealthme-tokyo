// Popup-safe Junction (Vital) Link connect flow, shared by every surface that
// lets a user link a real wearable (the pool-detail WearableCheck and the
// dashboard connect prompt). It lives here so the one correct implementation of
// the gesture-synchronous popup and the blocked-popup fallback cannot drift
// between callers.

/**
 * Raised when the browser blocked even the synchronous popup. Carries the real
 * Junction Link URL so the caller can render a link the user taps directly - a
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

/** Ask our route for a fresh Junction Link URL. Surfaces the route's honest
 *  error (a down or unconfigured provider) rather than a bare status code. */
export async function fetchLinkUrl(address: `0x${string}`): Promise<string> {
  const res = await fetch("/api/junction/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const body = (await res.json().catch(() => null)) as {
    linkUrl?: string;
    error?: string;
  } | null;
  if (!res.ok) {
    const detail =
      body !== null && typeof body.error === "string" && body.error !== ""
        ? body.error
        : `Link token request failed (${res.status}).`;
    throw new Error(detail);
  }
  if (body === null || typeof body.linkUrl !== "string") {
    throw new Error("The connect flow did not return a link URL.");
  }
  return body.linkUrl;
}

/**
 * Open Junction Link to connect WHOOP, Oura, Fitbit, Garmin.
 *
 * The window is opened SYNCHRONOUSLY inside the click's user-gesture tick. The
 * old order - `await fetch(...)` then `window.open(...)` - opened the window a
 * macrotask after the gesture, so the popup blocker killed it ("Popup was
 * blocked"). Here a blank window opens first and is navigated once the link URL
 * resolves. `noopener` is dropped on purpose: with it, window.open returns null
 * and there is no handle to navigate, so the opener reference is severed by
 * hand before the cross-origin navigation instead. If the browser blocked even
 * the synchronous open, `popup` is null and PopupBlockedError hands the URL
 * back so the UI can offer a link the user activates directly.
 */
export async function openJunctionConnect(
  address: `0x${string}`,
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

  let linkUrl: string;
  try {
    linkUrl = await fetchLinkUrl(address);
  } catch (err) {
    if (popup !== null && !popup.closed) popup.close();
    throw err;
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
