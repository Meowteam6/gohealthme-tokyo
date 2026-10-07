// The sign-in option stack rendered to markup. Pinned: in a browser the stack
// is Base first, then email, then your own wallet as a quiet link; inside the
// iPhone app (lib/shell.ts) it is email only, with one honest line for the
// accounts that cannot sign in there, said before anything is typed. The
// same stack backs every sign-in surface, so this is the one place to pin it.

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dynamic-labs/sdk-react-core", () => ({
  useConnectWithOtp: () => ({
    connectWithEmail: async () => undefined,
    verifyOneTimePassword: async () => undefined,
    retryOneTimePassword: async () => undefined,
  }),
}));
vi.mock("@/lib/wallet", () => ({
  useEmbeddedWallet: () => ({ address: null, authenticated: false, ready: true, login: () => undefined }),
}));
vi.mock("@/lib/useBaseAccountConnect", () => ({
  useBaseAccountConnect: () => ({ connectBase: async () => undefined, baseBusy: false }),
}));
vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  DYNAMIC_CONFIGURED: true,
}));

const { default: SignInPanel, SignInOptions } = await import("@/components/SignInPanel");

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const SAFARI_LINE =
  "Signed in with Base or your own wallet before? Open gohealthme-tokyo.vercel.app in Safari for that account.";

describe("SignInOptions", () => {
  it("offers Base, email and your own wallet in a browser", () => {
    const t = text(renderToStaticMarkup(createElement(SignInOptions)));
    expect(t).toContain("Sign in with Base");
    expect(t).toContain("or use email");
    expect(t).toContain("Email me a sign-in code");
    expect(t).toContain("I already have a wallet");
    expect(t).not.toContain(SAFARI_LINE);
  });

  it("is email only inside the iPhone app, with the one honest line before anything is typed", () => {
    const html = renderToStaticMarkup(createElement(SignInOptions, { shell: true }));
    const t = text(html);
    expect(t).not.toContain("Sign in with Base");
    expect(t).not.toContain("or use email");
    expect(t).not.toContain("I already have a wallet");
    expect(t).not.toMatch(/fingerprint|face/);
    expect(t).toContain("Email me a sign-in code");
    expect(t).toContain("Your wallet is made from your email.");
    expect(t).toContain(SAFARI_LINE);
    // The email code is the primary action here, not the second choice.
    const emailButton = html.indexOf("Email me a sign-in code");
    const primary = html.lastIndexOf("<button", emailButton);
    expect(html.slice(primary, emailButton)).not.toMatch(/secondary/);
  });

  it("renders the same shell stack under the panel's heading", () => {
    const t = text(renderToStaticMarkup(createElement(SignInPanel, { surface: "card", shell: true })));
    expect(t).toContain("Sign in");
    expect(t).not.toContain("Sign in with Base");
    expect(t).toContain(SAFARI_LINE);
  });

  it("keeps the product's words in both layouts", () => {
    for (const shell of [false, true]) {
      const t = text(renderToStaticMarkup(createElement(SignInOptions, { shell })));
      expect(t).not.toMatch(/[!—]/);
      expect(t).not.toMatch(/\b(runs?|pools?|dares?|bets?|wagers?|odds|winners?)\b/i);
    }
  });
});
