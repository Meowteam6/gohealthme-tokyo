import { describe, expect, it } from "vitest";

// The two-way channel between the page and the shell. Page -> shell is one
// JSON string through window.ReactNativeWebView.postMessage; it is parsed
// strictly, because the WebView also visits third-party OAuth pages that
// must never be able to drive native pairing. Shell -> page is a script the
// shell injects, dispatching one CustomEvent on window.

import { isOnOrigin, navigateScript, originOf, parsePageMessage, shellEventScript } from "./bridge";

describe("parsePageMessage", () => {
  it("accepts the five known page messages, versioned", () => {
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "hello" }))).toEqual({ type: "hello" });
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "pair", code: "ABCD-EFGH" }))).toEqual({
      type: "pair",
      code: "ABCD-EFGH",
    });
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "sync" }))).toEqual({ type: "sync" });
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "open-settings" }))).toEqual({
      type: "open-settings",
    });
    expect(
      parsePageMessage(JSON.stringify({ v: 1, type: "open-browser", url: "https://link.tryvital.io/x" })),
    ).toEqual({ type: "open-browser", url: "https://link.tryvital.io/x" });
  });

  it("trims the code and drops extra fields", () => {
    expect(
      parsePageMessage(JSON.stringify({ v: 1, type: "pair", code: " abcd-efgh ", extra: 1 })),
    ).toEqual({ type: "pair", code: "abcd-efgh" });
  });

  it("rejects anything that is not a versioned, known message", () => {
    expect(parsePageMessage(undefined)).toBeNull();
    expect(parsePageMessage(42)).toBeNull();
    expect(parsePageMessage("")).toBeNull();
    expect(parsePageMessage("not json")).toBeNull();
    expect(parsePageMessage("null")).toBeNull();
    expect(parsePageMessage("[]")).toBeNull();
    expect(parsePageMessage('"pair"')).toBeNull();
    expect(parsePageMessage(JSON.stringify({ type: "pair", code: "ABCD-EFGH" }))).toBeNull();
    expect(parsePageMessage(JSON.stringify({ v: 2, type: "pair", code: "ABCD-EFGH" }))).toBeNull();
    expect(parsePageMessage(JSON.stringify({ v: "1", type: "pair", code: "ABCD-EFGH" }))).toBeNull();
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "reset" }))).toBeNull();
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "pair" }))).toBeNull();
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "pair", code: "" }))).toBeNull();
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "pair", code: 12345678 }))).toBeNull();
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "pair", code: "x".repeat(65) }))).toBeNull();
    expect(parsePageMessage(JSON.stringify({ v: 1, type: "open-browser" }))).toBeNull();
    expect(
      parsePageMessage(JSON.stringify({ v: 1, type: "open-browser", url: "javascript:alert(1)" })),
    ).toBeNull();
    expect(
      parsePageMessage(JSON.stringify({ v: 1, type: "open-browser", url: "gohealthme://pair?code=X" })),
    ).toBeNull();
  });
});

describe("shellEventScript", () => {
  it("dispatches one gohealthme:shell CustomEvent with the detail and ends in true", () => {
    const script = shellEventScript({ type: "browser-closed" });
    expect(script).toBe(
      "window.dispatchEvent(new CustomEvent('gohealthme:shell',{detail:{\"type\":\"browser-closed\"}}));true;",
    );
  });

  it("carries status and pair-status details as JSON", () => {
    expect(
      shellEventScript({
        type: "status",
        healthAvailable: true,
        paired: { address: "0xabc" },
        healthAsked: false,
      }),
    ).toContain('{"type":"status","healthAvailable":true,"paired":{"address":"0xabc"},"healthAsked":false}');
    expect(
      shellEventScript({
        type: "pair-status",
        status: "synced",
        stored: 75,
        covered: 31,
        daysWithData: 30,
        unread: [],
      }),
    ).toContain('"status":"synced","stored":75,"covered":31,"daysWithData":30,"unread":[]');
    expect(
      shellEventScript({
        type: "pair-status",
        status: "failed",
        reason: "invalid-code",
        message: "That code did not work.",
      }),
    ).toContain('"reason":"invalid-code"');
  });

  it("cannot break out of the script with a string in the detail", () => {
    const script = shellEventScript({
      type: "pair-status",
      status: "failed",
      reason: "server",
      message: "</script>'));alert(1);//" + String.fromCharCode(0x2028),
    });
    expect(script.startsWith("window.dispatchEvent(new CustomEvent('gohealthme:shell',{detail:")).toBe(true);
    expect(script.endsWith("}));true;")).toBe(true);
    expect(script).not.toContain("</script>");
    expect(script).not.toContain(String.fromCharCode(0x2028));
  });
});

describe("originOf and isOnOrigin", () => {
  it("reads scheme, host and port, lower-cased, default ports dropped", () => {
    expect(originOf("https://gohealthme-tokyo.vercel.app/challenges?x=1")).toBe(
      "https://gohealthme-tokyo.vercel.app",
    );
    expect(originOf("HTTPS://GoHealthMe-Tokyo.vercel.app:443/")).toBe("https://gohealthme-tokyo.vercel.app");
    expect(originOf("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(originOf("http://localhost:80/")).toBe("http://localhost");
    expect(originOf("https://user:pw@host.test/path")).toBe("https://host.test");
  });

  it("returns null for anything that is not an http(s) URL", () => {
    expect(originOf("")).toBeNull();
    expect(originOf("about:blank")).toBeNull();
    expect(originOf("gohealthme://pair?code=X")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });

  it("matches a URL against the site origin, and nothing else", () => {
    const site = "https://gohealthme-tokyo.vercel.app";
    expect(isOnOrigin("https://gohealthme-tokyo.vercel.app/", site)).toBe(true);
    expect(isOnOrigin("https://gohealthme-tokyo.vercel.app/c/abc?x=1#y", site)).toBe(true);
    expect(isOnOrigin("https://gohealthme-tokyo.vercel.app.evil.test/", site)).toBe(false);
    expect(isOnOrigin("https://evil.test/?u=https://gohealthme-tokyo.vercel.app", site)).toBe(false);
    expect(isOnOrigin("http://gohealthme-tokyo.vercel.app/", site)).toBe(false);
    expect(isOnOrigin("https://api.prod.whoop.com/oauth", site)).toBe(false);
    expect(isOnOrigin("about:blank", site)).toBe(false);
    expect(isOnOrigin(undefined, site)).toBe(false);
  });
});

describe("navigateScript", () => {
  it("replaces the current page with the given URL and ends in a statement WKWebView accepts", () => {
    expect(navigateScript("https://gohealthme-tokyo.vercel.app")).toBe(
      'location.replace("https://gohealthme-tokyo.vercel.app");true;',
    );
  });

  it("quotes the URL so nothing in it can end the statement early", () => {
    const script = navigateScript('https://x.test/?q="a";alert(1);//');
    expect(script.startsWith("location.replace(")).toBe(true);
    expect(script.endsWith(");true;")).toBe(true);
    expect(script).toContain('\\"a\\"');
  });
});
