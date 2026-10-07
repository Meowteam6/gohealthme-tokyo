import { describe, expect, it, vi } from "vitest";

// The WebView raises one error for every main-frame failure, whether
// GoHealthMe itself would not load or a third-party page the site sent the
// player to (WHOOP's login, Junction's connect page). The fallback must name
// the right one and offer the right way back: reload what the WebView holds
// when that is GoHealthMe, leave a third-party page for the site otherwise.

vi.mock("expo-secure-store", () => ({}));

import { describeLoadFailure } from "./load-failure";

const SITE = "https://gohealthme-tokyo.vercel.app";
const WHOOP = "https://api.prod.whoop.com/oauth/oauth2/auth?client_id=x";

describe("describeLoadFailure", () => {
  it("the site failing at launch is GoHealthMe, and Try again reloads", () => {
    expect(describeLoadFailure(SITE, "", SITE)).toEqual({ host: null, recovery: "reload" });
  });

  it("a site page failing over another site page is GoHealthMe, and Try again reloads", () => {
    expect(describeLoadFailure(`${SITE}/challenges/8`, `${SITE}/`, SITE)).toEqual({
      host: null,
      recovery: "reload",
    });
  });

  it("a third-party page that failed before it showed names its host; the site underneath reloads", () => {
    expect(describeLoadFailure(WHOOP, `${SITE}/challenges/8`, SITE)).toEqual({
      host: "api.prod.whoop.com",
      recovery: "reload",
    });
  });

  it("a third-party page that failed after it took over names its host and is left for the site", () => {
    expect(describeLoadFailure(WHOOP, WHOOP, SITE)).toEqual({
      host: "api.prod.whoop.com",
      recovery: "home",
    });
    expect(describeLoadFailure("https://link.tryvital.io/connect/abc", "https://link.tryvital.io/connect/abc", SITE)).toEqual({
      host: "link.tryvital.io",
      recovery: "home",
    });
  });

  it("a site page failing while a third-party page holds the WebView is GoHealthMe, and the way back is home", () => {
    expect(describeLoadFailure(`${SITE}/api/whoop/callback?code=1`, WHOOP, SITE)).toEqual({
      host: null,
      recovery: "home",
    });
  });

  it("treats what it cannot parse as the site", () => {
    expect(describeLoadFailure("", "", SITE)).toEqual({ host: null, recovery: "reload" });
    expect(describeLoadFailure("not a url", "", SITE)).toEqual({ host: null, recovery: "reload" });
  });
});
