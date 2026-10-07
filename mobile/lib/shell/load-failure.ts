// What the fallback says and does when the WebView reports a page that would
// not load.
//
// react-native-webview raises the same error for every main-frame failure:
// GoHealthMe itself offline at launch, or a third-party page the site sent
// the player to (WHOOP's login round trip, Junction's connect page). The two
// need different lines and different ways back, and the WebView gives the
// shell two facts to tell them apart: the URL whose load started last (what
// failed) and the URL it still holds (what is underneath the error). A
// provisional load that fails leaves the previous page in place, so when that
// is GoHealthMe a reload brings the player straight back to it; when a
// third-party page took over before dying, the way back is the site itself.
//
// Pure, so vitest covers the rules.

import { isOnOrigin, originOf } from "./bridge";
import { hostOf } from "./route-request";

export interface LoadFailure {
  /** The host that would not load, or null when it was GoHealthMe itself. */
  host: string | null;
  /** Reload what the WebView holds (GoHealthMe), or leave a third-party page for the site. */
  recovery: "reload" | "home";
}

/**
 * @param requestedUrl the URL whose load started last, the one that failed
 * @param documentUrl  the URL the WebView holds now, "" when nothing has loaded yet
 * @param siteOrigin   the site's origin, from originOf
 */
export function describeLoadFailure(requestedUrl: string, documentUrl: string, siteOrigin: string): LoadFailure {
  const offSite = originOf(requestedUrl) !== null && !isOnOrigin(requestedUrl, siteOrigin);
  const host = offSite ? hostOf(requestedUrl) : null;
  const siteUnderneath = documentUrl === "" || isOnOrigin(documentUrl, siteOrigin);
  return { host, recovery: siteUnderneath ? "reload" : "home" };
}
