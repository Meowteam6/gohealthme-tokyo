import { describe, expect, it, vi } from "vitest";

// Where each navigation the WebView asks about goes. The rule of thumb this
// file pins: same-frame navigations stay in the WebView (OAuth redirects
// included), the website's own pairing link becomes native pairing, and
// anything that is really a hop to another app leaves through the OS.

vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({
  Linking: { canOpenURL: vi.fn(async () => false), openURL: vi.fn(async () => undefined) },
  StyleSheet: { create: (styles: unknown) => styles },
  View: () => null,
  ActivityIndicator: () => null,
  Text: () => null,
  Platform: { OS: "ios" },
}));

import { Linking } from "react-native";
import { createOnShouldStartLoadWithRequest, defaultOriginWhitelist } from "react-native-webview/src/WebViewShared";

import { ORIGIN_WHITELIST, classify } from "./route-request";

const top = (url: string, navigationType = "click") => ({ url, isTopFrame: true, navigationType });

describe("classify", () => {
  it("lets every non-top-frame request through (the Turnkey and Dynamic iframes)", () => {
    expect(classify({ url: "https://auth.turnkey.com/frame", isTopFrame: false })).toBe("allow");
    expect(classify({ url: "gohealthme://pair?code=ABCD-EFGH", isTopFrame: false })).toBe("allow");
    expect(classify({ url: "wc:abc@2?relay=x", isTopFrame: false })).toBe("allow");
  });

  it("turns the website's pairing link into native pairing", () => {
    expect(classify(top("gohealthme://pair?code=ABCD-EFGH"))).toEqual({
      kind: "pair",
      code: "ABCD-EFGH",
    });
    expect(classify(top("gohealthme://pair?x=1&code=ABCD%2DEFGH"))).toEqual({
      kind: "pair",
      code: "ABCD-EFGH",
    });
  });

  it("hands wallet and World App schemes to the OS", () => {
    for (const url of [
      "wc:abc123@2?relay-protocol=irn&symKey=00",
      "metamask://wc?uri=wc%3Aabc",
      "cbwallet://wsegue?x=1",
      "worldapp://verify?x=1",
      "gohealthme://other?code=ABCD-EFGH",
    ]) {
      expect(classify(top(url))).toEqual({ kind: "system", url });
    }
  });

  it("hands IDKit's mobile anchor to the OS so iOS routes it to World App", () => {
    for (const url of [
      "https://world.org/verify?t=wld&i=abc&k=def",
      "https://www.world.org/verify/abc",
      "https://worldcoin.org/verify?t=wld",
      "https://www.worldcoin.org/verify",
    ]) {
      expect(classify(top(url))).toEqual({ kind: "system", url });
    }
    // The rest of those sites is ordinary web.
    expect(classify(top("https://world.org/"))).toBe("allow");
    expect(classify(top("https://worldcoin.org/blog/verify-your-humanity"))).toBe("allow");
    expect(classify(top("https://world.org.evil.test/verify"))).toBe("allow");
  });

  it("hands wallet universal links on *.app.link to the OS", () => {
    for (const url of [
      "https://metamask.app.link/wc?uri=wc%3Aabc",
      "https://rainbow.app.link/open?x=1",
    ]) {
      expect(classify(top(url))).toEqual({ kind: "system", url });
    }
    expect(classify(top("https://app.link.evil.test/"))).toBe("allow");
    expect(classify(top("https://notapp.link/"))).toBe("allow");
  });

  it("keeps same-frame OAuth redirects inside the WebView", () => {
    expect(classify(top("https://gohealthme-tokyo.vercel.app/api/whoop/login", "other"))).toBe("allow");
    expect(classify(top("https://api.prod.whoop.com/oauth/oauth2/auth?client_id=x", "other"))).toBe(
      "allow",
    );
    expect(classify(top("https://gohealthme-tokyo.vercel.app/api/whoop/callback?code=1", "other"))).toBe(
      "allow",
    );
    expect(classify(top("https://link.tryvital.io/connect/abc", "click"))).toBe("allow");
    expect(classify(top("http://localhost:3000/challenges", "other"))).toBe("allow");
  });

  it("keeps document-internal pseudo URLs in the WebView", () => {
    for (const url of ["about:blank", "about:srcdoc", "blob:https://x/1", "data:text/html,hi"]) {
      expect(classify(top(url))).toBe("allow");
    }
  });

  it("allows anything it cannot parse", () => {
    expect(classify(top(""))).toBe("allow");
    expect(classify(top("not a url"))).toBe("allow");
  });
});

// react-native-webview checks its originWhitelist BEFORE it asks
// onShouldStartLoadWithRequest. A URL the whitelist rejects goes to
// Linking.canOpenURL, which is always false on iOS without
// LSApplicationQueriesSchemes, and the navigation is dropped: classify never
// hears of it. These tests run the library's real gate, so the whitelist the
// shell passes is proven to hand every request to classify.
describe("the WebView's whitelist in front of classify", () => {
  const PAIR = "gohealthme://pair?code=ABCD-EFGH";
  const LOCK = 7;

  const gate = (whitelist: readonly string[]) => {
    const loadRequest = vi.fn();
    const handler = vi.fn((request: { url: string; isTopFrame: boolean; navigationType: string }) =>
      classify(request) === "allow",
    );
    const run = createOnShouldStartLoadWithRequest(loadRequest, whitelist, handler as never);
    return {
      loadRequest,
      handler,
      send: (url: string) =>
        run({ nativeEvent: { url, isTopFrame: true, navigationType: "click", lockIdentifier: LOCK } } as never),
    };
  };

  it("with the library default, the pairing link never reaches classify (the bug)", () => {
    const g = gate(defaultOriginWhitelist);
    g.send(PAIR);
    expect(g.handler).not.toHaveBeenCalled();
    expect(Linking.canOpenURL).toHaveBeenCalledWith(PAIR);
    expect(g.loadRequest).toHaveBeenCalledWith(false, PAIR, LOCK);
  });

  it("with ORIGIN_WHITELIST every request reaches classify and its decision is what the WebView gets", () => {
    vi.mocked(Linking.canOpenURL).mockClear();
    const g = gate(ORIGIN_WHITELIST);
    const cases: Array<[string, boolean]> = [
      [PAIR, false],
      ["wc:abc123@2?relay-protocol=irn&symKey=00", false],
      ["metamask://wc?uri=wc%3Aabc", false],
      ["worldapp://verify?x=1", false],
      ["https://world.org/verify?t=wld&i=abc&k=def", false],
      ["https://gohealthme-tokyo.vercel.app/challenges", true],
      ["https://api.prod.whoop.com/oauth/oauth2/auth?client_id=x", true],
      ["about:blank", true],
      ["blob:https://gohealthme-tokyo.vercel.app/1", true],
      ["data:text/html,hi", true],
    ];
    for (const [url, allowed] of cases) {
      g.send(url);
      expect(g.handler).toHaveBeenLastCalledWith(expect.objectContaining({ url }));
      expect(g.loadRequest).toHaveBeenLastCalledWith(allowed, url, LOCK);
    }
    expect(g.handler).toHaveBeenCalledTimes(cases.length);
    expect(Linking.canOpenURL).not.toHaveBeenCalled();
  });
});
