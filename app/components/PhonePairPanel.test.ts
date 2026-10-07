// The Apple Watch pairing card, rendered to markup with fixture props and a
// seeded provider read. Pinned: on an iPhone the deep link leads and the code
// is secondary; on a computer the code leads; an expired code is one line and
// one tap; the paired flip comes from the provider list, never from a button
// the player presses; and the copy keeps the product's words.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellPairStatus } from "@/lib/shell";
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
      render({ steps, address: ADDRESS, platform: "shell" }),
      render({ steps, address: ADDRESS, platform: "shell", shellPair: { status: "health-sheet" } }),
      render({ steps, address: ADDRESS, platform: "shell", shellPair: { status: "syncing" } }),
      render({ steps, address: ADDRESS, platform: "shell", shellPair: SYNCED_EMPTY }),
      render({ steps, address: ADDRESS, platform: "shell", shellPair: FAILED_CODE }),
      render({ steps, address: ADDRESS, platform: "shell", shellPair: FAILED_REVOKED }),
      render({ steps, address: ADDRESS, platform: "shell", repair: false }, apple({ capability: "awaiting-sync" })),
      render({ steps, address: ADDRESS, platform: "shell", healthAvailable: false }),
      render({ steps: { ...steps, pairing: null }, address: ADDRESS, platform: "shell" }),
    ];
    for (const html of states) {
      const t = text(html);
      expect(t).not.toMatch(/[!—]/);
      expect(t).not.toMatch(/\b(runs?|pools?|dares?|bets?|wagers?|odds|winners?)\b/i);
      expect(t).not.toMatch(/env|undefined|null|capability|[A-Z_]{6,}/);
    }
  });
});

// Inside the iPhone app (lib/shell.ts) the card hands the code to the shell
// and the shell pairs the phone it is running on. Pinned: no code, deep link
// or install link ever renders there; each report from the shell has its one
// line and its taps; the shell's word beats a stale provider read; and the
// paired flip still comes from the provider list.
const SYNCED_EMPTY: ShellPairStatus = { status: "synced", stored: 0, covered: 0, daysWithData: 0, unread: [] };
const SYNCED_DATA: ShellPairStatus = { status: "synced", stored: 75, covered: 31, daysWithData: 31, unread: [] };
const FAILED_CODE: ShellPairStatus = { status: "failed", reason: "invalid-code", message: "That code did not work. Codes last ten minutes and work once." };
const FAILED_REVOKED: ShellPairStatus = { status: "failed", reason: "revoked", message: "This iPhone is no longer paired." };
const FAILED_HEALTH: ShellPairStatus = { status: "failed", reason: "health-unreadable", message: "Health could not be read. Check Health access in Settings and try again." };

describe("PhonePairPanel inside the iPhone app", () => {
  it("shows no code, no deep link and no install link, only what the shell is doing", () => {
    const html = render({ steps, address: ADDRESS, platform: "shell" });
    expect(html).not.toContain("7KQ4MN9P");
    expect(html).not.toContain("gohealthme://");
    expect(html).not.toContain(INSTALL);
    const t = text(html);
    expect(t).toContain("Pair your Apple Watch");
    expect(t).toContain("reads Health on your iPhone");
    expect(t).toContain("Pairing this iPhone");
    expect(t).not.toContain("Get the app");
    expect(t).not.toContain("Type this code");
    expect(t).toContain("Get a new code");
  });

  it("walks the shell's reports: the Health sheet, the read, the sync", () => {
    expect(text(render({ steps, address: ADDRESS, platform: "shell", shellPair: { status: "health-sheet" } }))).toContain(
      "Allow Apple Health when iOS asks",
    );
    expect(text(render({ steps, address: ADDRESS, platform: "shell", shellPair: { status: "syncing" } }))).toContain(
      "Reading the last 30 days of Apple Health",
    );
    // Synced with data and the provider read not back yet: one line, no code.
    const synced = render({ steps, address: ADDRESS, platform: "shell", shellPair: SYNCED_DATA });
    expect(text(synced)).toContain("Synced");
    expect(synced).not.toContain("7KQ4MN9P");
  });

  it("flips to paired off the provider read once the shell has synced, re-pair included", () => {
    const t = text(
      render(
        { steps, address: ADDRESS, platform: "shell", repair: true, shellPair: SYNCED_DATA },
        apple({ observedMetrics: ["sleep_hours", "workouts"] }),
      ),
    );
    expect(t).toContain("Apple Watch is paired");
    expect(t).not.toContain("Pair your iPhone again");
  });

  it("keeps a re-pair on its own line until the shell has synced", () => {
    const t = text(
      render(
        { steps, address: ADDRESS, platform: "shell", repair: true, shellPair: { status: "syncing" } },
        apple({ observedMetrics: ["sleep_hours", "workouts"] }),
      ),
    );
    expect(t).toContain("Pair your iPhone again");
    expect(t).toMatch(/replaces/);
    expect(t).toContain("Reading the last 30 days of Apple Health");
    expect(t).not.toContain("Apple Watch is paired");
  });

  it("says a sync with nothing in it is not a pairing, with Try again and Open Settings", () => {
    const t = text(
      render(
        { steps, address: ADDRESS, platform: "shell", repair: false, shellPair: SYNCED_EMPTY },
        // The server kept the phone at awaiting-sync; the shell's word wins.
        apple({ capability: "awaiting-sync" }),
      ),
    );
    expect(t).toContain("Nothing synced");
    expect(t).toContain("Try again");
    expect(t).toContain("Open Settings");
    expect(t).not.toContain("Waiting on its first sync");
    expect(t).not.toContain("is paired");
  });

  it("names a code that did not work and offers a new one, never the server's sentence", () => {
    const t = text(render({ steps, address: ADDRESS, platform: "shell", shellPair: FAILED_CODE }));
    expect(t).toContain("That code did not work");
    expect(t).not.toContain("work once");
    expect(t).toContain("Get a new code");
  });

  it("carries the app's own words for Health it could not read, and for a revoked phone", () => {
    const health = text(render({ steps, address: ADDRESS, platform: "shell", shellPair: FAILED_HEALTH }));
    expect(health).toContain("Health could not be read");
    expect(health).toContain("Try again");
    const revoked = text(render({ steps, address: ADDRESS, platform: "shell", shellPair: FAILED_REVOKED }));
    expect(revoked).toContain("This iPhone is no longer paired");
    expect(revoked).toContain("Pair again");
  });

  it("tells a redeemed phone to allow Health, never to open an app it is already in", () => {
    const t = text(
      render(
        { steps, address: ADDRESS, platform: "shell", repair: false },
        apple({ capability: "awaiting-sync" }),
      ),
    );
    expect(t).toContain("Waiting on its first sync");
    expect(t).toContain("Allow Apple Health when iOS asks");
    expect(t).not.toContain("Open the GoHealthMe app");
  });

  it("says Apple Health is not available before anything is handed over", () => {
    const html = render({ steps, address: ADDRESS, platform: "shell", healthAvailable: false });
    expect(text(html)).toContain("Apple Health is not available on this device");
    expect(html).not.toContain("7KQ4MN9P");
    expect(text(html)).not.toContain("Pairing this iPhone");
  });

  it("offers a new code without an install link when no code was minted", () => {
    const html = render({ steps: { ...steps, pairing: null }, address: ADDRESS, platform: "shell" });
    expect(text(html)).toContain("Get a new code");
    expect(html).not.toContain(INSTALL);
  });
});
