// The Apple Watch pairing card, rendered to markup with fixture props and a
// seeded provider read. Pinned: on an iPhone the deep link leads and the code
// is secondary; on a computer the code leads; an expired code is one line and
// one tap; the paired flip comes from the provider list, never from a button
// the player presses; and the copy keeps the product's words.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseOptions, providerOptionsQueryKey, type ProviderOptions } from "@/lib/wearable-connect";

vi.mock("@/lib/wallet", () => ({
  useEmbeddedWallet: () => ({ address: null, authenticated: false, ready: true }),
}));
vi.mock("@/lib/useWalletAuth", () => ({
  useWalletAuth: () => () => Promise.resolve({ kind: "no-wallet" }),
}));

const { default: PhonePairPanel } = await import("@/components/PhonePairPanel");

const ADDRESS = "0x8a39c0ffee000000000000000000000000006141" as const;
const LIVE = {
  code: "7KQ4MN9P",
  deepLink: "gohealthme://pair?code=7KQ4MN9P",
  expiresAt: Date.now() + 9 * 60_000,
};
const INSTALL = "https://testflight.apple.com/join/abc";

function apple(over: Record<string, unknown>): ProviderOptions {
  return parseOptions({
    selected: "apple",
    providers: [
      {
        id: "apple",
        label: "Apple Health",
        configured: true,
        connected: true,
        metrics: ["sleep_efficiency", "sleep_hours", "steps", "workouts"],
        observedMetrics: null,
        capability: "observed",
        ...over,
      },
    ],
  });
}

function render(
  props: Omit<Parameters<typeof PhonePairPanel>[0], "poll">,
  seeded?: ProviderOptions,
): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seeded !== undefined) client.setQueryData(providerOptionsQueryKey(ADDRESS), seeded);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(PhonePairPanel, { ...props, poll: false }),
    ),
  );
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const steps = { instructions: "Server fallback.", pairing: LIVE, installUrl: INSTALL };

describe("PhonePairPanel", () => {
  it("leads with the deep link on an iPhone, the install link second, the code after", () => {
    const html = render({ steps, address: ADDRESS, platform: "iphone" });
    const deepLink = html.indexOf('href="gohealthme://pair?code=7KQ4MN9P"');
    const install = html.indexOf(`href="${INSTALL}"`);
    const code = html.indexOf("7KQ4MN9P</p>");
    expect(deepLink).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(deepLink);
    expect(code).toBeGreaterThan(install);
    const t = text(html);
    expect(t).toContain("Open the GoHealthMe app");
    expect(t).toContain("Get the app");
    expect(t).toContain("On a computer? Type this code in the app.");
    expect(t).toMatch(/Works once, until \d/);
    expect(t).toContain("Get a new code");
  });

  it("leads with the code on a computer and offers no deep link there", () => {
    const html = render({ steps, address: ADDRESS, platform: "other" });
    expect(html).not.toContain("gohealthme://");
    expect(html).toContain("7KQ4MN9P");
    const t = text(html);
    expect(t).toContain("Type this code in the GoHealthMe app on your iPhone.");
    expect(t).toContain("Get the app for iPhone");
    expect(html).toContain(`href="${INSTALL}"`);
  });

  it("says what happens to the data, in one line, on either device", () => {
    for (const platform of ["iphone", "other"] as const) {
      const t = text(render({ steps, address: ADDRESS, platform }));
      expect(t).toContain("reads Health on your iPhone");
      expect(t).toContain("Only daily totals leave the phone");
    }
  });

  it("makes an expired code one line and one tap", () => {
    const expired = { ...steps, pairing: { ...LIVE, expiresAt: Date.now() - 1 } };
    const html = render({ steps: expired, address: ADDRESS, platform: "iphone" });
    const t = text(html);
    expect(t).toContain("That code expired");
    expect(t).toContain("Get a new code");
    // The dead code and its dead deep link are gone, not greyed.
    expect(html).not.toContain("7KQ4MN9P");
    expect(html).not.toContain("gohealthme://");
  });

  it("flips to paired off the provider read, naming what the Watch counts", () => {
    const html = render(
      { steps, address: ADDRESS, platform: "iphone", repair: false },
      apple({ observedMetrics: ["sleep_hours", "workouts"] }),
    );
    const t = text(html);
    expect(t).toContain("Apple Watch is paired");
    expect(t).toContain("Counts hours of sleep and workouts.");
    expect(html).not.toContain("7KQ4MN9P");
    expect(html).not.toContain("gohealthme://");
  });

  it("holds on a redeemed code until the first day arrives, and says what to open", () => {
    // The code was minted unpaired (repair false); the phone then redeemed
    // it and nothing has arrived yet.
    const t = text(
      render(
        { steps, address: ADDRESS, platform: "iphone", repair: false },
        apple({ capability: "awaiting-sync" }),
      ),
    );
    expect(t).toContain("Waiting on its first sync");
    expect(t).toContain("Open the GoHealthMe app on your iPhone");
  });

  it("offers a new code and the install link when no code was minted, never a sentence about a code that is not there", () => {
    const html = render({ steps: { ...steps, pairing: null }, address: ADDRESS, platform: "other" });
    const t = text(html);
    expect(t).not.toContain("Server fallback.");
    expect(t).toContain("Get a new code");
    expect(t).toContain("Nothing changed");
    expect(html).toContain(`href="${INSTALL}"`);
  });

  it("keeps the code on screen for a re-pair and says the new phone replaces the old one", () => {
    // The wallet already has a phone. The provider read says paired before and
    // after the new phone redeems the code, so the card cannot flip on its
    // own; it keeps the code, says what the code does, and never claims the
    // pairing it was just asked to replace.
    const html = render(
      { steps, address: ADDRESS, platform: "iphone", repair: true },
      apple({ observedMetrics: ["sleep_hours", "workouts"] }),
    );
    const t = text(html);
    expect(html).toContain('href="gohealthme://pair?code=7KQ4MN9P"');
    expect(html).toContain("7KQ4MN9P");
    expect(t).toContain("Pair your iPhone again");
    expect(t).toMatch(/replaces/);
    expect(t).not.toContain("Apple Watch is paired");
    expect(t).not.toMatch(/flips on its own/);
  });

  it("reads a re-pair off the provider list when the caller does not say", () => {
    // The dashboard hands over the code without the flag. Apple already
    // paired at mount means this code is a re-pair.
    const html = render(
      { steps, address: ADDRESS, platform: "other" },
      apple({ observedMetrics: ["sleep_hours"] }),
    );
    expect(html).toContain("7KQ4MN9P");
    expect(text(html)).not.toContain("Apple Watch is paired");
  });

  it("names the iPhone, not a Watch, when the phone synced and no sleep arrived", () => {
    const t = text(
      render(
        { steps, address: ADDRESS, platform: "iphone", repair: false },
        apple({ observedMetrics: ["steps"] }),
      ),
    );
    expect(t).toContain("Your iPhone is paired");
    expect(t).not.toContain("Apple Watch is paired");
    expect(t).toMatch(/Apple Watch worn to bed/);
  });

  it("never offers a button that claims the pairing for the phone", () => {
    for (const platform of ["iphone", "other"] as const) {
      expect(text(render({ steps, address: ADDRESS, platform }))).not.toMatch(/I paired it/i);
    }
  });

  it("keeps the product's words in every state", () => {
    const states = [
      render({ steps, address: ADDRESS, platform: "iphone" }),
      render({ steps, address: ADDRESS, platform: "other" }),
      render({ steps: { ...steps, pairing: { ...LIVE, expiresAt: 1 } }, address: ADDRESS, platform: "iphone" }),
      render({ steps, address: ADDRESS, platform: "iphone", repair: false }, apple({ observedMetrics: ["sleep_hours"] })),
      render({ steps, address: ADDRESS, platform: "iphone", repair: false }, apple({ capability: "awaiting-sync" })),
      render({ steps, address: ADDRESS, platform: "iphone", repair: false }, apple({ capability: "unknown" })),
      render({ steps: { ...steps, pairing: null, instructions: "Open the app." }, address: ADDRESS, platform: "other" }),
      render({ steps, address: ADDRESS, platform: "iphone", repair: true }, apple({ observedMetrics: ["sleep_hours"] })),
      render({ steps, address: ADDRESS, platform: "other", repair: true }, apple({ observedMetrics: ["sleep_hours"] })),
      render({ steps, address: ADDRESS, platform: "iphone", repair: false }, apple({ observedMetrics: ["steps"] })),
    ];
    for (const html of states) {
      const t = text(html);
      expect(t).not.toMatch(/[!—]/);
      expect(t).not.toMatch(/\b(runs?|pools?|dares?|bets?|wagers?|odds|winners?)\b/i);
      expect(t).not.toMatch(/env|undefined|null|capability|[A-Z_]{6,}/);
    }
  });
});
