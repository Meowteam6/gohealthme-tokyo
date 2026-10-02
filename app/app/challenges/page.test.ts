// /challenges never opens a wallet on load. The invited-challenges read is
// cachedOnly (a session token, or a signature already collected this session,
// or nothing), its 401 retry included. Where the invites need a proof the page
// says so and offers the quiet Verify wallet action instead of an empty card
// that reads as "nobody challenged you".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UnsecuredJWT } from "jose";
import {
  clearWalletAuth,
  walletAuthRequester,
  type WalletAuthRequester,
} from "@/lib/client-auth";

const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

interface QueryOptions {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
}

const h = vi.hoisted(() => ({
  captured: [] as QueryOptions[],
  results: {} as Record<string, unknown>,
  requestAuth: null as WalletAuthRequester | null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: QueryOptions) => {
    h.captured.push(options);
    const root = String(options.queryKey[0]);
    return (
      (h.results[root] as object | undefined) ?? {
        data: undefined,
        isLoading: false,
        isSuccess: false,
        isError: false,
      }
    );
  },
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
}));

vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  DYNAMIC_CONFIGURED: true,
}));

vi.mock("@/lib/wallet", () => ({
  useEmbeddedWallet: () => ({
    ready: true,
    authenticated: true,
    address: ADDRESS,
    sessionProofPossible: true,
  }),
}));

vi.mock("@/lib/useWalletAuth", () => ({
  useWalletAuth: () => h.requestAuth,
}));

vi.mock("@/components/game/ApprovalNote", () => ({
  useApprovalProbe: () => ({ mode: "off", refetch: () => undefined }),
}));

vi.mock("@/lib/game/useSwitches", () => ({
  useSwitches: () => ({ moneyIn: "on", worldPaused: false, reason: null }),
}));

vi.mock("@/lib/use-display-names", () => ({
  useDisplayNames: () => ({ displayName: (address: string) => address }),
}));

function sessionToken(): string {
  return new UnsecuredJWT({
    scope: "user:basic",
    verified_credentials: [
      { format: "blockchain", address: ADDRESS.toLowerCase(), chain: "eip155" },
    ],
  })
    .setExpirationTime(Math.floor((Date.now() + 60 * 60 * 1000) / 1000))
    .encode();
}

/** A real requester bound to spies; every option it is called with is kept. */
function wallet(token: () => string | undefined = () => undefined) {
  const signMessage = vi.fn(async () => "0xabcdef");
  const proveSession = vi.fn(async () => "declined" as const);
  const confirmPrompt = vi.fn(async () => true);
  const real = walletAuthRequester({
    address: ADDRESS,
    signMessage,
    getSessionToken: token,
    proveSession,
    confirmPrompt,
  });
  const options: Array<Parameters<WalletAuthRequester>[0]> = [];
  h.requestAuth = (opts) => {
    options.push(opts);
    return real(opts);
  };
  const prompts = () =>
    signMessage.mock.calls.length +
    proveSession.mock.calls.length +
    confirmPrompt.mock.calls.length;
  return { options, prompts };
}

const EMPTY_MINE = {
  data: { inChallenges: [], sentChallenges: [] },
  isLoading: false,
  isSuccess: true,
  isError: false,
};

async function renderPage(): Promise<string> {
  const { default: ChallengesPage } = await import("@/app/challenges/page");
  return renderToStaticMarkup(createElement(ChallengesPage));
}

function invitedQuery(): QueryOptions {
  const found = h.captured.find((options) => options.queryKey[0] === "invited-challenges");
  if (found === undefined) throw new Error("the invited read was not registered");
  return found;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  clearWalletAuth();
  h.captured = [];
  h.results = { "my-challenges": EMPTY_MINE };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the invited read on load", () => {
  it("never prompts a wallet with no proof, and reports the invites as locked", async () => {
    const { options, prompts } = wallet();
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => json({ invites: [] }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await renderPage();
    const result = await invitedQuery().queryFn();

    expect(prompts()).toBe(0);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((opts) => opts?.cachedOnly === true)).toBe(true);
    expect(result).toEqual({ invites: [], locked: true });
    // Nothing to send: the route only answers a proven owner.
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toContain(
      "/api/challenges/invited",
    );
  });

  it("reads with the session token and stays cachedOnly through a refused-token retry", async () => {
    const token = sessionToken();
    const { options, prompts } = wallet(() => token);
    const fetchImpl = vi.fn(async () => json({ error: "refused" }, 401));
    vi.stubGlobal("fetch", fetchImpl);

    await renderPage();
    const result = await invitedQuery().queryFn();

    expect(prompts()).toBe(0);
    expect(options.every((opts) => opts?.cachedOnly === true)).toBe(true);
    expect(result).toEqual({ invites: [], locked: true });
  });

  it("an email, passkey or proven wallet login reads the invites with no prompt", async () => {
    const token = sessionToken();
    const { prompts } = wallet(() => token);
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => json({ invites: [] }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await renderPage();
    const result = await invitedQuery().queryFn();

    expect(prompts()).toBe(0);
    expect(result).toEqual({ invites: [], locked: false });
    const sent = fetchImpl.mock.calls.find(([url]) => url === "/api/challenges/invited");
    expect(new Headers(sent?.[1]?.headers).get("authorization")).toBe(`Bearer ${token}`);
  });
});

describe("what the page shows", () => {
  it("offers Verify wallet where the invites need a proof", async () => {
    wallet();
    h.results["invited-challenges"] = { data: { invites: [], locked: true }, isLoading: false };

    const html = await renderPage();

    expect(html).toContain("Verify wallet");
    expect(html).toContain("Invited to you");
    expect(html).toContain("private to your wallet");
  });

  it("shows no Verify wallet once the invites are readable", async () => {
    wallet();
    h.results["invited-challenges"] = { data: { invites: [], locked: false }, isLoading: false };

    const html = await renderPage();

    expect(html).not.toContain("Verify wallet");
    expect(html).toContain("No challenges yet");
  });
});
