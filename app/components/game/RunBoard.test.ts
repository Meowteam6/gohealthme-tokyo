// A locked board on a page with several of them. One Verify wallet tap
// unlocks every wallet-gated card (lib/session-proof.ts re-reads them all), so
// the dashboard offers that button once, in the first locked card, and every
// other locked card says its data is locked without a second button. These
// tests pin the three pieces: the board renders either shape, the dashboard's
// pick of which card carries the button, and the read the dashboard watches
// being the board's own cache entry.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PoolInfo } from "@/lib/contract";
import { providerQueryKey, type ProviderState } from "@/lib/wearable-provider";

const ADDRESS = "0x8a39c0ffee000000000000000000000000006141" as const satisfies `0x${string}`;

// The wallet hooks reach Dynamic's SDK, which has no business in a node
// render. A board never prompts on load, so a requester that answers
// "unsigned" is the honest stand-in.
vi.mock("@/lib/useWalletAuth", () => ({
  useWalletAuth: () => async () => ({ kind: "unsigned" }),
}));
vi.mock("@/lib/wallet", () => ({
  useEmbeddedWallet: () => ({ address: ADDRESS, sessionProofPossible: true }),
}));

const { default: RunBoard, runNightsQuery, verifyActionOwner } = await import(
  "@/components/game/RunBoard"
);

const NOW_SEC = 1_790_000_000n;

function sleepPool(id: bigint): PoolInfo {
  return {
    id,
    creator: ADDRESS,
    bountyModel: 2,
    settled: false,
    cancelled: false,
    periodStart: NOW_SEC - 30n * 3600n,
    periodEnd: NOW_SEC + 42n * 3600n,
    entryFee: 1_000_000n,
    balance: 5_000_000n,
    initiative: "Sleep 7 hours, 3 nights",
    goalSpec: "Sleep at least 7 hours for 3 nights",
  };
}

const LOCKED: ProviderState = {
  kind: "auth-required",
  reason: "Your wearable data is private to your wallet.",
};

const OPEN: ProviderState = {
  kind: "ok",
  progress: {
    connected: true,
    provider: "whoop",
    linkState: "linked",
    metric: "sleep_hours",
    streakDays: 1,
    targetDays: 3,
    lastSync: new Date(Number(NOW_SEC) * 1000).toISOString(),
  },
};

/** The board rendered from a seeded cache that never refetches. */
function renderLockedBoard(props: { verifyAction?: boolean } = {}): string {
  const pool = sleepPool(9007n);
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  client.setQueryData(["run-players", pool.id.toString()], [{ address: ADDRESS, hit: false }]);
  client.setQueryData(providerQueryKey(ADDRESS, pool.id, "sleep_hours"), LOCKED);
  client.setQueryData(["commitment-fee-bps"], 0);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(RunBoard, { pool, address: ADDRESS, showLink: true, ...props }),
    ),
  );
}

const verifyButtons = (html: string) => html.match(/<button\b[^>]*>Verify wallet<\/button>/g) ?? [];

describe("a locked RunBoard", () => {
  it("carries the Verify wallet button by default (the challenge page has one board)", () => {
    const html = renderLockedBoard();
    expect(html).toContain("Your nights are private to your wallet.");
    expect(verifyButtons(html)).toHaveLength(1);
  });

  it("says the nights are locked, with no second button, when another card carries it", () => {
    const html = renderLockedBoard({ verifyAction: false });
    expect(html).toContain("Your nights are private to your wallet.");
    expect(html).toContain("The Verify wallet button above unlocks them too.");
    expect(html).not.toContain("<button");
  });
});

describe("verifyActionOwner", () => {
  it("is the first locked card in page order", () => {
    expect(
      verifyActionOwner([
        { id: "board:1", state: LOCKED },
        { id: "board:2", state: LOCKED },
        { id: "streak", state: LOCKED },
      ]),
    ).toBe("board:1");
  });

  it("skips cards that read fine, are still loading, or are not wallet-gated", () => {
    expect(
      verifyActionOwner([
        { id: "board:1", state: OPEN },
        { id: "board:2", state: undefined },
        { id: "board:3", state: { kind: "unavailable", reason: "down" } },
        { id: "board:4", state: LOCKED },
        { id: "streak", state: LOCKED },
      ]),
    ).toBe("board:4");
  });

  it("is nobody when nothing is locked, so no card hides its button for a card that has none", () => {
    expect(verifyActionOwner([])).toBeNull();
    expect(
      verifyActionOwner([
        { id: "board:1", state: OPEN },
        { id: "streak", state: undefined },
      ]),
    ).toBeNull();
  });
});

describe("runNightsQuery", () => {
  const requestAuth = async () => ({ kind: "unsigned" as const });

  it("is the board's own cache entry, metric included, so the dashboard reads what the board shows", () => {
    const pool = sleepPool(9007n);
    const query = runNightsQuery(ADDRESS, pool, requestAuth);
    expect(query.queryKey).toEqual(providerQueryKey(ADDRESS, pool.id, "sleep_hours"));
    expect(query.enabled).toBe(true);
    expect(query.retry).toBe(false);
  });

  it("does not read a wearable for a challenge proven with a document", () => {
    const pool = { ...sleepPool(9008n), goalSpec: "[doc] flu-shot" };
    expect(runNightsQuery(ADDRESS, pool, requestAuth).enabled).toBe(false);
  });
});
