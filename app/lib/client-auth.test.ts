// The browser half of the ownership proof. What matters here is not that a
// signature is produced - it is that ONE is produced per session (the claim
// loop polls every 800ms and a prompt per poll is unusable), that a refused
// prompt is a state and not an exception, and that the credential goes to this
// app's routes and nowhere else.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SignJWT,
  UnsecuredJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { privateKeyToAccount } from "viem/accounts";
import { walletAuthMessage } from "@/lib/server/wallet-auth";
import { authenticateWallet, verifyWalletSignature } from "@/lib/server/wallet-auth";
import {
  CLIENT_WALLET_AUTH_TTL_MS,
  REFUSED_SESSION_TOKEN_RETRY_MAX_MS,
  REFUSED_SESSION_TOKEN_RETRY_MS,
  WALLET_AUTH_ADDRESS_HEADER,
  WALLET_AUTH_SIGNATURE_HEADER,
  WALLET_AUTH_TIMESTAMP_HEADER,
  authBlockReason,
  authHeadersOf,
  cachedOnlyRequester,
  cachedWalletAuth,
  clearWalletAuth,
  clientWalletAuthMessage,
  credentialUsableAt,
  fetchInputUrl,
  fetchWithWalletAuth,
  forgetSessionProofDecline,
  getWalletAuth,
  isUserRejection,
  rememberSessionProofDecline,
  sessionProofWasDeclined,
  sessionTokenCoversAddress,
  shouldAttachWalletAuth,
  walletAuthFetch,
  walletAuthRequester,
  type ClientAuth,
} from "@/lib/client-auth";

const OWNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const ADDRESS = OWNER.address;
const NOW = Date.parse("2026-08-04T12:00:00.000Z");

function credential(overrides: Partial<{ address: string; timestamp: string; signature: string }> = {}) {
  return {
    address: ADDRESS,
    timestamp: new Date(NOW).toISOString(),
    signature: `0x${"ab".repeat(65)}`,
    ...overrides,
  };
}

beforeEach(() => {
  clearWalletAuth();
});

describe("clientWalletAuthMessage", () => {
  it("renders the exact string the server verifies", () => {
    // The one test that matters for interop: this module mirrors the server's
    // message rather than importing it (server code stays out of the client
    // bundle), so drift between the two has to fail here.
    const timestamp = new Date(NOW).toISOString();
    expect(clientWalletAuthMessage(ADDRESS, timestamp)).toBe(
      walletAuthMessage(ADDRESS, timestamp),
    );
  });
});

describe("credentialUsableAt", () => {
  it("accepts a fresh credential for the same address in any casing", () => {
    expect(
      credentialUsableAt(credential(), ADDRESS.toLowerCase(), NOW + 1_000),
    ).toBe(true);
  });

  it("refuses another address's credential", () => {
    expect(
      credentialUsableAt(
        credential(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        NOW,
      ),
    ).toBe(false);
  });

  it("refuses one that has aged past the reuse window", () => {
    expect(
      credentialUsableAt(credential(), ADDRESS, NOW + CLIENT_WALLET_AUTH_TTL_MS),
    ).toBe(false);
  });

  it("stays inside the server's ten minute window with room for clock drift", () => {
    expect(CLIENT_WALLET_AUTH_TTL_MS).toBeLessThan(10 * 60 * 1000);
  });

  it("refuses a credential signed in the future", () => {
    // The clock moved backwards mid-session; a negative age must not read as
    // fresh forever.
    expect(credentialUsableAt(credential(), ADDRESS, NOW - 5_000)).toBe(false);
  });

  it("refuses an unparseable timestamp", () => {
    expect(
      credentialUsableAt(credential({ timestamp: "whenever" }), ADDRESS, NOW),
    ).toBe(false);
  });
});

describe("getWalletAuth", () => {
  it("signs once and serves every later call from the cache", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`);
    const params = { address: ADDRESS, signMessage, now: () => NOW };

    const first = await getWalletAuth(params);
    const second = await getWalletAuth(params);

    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(first.kind).toBe("ok");
    expect(second).toEqual(first);
  });

  it("produces a signature the server accepts", async () => {
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage: (message) => OWNER.signMessage({ message }),
      now: () => NOW,
    });
    expect(auth.kind).toBe("ok");
    if (auth.kind !== "ok") return;

    const verified = await verifyWalletSignature({
      address: auth.headers[WALLET_AUTH_ADDRESS_HEADER],
      timestamp: auth.headers[WALLET_AUTH_TIMESTAMP_HEADER],
      signature: auth.headers[WALLET_AUTH_SIGNATURE_HEADER],
      now: NOW,
    });
    expect(verified.ok).toBe(true);
  });

  it("prompts once for concurrent callers", async () => {
    // Three surfaces mount at the same moment; the user must see one prompt.
    let resolve: ((value: string) => void) | undefined;
    const signMessage = vi.fn(
      () => new Promise<string>((r) => (resolve = r)),
    );
    const params = { address: ADDRESS, signMessage, now: () => NOW };

    const all = Promise.all([
      getWalletAuth(params),
      getWalletAuth(params),
      getWalletAuth(params),
    ]);
    resolve?.(`0x${"22".repeat(65)}`);
    const results = await all;

    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.kind === "ok")).toBe(true);
  });

  it("signs again once the cached credential ages out", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"33".repeat(65)}`);
    await getWalletAuth({ address: ADDRESS, signMessage, now: () => NOW });
    await getWalletAuth({
      address: ADDRESS,
      signMessage,
      now: () => NOW + CLIENT_WALLET_AUTH_TTL_MS + 1,
    });
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  it("re-signs on demand, which is what a 401 against a cached credential needs", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"44".repeat(65)}`);
    await getWalletAuth({ address: ADDRESS, signMessage, now: () => NOW });
    await getWalletAuth({
      address: ADDRESS,
      signMessage,
      refresh: true,
      now: () => NOW,
    });
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  it("never caches one wallet's credential under another", async () => {
    const other = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const signMessage = vi.fn().mockResolvedValue(`0x${"55".repeat(65)}`);
    await getWalletAuth({ address: ADDRESS, signMessage, now: () => NOW });
    const auth = await getWalletAuth({
      address: other,
      signMessage,
      now: () => NOW,
    });
    expect(signMessage).toHaveBeenCalledTimes(2);
    expect(auth.kind === "ok" && auth.credential?.address).toBe(other);
  });

  it("reports a wallet that is not connected", async () => {
    expect(
      await getWalletAuth({ address: null, signMessage: null }),
    ).toEqual({ kind: "no-wallet" });
  });

  it("reports a refused prompt as a choice, not a failure", async () => {
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage: () =>
        Promise.reject(
          Object.assign(new Error("User rejected the request."), { code: 4001 }),
        ),
      now: () => NOW,
    });
    expect(auth).toEqual({ kind: "declined" });
    // A refusal is not remembered as a credential.
    expect(cachedWalletAuth(ADDRESS, NOW)).toBeNull();
  });

  it("reports any other signer failure with its message", async () => {
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage: () => Promise.reject(new Error("wallet is on the wrong chain")),
      now: () => NOW,
    });
    expect(auth).toEqual({
      kind: "failed",
      message: "wallet is on the wrong chain",
    });
  });

  it("refuses a signature that is not 0x hex rather than sending it", async () => {
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage: () => Promise.resolve("nope"),
      now: () => NOW,
    });
    expect(auth.kind).toBe("failed");
  });

  it("never prompts in cachedOnly mode", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"66".repeat(65)}`);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      cachedOnly: true,
      now: () => NOW,
    });
    expect(signMessage).not.toHaveBeenCalled();
    expect(auth).toEqual({ kind: "unsigned" });
  });

  it("serves cachedOnly readers from a credential another surface collected", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"77".repeat(65)}`);
    await getWalletAuth({ address: ADDRESS, signMessage, now: () => NOW });
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      cachedOnly: true,
      now: () => NOW,
    });
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(auth.kind).toBe("ok");
  });
});

describe("authBlockReason", () => {
  it("says nothing for a successful attempt", () => {
    expect(
      authBlockReason({
        kind: "ok",
        credential: credential(),
        headers: authHeadersOf(credential()),
      }),
    ).toBeNull();
  });

  it("gives every refusal something the person can act on", () => {
    const states: ClientAuth[] = [
      { kind: "no-wallet" },
      { kind: "unsigned" },
      { kind: "declined" },
      { kind: "failed", message: "boom" },
    ];
    for (const state of states) {
      const reason = authBlockReason(state);
      expect(reason).not.toBeNull();
      expect((reason ?? "").length).toBeGreaterThan(20);
    }
  });

  it("promises no charge where a wallet prompt is being asked for", () => {
    expect(authBlockReason({ kind: "declined" })).toMatch(/nothing is charged/i);
  });

  it("reads in the house voice: no dashes standing in for punctuation", () => {
    const states: ClientAuth[] = [
      { kind: "no-wallet" },
      { kind: "unsigned" },
      { kind: "declined" },
      { kind: "failed", message: "wrong chain" },
    ];
    for (const state of states) {
      expect(authBlockReason(state) ?? "").not.toMatch(/[—–]|\s-\s/);
    }
  });
});

describe("isUserRejection", () => {
  it("recognises the shapes wallets actually throw", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true);
    expect(isUserRejection(new Error("User denied message signature"))).toBe(
      true,
    );
  });

  it("does not mistake a transport failure for a refusal", () => {
    expect(isUserRejection(new Error("fetch failed"))).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });
});

describe("fetchWithWalletAuth", () => {
  const okAuth = async (): Promise<ClientAuth> => ({
    kind: "ok",
    credential: credential(),
    headers: authHeadersOf(credential()),
  });

  it("attaches the three headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    await fetchWithWalletAuth("/api/agent/run/0x1", undefined, okAuth, fetchImpl);

    const init = fetchImpl.mock.calls[0][1] as { headers: Headers };
    expect(init.headers.get(WALLET_AUTH_ADDRESS_HEADER)).toBe(ADDRESS);
    expect(init.headers.get(WALLET_AUTH_SIGNATURE_HEADER)).not.toBeNull();
  });

  it("keeps the caller's own headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    await fetchWithWalletAuth(
      "/api/agent/run/0x1",
      { method: "POST", headers: { "Content-Type": "application/json" } },
      okAuth,
      fetchImpl,
    );
    const init = fetchImpl.mock.calls[0][1] as { headers: Headers };
    expect(init.headers.get("Content-Type")).toBe("application/json");
  });

  it("still sends the request unsigned, because the redacted answer is useful", async () => {
    // The unsigned answer is what tells the UI a claim EXISTS and is being
    // withheld; refusing to ask would leave a blank upload box instead.
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    const result = await fetchWithWalletAuth(
      "/api/agent/run/0x1",
      undefined,
      async () => ({ kind: "declined" }),
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0][1] as { headers: Headers };
    expect(init.headers.get(WALLET_AUTH_ADDRESS_HEADER)).toBeNull();
    expect(result.auth.kind).toBe("declined");
  });

  it("re-signs once when a cached credential is refused", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const requestAuth = vi.fn(okAuth);

    const result = await fetchWithWalletAuth(
      "/api/agent/run/0x1",
      undefined,
      requestAuth,
      fetchImpl,
    );

    // The claim read also holds a refused token back (it redacts instead of
    // refusing), so the retry carries that flag beside the refresh.
    expect(requestAuth).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ refresh: true }),
    );
    expect(result.response.status).toBe(200);
  });

  it("does not loop when the retry is refused too", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const requestAuth = vi
      .fn<() => Promise<ClientAuth>>()
      .mockResolvedValueOnce(await okAuth())
      .mockResolvedValueOnce({ kind: "declined" });

    const result = await fetchWithWalletAuth(
      "/api/agent/run/0x1",
      undefined,
      requestAuth,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.auth.kind).toBe("declined");
  });

  it("does not re-sign a 401 that was already unsigned", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const requestAuth = vi.fn(async (): Promise<ClientAuth> => ({ kind: "unsigned" }));
    await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestAuth).toHaveBeenCalledTimes(1);
  });
});

describe("shouldAttachWalletAuth", () => {
  const origin = "https://gohealthme.example";

  it("attaches to this app's own routes", () => {
    expect(shouldAttachWalletAuth("/api/unlink/register", origin)).toBe(true);
    expect(
      shouldAttachWalletAuth(`${origin}/api/unlink/register`, origin),
    ).toBe(true);
  });

  it("never hands the credential to a third party", () => {
    // The Unlink SDK uses ONE customFetch for our routes and the Engine's
    // host. A wallet-control proof is a bearer credential; the Engine is not
    // the party it was issued to.
    expect(
      shouldAttachWalletAuth(
        "https://arc-testnet-production-api.unlink.xyz/v1/accounts",
        origin,
      ),
    ).toBe(false);
    expect(shouldAttachWalletAuth("//evil.example/api", origin)).toBe(false);
    expect(shouldAttachWalletAuth("http://gohealthme.example/api", origin)).toBe(
      false,
    );
  });
});

describe("walletAuthFetch", () => {
  const origin = "https://gohealthme.example";
  const requestAuth = async (): Promise<ClientAuth> => ({
    kind: "ok",
    credential: credential(),
    headers: authHeadersOf(credential()),
  });

  it("signs a same-origin string request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    const wrapped = walletAuthFetch(requestAuth, origin, fetchImpl);
    await wrapped("/api/unlink/register", { method: "POST" });

    const init = fetchImpl.mock.calls[0][1] as { headers: Headers };
    expect(init.headers.get(WALLET_AUTH_ADDRESS_HEADER)).toBe(ADDRESS);
  });

  it("leaves an Engine request untouched", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    const asked = vi.fn(requestAuth);
    const wrapped = walletAuthFetch(asked, origin, fetchImpl);
    await wrapped("https://engine.unlink.xyz/v1/balances");

    expect(fetchImpl.mock.calls[0][1]).toBeUndefined();
    // Not even read for a foreign host: the credential never goes near it.
    expect(asked).not.toHaveBeenCalled();
  });

  it("merges into a Request's own headers rather than replacing them", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    const wrapped = walletAuthFetch(requestAuth, origin, fetchImpl);
    await wrapped(
      new Request(`${origin}/api/unlink/authorization-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    const sent = fetchImpl.mock.calls[0][0] as Request;
    expect(sent.headers.get("Content-Type")).toBe("application/json");
    expect(sent.headers.get(WALLET_AUTH_ADDRESS_HEADER)).toBe(ADDRESS);
  });

  it("re-reads the credential per request, so a long-lived client keeps working", async () => {
    // The Unlink client outlives one signature's window and mints tokens on
    // its own schedule; a credential captured at construction would 401 later.
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    const asked = vi.fn(requestAuth);
    const wrapped = walletAuthFetch(asked, origin, fetchImpl);

    await wrapped("/api/unlink/authorization-token", { method: "POST" });
    await wrapped("/api/unlink/authorization-token", { method: "POST" });

    expect(asked).toHaveBeenCalledTimes(2);
  });

  it("sends unsigned rather than hanging when the credential is gone", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const wrapped = walletAuthFetch(
      async () => ({ kind: "declined" }),
      origin,
      fetchImpl,
    );

    const res = await wrapped("/api/unlink/register", { method: "POST" });

    // 401 is the loud answer the SDK surfaces; a swallowed call would read as
    // a hung payout.
    expect(res.status).toBe(401);
    const init = fetchImpl.mock.calls[0][1] as { headers: Headers };
    expect(init.headers.get(WALLET_AUTH_ADDRESS_HEADER)).toBeNull();
  });
});

describe("fetchInputUrl", () => {
  it("reads the url out of every fetch argument shape", () => {
    expect(fetchInputUrl("/api/x")).toBe("/api/x");
    expect(fetchInputUrl(new URL("https://x.example/api"))).toBe(
      "https://x.example/api",
    );
    expect(fetchInputUrl(new Request("https://x.example/api"))).toBe(
      "https://x.example/api",
    );
  });
});

// ------------------------------------------------ Dynamic session token path
//
// A player Dynamic already authenticated holds a session token listing the
// wallets they proved. When it covers the connected wallet the browser sends
// it instead of asking the wallet to sign, which is the whole point: no prompt
// on every per-wallet read. The client only DECODES the token to decide
// whether to try it; the server is what verifies it.

function sessionToken(
  opts: { wallets?: string[]; scope?: string | null; expMs?: number } = {},
): string {
  const payload: Record<string, unknown> = {
    verified_credentials: (opts.wallets ?? [ADDRESS.toLowerCase()]).map(
      (address) => ({ format: "blockchain", address, chain: "eip155" }),
    ),
  };
  if (opts.scope !== null) payload.scope = opts.scope ?? "user:basic";
  return new UnsecuredJWT(payload)
    .setExpirationTime(Math.floor((opts.expMs ?? NOW + 60 * 60 * 1000) / 1000))
    .encode();
}

describe("sessionTokenCoversAddress", () => {
  it("accepts a token that lists the wallet, in any casing", () => {
    expect(sessionTokenCoversAddress(sessionToken(), ADDRESS, NOW)).toBe(true);
    expect(
      sessionTokenCoversAddress(sessionToken(), ADDRESS.toLowerCase(), NOW),
    ).toBe(true);
  });

  it("refuses a token for a different wallet", () => {
    expect(
      sessionTokenCoversAddress(
        sessionToken(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        NOW,
      ),
    ).toBe(false);
  });

  it("refuses a token that has expired or is about to", () => {
    expect(
      sessionTokenCoversAddress(sessionToken({ expMs: NOW - 1_000 }), ADDRESS, NOW),
    ).toBe(false);
    expect(
      sessionTokenCoversAddress(sessionToken({ expMs: NOW + 5_000 }), ADDRESS, NOW),
    ).toBe(false);
  });

  it("refuses a token whose sign-in is incomplete (no user:basic)", () => {
    expect(
      sessionTokenCoversAddress(
        sessionToken({ scope: "requiresAdditionalAuth" }),
        ADDRESS,
        NOW,
      ),
    ).toBe(false);
    expect(
      sessionTokenCoversAddress(sessionToken({ scope: null }), ADDRESS, NOW),
    ).toBe(false);
  });

  it("refuses garbage without throwing", () => {
    expect(sessionTokenCoversAddress("not-a-jwt", ADDRESS, NOW)).toBe(false);
  });
});

describe("getWalletAuth with a Dynamic session token", () => {
  it("sends the token without asking the wallet to sign when it covers the wallet", async () => {
    const token = sessionToken();
    const signMessage = vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`);

    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => token,
      now: () => NOW,
    });

    expect(signMessage).not.toHaveBeenCalled();
    expect(auth).toEqual({
      kind: "ok",
      credential: null,
      headers: {
        authorization: `Bearer ${token}`,
        [WALLET_AUTH_ADDRESS_HEADER]: ADDRESS,
      },
    });
  });

  it("signs exactly as before when the token does not list the wallet", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"12".repeat(65)}`);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () =>
        sessionToken({ wallets: ["0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"] }),
      now: () => NOW,
    });
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(auth.kind === "ok" && auth.headers[WALLET_AUTH_SIGNATURE_HEADER]).toBe(
      `0x${"12".repeat(65)}`,
    );
    expect(auth.kind === "ok" && auth.headers.authorization).toBeUndefined();
  });

  it("signs exactly as before when there is no token (connect-only wallet)", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"13".repeat(65)}`);
    await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      now: () => NOW,
    });
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("falls back to signing when reading the token throws", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"14".repeat(65)}`);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => {
        throw new Error("no Dynamic client yet");
      },
      now: () => NOW,
    });
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(auth.kind).toBe("ok");
  });

  it("counts the token as cached for cachedOnly readers", async () => {
    const signMessage = vi.fn();
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      cachedOnly: true,
      getSessionToken: () => sessionToken(),
      now: () => NOW,
    });
    expect(signMessage).not.toHaveBeenCalled();
    expect(auth.kind).toBe("ok");
  });

  it("keeps using a good token when a player taps to re-check (refresh)", async () => {
    // "Check my wearable" asks for a refresh because the player tapped for it.
    // With a token that covers the wallet that tap must not become a prompt.
    const token = sessionToken();
    const signMessage = vi.fn();
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      refresh: true,
      getSessionToken: () => token,
      now: () => NOW,
    });
    expect(signMessage).not.toHaveBeenCalled();
    expect(auth.kind === "ok" && auth.headers.authorization).toBe(`Bearer ${token}`);
  });

  it("produces headers the server accepts", async () => {
    const ENV_ID = "0f2d7c1e-5a4b-4c3d-9e8f-123456789abc";
    const pair = await generateKeyPair("RS256", { extractable: true });
    const jwk = await exportJWK(pair.publicKey);
    const token = await new SignJWT({
      environment_id: ENV_ID,
      scope: "user:basic",
      verified_credentials: [{ format: "blockchain", address: ADDRESS.toLowerCase() }],
    })
      .setProtectedHeader({ alg: "RS256", kid: "k" })
      .setExpirationTime(Math.floor(NOW / 1000) + 3600)
      .sign(pair.privateKey);

    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage: vi.fn(),
      getSessionToken: () => token,
      now: () => NOW,
    });
    expect(auth.kind).toBe("ok");
    if (auth.kind !== "ok") return;

    const verified = await authenticateWallet(
      new Request("https://x/api/t", { headers: auth.headers }),
      NOW,
      {
        environmentId: ENV_ID,
        jwks: createLocalJWKSet({ keys: [{ ...jwk, kid: "k", alg: "RS256" }] }),
      },
    );
    expect(verified.ok).toBe(true);
  });
});

describe("fetchWithWalletAuth with a Dynamic session token", () => {
  it("falls back to one signature when the server refuses the token", async () => {
    const token = sessionToken();
    const signMessage = vi.fn().mockResolvedValue(`0x${"17".repeat(65)}`);
    const requestAuth = (options?: { refresh?: boolean; cachedOnly?: boolean }) =>
      getWalletAuth({
        address: ADDRESS,
        signMessage,
        getSessionToken: () => token,
        now: () => NOW,
        ...options,
      });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const result = await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);

    expect(result.response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(signMessage).toHaveBeenCalledTimes(1);
    const first = fetchImpl.mock.calls[0][1] as { headers: Headers };
    const second = fetchImpl.mock.calls[1][1] as { headers: Headers };
    expect(first.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(second.headers.get("authorization")).toBeNull();
    expect(second.headers.get(WALLET_AUTH_SIGNATURE_HEADER)).toBe(`0x${"17".repeat(65)}`);

    // The refused token is not sent again; later reads ride the signature.
    const later = await requestAuth();
    expect(later.kind === "ok" && later.headers.authorization).toBeUndefined();
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("gives a fresh token its own try after an earlier one was refused", async () => {
    let token = sessionToken();
    const signMessage = vi.fn().mockResolvedValue(`0x${"19".repeat(65)}`);
    const requestAuth = (options?: { refresh?: boolean; cachedOnly?: boolean }) =>
      getWalletAuth({
        address: ADDRESS,
        signMessage,
        getSessionToken: () => token,
        now: () => NOW,
        ...options,
      });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);

    token = sessionToken({ expMs: NOW + 2 * 60 * 60 * 1000 });
    const auth = await requestAuth();
    expect(auth.kind === "ok" && auth.headers.authorization).toBe(`Bearer ${token}`);
  });

  it("stops a third-party client re-sending a refused token", async () => {
    // walletAuthFetch cannot retry (the SDK owns the body), but the next call
    // must not carry the same refused token again.
    const token = sessionToken();
    const signMessage = vi.fn().mockResolvedValue(`0x${"1a".repeat(65)}`);
    const requestAuth = (options?: { refresh?: boolean; cachedOnly?: boolean }) =>
      getWalletAuth({
        address: ADDRESS,
        signMessage,
        getSessionToken: () => token,
        now: () => NOW,
        ...options,
      });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const wrapped = walletAuthFetch(requestAuth, "https://app.example", fetchImpl);

    await wrapped("/api/unlink/x");
    await wrapped("/api/unlink/x");

    const first = fetchImpl.mock.calls[0][1] as { headers: Headers };
    const second = fetchImpl.mock.calls[1][1] as { headers: Headers };
    expect(first.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(second.headers.get("authorization")).toBeNull();
    expect(second.headers.get(WALLET_AUTH_SIGNATURE_HEADER)).toBe(`0x${"1a".repeat(65)}`);
  });

  it("does not loop when the signature is refused as well", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"18".repeat(65)}`);
    const requestAuth = (options?: { refresh?: boolean; cachedOnly?: boolean }) =>
      getWalletAuth({
        address: ADDRESS,
        signMessage,
        getSessionToken: () => sessionToken(),
        now: () => NOW,
        ...options,
      });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));

    const result = await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);

    expect(result.response.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------ wallet logins prove once per session
//
// A connect-only wallet (MetaMask, Coinbase, Base Account, WalletConnect) has
// no Dynamic session token until it signs Dynamic's own sign-in once. Before
// this, every private read opened the ad-hoc "prove control" signature, good
// for eight minutes and gone on reload. Now the first prompt a wallet login
// meets IS the session proof, so the one signature buys a token that lasts
// the session. The ad-hoc signature stays as the fallback (and the e2e suite
// signs it directly), but a declined proof never turns into a second prompt.

describe("getWalletAuth with a session proof", () => {
  function provingSession() {
    let token: string | undefined;
    const proveSession = vi.fn(async () => {
      token = sessionToken();
      return "proven" as const;
    });
    return { proveSession, getSessionToken: () => token };
  }

  it("prefers a session token that already covers the wallet: no proof, no signature", async () => {
    const proveSession = vi.fn();
    const signMessage = vi.fn();
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => sessionToken(),
      proveSession,
      now: () => NOW,
    });
    expect(auth.kind === "ok" && auth.credential).toBeNull();
    expect(proveSession).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("tries the session proof before the ad-hoc signature and sends the token it yields", async () => {
    const { proveSession, getSessionToken } = provingSession();
    const signMessage = vi.fn();
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken,
      proveSession,
      now: () => NOW,
    });
    expect(proveSession).toHaveBeenCalledTimes(1);
    expect(signMessage).not.toHaveBeenCalled();
    expect(auth.kind === "ok" && auth.headers.authorization).toBe(
      `Bearer ${getSessionToken()}`,
    );
  });

  it("serves every later call, and a reload's worth of taps, from that one proof", async () => {
    const { proveSession, getSessionToken } = provingSession();
    const signMessage = vi.fn();
    const params = { address: ADDRESS, signMessage, getSessionToken, proveSession, now: () => NOW };
    await getWalletAuth(params);
    await getWalletAuth({ ...params, refresh: true });
    await getWalletAuth({ ...params, now: () => NOW + CLIENT_WALLET_AUTH_TTL_MS + 1 });
    expect(proveSession).toHaveBeenCalledTimes(1);
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("never runs the proof for a cachedOnly read", async () => {
    const proveSession = vi.fn();
    const signMessage = vi.fn();
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession,
      cachedOnly: true,
      now: () => NOW,
    });
    expect(auth).toEqual({ kind: "unsigned" });
    expect(proveSession).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("a declined proof opens no second prompt in the same tap", async () => {
    const proveSession = vi.fn(async () => "declined" as const);
    const signMessage = vi.fn();
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession,
      now: () => NOW,
    });
    expect(auth).toEqual({ kind: "declined" });
    expect(signMessage).not.toHaveBeenCalled();
    expect(sessionProofWasDeclined(ADDRESS)).toBe(true);
  });

  it("after a decline the next tap falls back to today's signature, never the proof again", async () => {
    const proveSession = vi.fn(async () => "declined" as const);
    const signMessage = vi.fn().mockResolvedValue(`0x${"21".repeat(65)}`);
    const params = {
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession,
      now: () => NOW,
    };
    await getWalletAuth(params);
    const second = await getWalletAuth({ ...params, refresh: true });
    const third = await getWalletAuth({ ...params, refresh: true });
    expect(proveSession).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledTimes(2);
    expect(second.kind === "ok" && second.headers[WALLET_AUTH_SIGNATURE_HEADER]).toBe(
      `0x${"21".repeat(65)}`,
    );
    expect(third.kind).toBe("ok");
  });

  it("falls back to the signature in the same tap when the proof is unavailable", async () => {
    // Dynamic already signed in with another credential, an embedded wallet,
    // or no Dynamic client: nothing was prompted, so the signature is the one.
    const proveSession = vi.fn(async () => "unavailable" as const);
    const signMessage = vi.fn().mockResolvedValue(`0x${"22".repeat(65)}`);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession,
      now: () => NOW,
    });
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(auth.kind === "ok" && auth.credential?.signature).toBe(`0x${"22".repeat(65)}`);
    expect(sessionProofWasDeclined(ADDRESS)).toBe(false);
  });

  it("falls back to the signature when the proof throws", async () => {
    const proveSession = vi.fn(async () => {
      throw new Error("Dynamic is not ready");
    });
    const signMessage = vi.fn().mockResolvedValue(`0x${"23".repeat(65)}`);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession,
      now: () => NOW,
    });
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(auth.kind).toBe("ok");
  });

  it("falls back to the signature when a proven session's token was refused by the server", async () => {
    // A 401 set the token aside; the refresh must sign, not resend it.
    const token = sessionToken();
    const proveSession = vi.fn(async () => "proven" as const);
    const signMessage = vi.fn().mockResolvedValue(`0x${"24".repeat(65)}`);
    const requestAuth = (options?: { refresh?: boolean; cachedOnly?: boolean }) =>
      getWalletAuth({
        address: ADDRESS,
        signMessage,
        getSessionToken: () => token,
        proveSession,
        now: () => NOW,
        ...options,
      });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const result = await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);

    expect(result.response.status).toBe(200);
    expect(signMessage).toHaveBeenCalledTimes(1);
    const second = fetchImpl.mock.calls[1][1] as { headers: Headers };
    expect(second.headers.get("authorization")).toBeNull();
  });

  it("shares one proof between surfaces asking at the same moment", async () => {
    let finish: (() => void) | undefined;
    let token: string | undefined;
    const proveSession = vi.fn(
      () =>
        new Promise<"proven">((resolve) => {
          finish = () => {
            token = sessionToken();
            resolve("proven");
          };
        }),
    );
    const params = {
      address: ADDRESS,
      signMessage: vi.fn(),
      getSessionToken: () => token,
      proveSession,
      now: () => NOW,
    };
    const all = Promise.all([getWalletAuth(params), getWalletAuth(params)]);
    await Promise.resolve();
    finish?.();
    const results = await all;
    expect(proveSession).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.kind === "ok")).toBe(true);
  });

  it("a decline remembered elsewhere (the sign-in sheet) sends the next tap to the signature", async () => {
    rememberSessionProofDecline(ADDRESS);
    const proveSession = vi.fn();
    const signMessage = vi.fn().mockResolvedValue(`0x${"25".repeat(65)}`);
    const auth = await getWalletAuth({
      address: ADDRESS.toLowerCase(),
      signMessage,
      getSessionToken: () => undefined,
      proveSession,
      now: () => NOW,
    });
    expect(proveSession).not.toHaveBeenCalled();
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(auth.kind).toBe("ok");
  });

  it("a proven session clears an earlier decline", async () => {
    await getWalletAuth({
      address: ADDRESS,
      signMessage: vi.fn(),
      getSessionToken: () => undefined,
      proveSession: async () => "declined" as const,
      now: () => NOW,
    });
    expect(sessionProofWasDeclined(ADDRESS)).toBe(true);
    forgetSessionProofDecline(ADDRESS);
    expect(sessionProofWasDeclined(ADDRESS)).toBe(false);
  });
});

describe("walletAuthRequester", () => {
  it("binds the token reader and the proof, and keeps cachedOnly silent", async () => {
    const proveSession = vi.fn(async () => "declined" as const);
    const signMessage = vi.fn();
    const requestAuth = walletAuthRequester({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession,
    });
    expect(await requestAuth({ cachedOnly: true })).toEqual({ kind: "unsigned" });
    expect(proveSession).not.toHaveBeenCalled();
    expect(await requestAuth()).toEqual({ kind: "declined" });
    expect(proveSession).toHaveBeenCalledTimes(1);
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("reports no wallet when there is no address", async () => {
    const requestAuth = walletAuthRequester({
      address: null,
      signMessage: null,
      getSessionToken: null,
      proveSession: null,
    });
    expect(await requestAuth()).toEqual({ kind: "no-wallet" });
  });
});

describe("the session proof is asked about the wallet in hand", () => {
  it("passes the address to the proof, so it never proves a different wallet", async () => {
    let token: string | undefined;
    const proveSession = vi.fn(async () => {
      token = sessionToken();
      return "proven" as const;
    });
    await getWalletAuth({
      address: ADDRESS,
      signMessage: vi.fn(),
      getSessionToken: () => token,
      proveSession,
      now: () => NOW,
    });
    // Unconfirmed: nobody tapped a Verify button for this request, so the
    // proof has to explain itself before the wallet opens.
    expect(proveSession).toHaveBeenCalledWith(ADDRESS, { confirmed: false });
  });

  it("an explicit Verify tap after a decline tries the session proof again", async () => {
    // The declined memory stops a loop of prompts on ordinary taps; the one
    // button whose whole job is verifying clears it first.
    let token: string | undefined;
    const proveSession = vi
      .fn<(address: string) => Promise<"proven" | "declined" | "unavailable">>()
      .mockResolvedValueOnce("declined")
      .mockImplementationOnce(async () => {
        token = sessionToken();
        return "proven";
      });
    const signMessage = vi.fn();
    const params = {
      address: ADDRESS,
      signMessage,
      getSessionToken: () => token,
      proveSession,
      now: () => NOW,
    };
    expect(await getWalletAuth(params)).toEqual({ kind: "declined" });
    forgetSessionProofDecline(ADDRESS);
    const verified = await getWalletAuth({ ...params, refresh: true });
    expect(proveSession).toHaveBeenCalledTimes(2);
    expect(signMessage).not.toHaveBeenCalled();
    expect(verified.kind === "ok" && verified.headers.authorization).toBe(`Bearer ${token}`);
    expect(sessionProofWasDeclined(ADDRESS)).toBe(false);
  });
});

describe("cachedOnlyRequester", () => {
  // Page loads read through this. Opening a page must never open a wallet,
  // whatever the fetch helper asks for on a 401.
  //
  // walletAuthRequester reads the real clock (a React caller has no `now` to
  // pass), so these tokens expire an hour from the real now, not from NOW.
  // Minted from NOW they were already expired, and the first test passed
  // without ever sending the token it is about.
  const liveToken = () => sessionToken({ expMs: Date.now() + 60 * 60 * 1000 });

  it("never prompts, not even for the refresh a 401 retry asks for", async () => {
    const token = liveToken();
    const signMessage = vi.fn();
    const proveSession = vi.fn();
    const prompting = walletAuthRequester({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => token,
      proveSession,
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));

    const result = await fetchWithWalletAuth(
      "/api/wearable/progress",
      undefined,
      cachedOnlyRequester(prompting),
      fetchImpl,
    );

    // The token went out first, the 401 set it aside, and the retry stayed silent.
    const first = fetchImpl.mock.calls[0][1] as { headers: Headers };
    expect(first.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.auth).toEqual({ kind: "unsigned" });
    expect(signMessage).not.toHaveBeenCalled();
    expect(proveSession).not.toHaveBeenCalled();
  });

  it("still reads with the session token when there is one", async () => {
    const token = liveToken();
    const requestAuth = cachedOnlyRequester(
      walletAuthRequester({
        address: ADDRESS,
        signMessage: vi.fn(),
        getSessionToken: () => token,
        proveSession: vi.fn(),
      }),
    );
    const auth = await requestAuth();
    expect(auth.kind === "ok" && auth.headers.authorization).toBe(`Bearer ${token}`);
  });
});

// ------------------------------------------- never a cold wallet popup
//
// The post-connect sheet explains the one signature, but most wallet logins
// never see it: every reload is a silent reconnect, and every wallet that
// connected before this shipped starts unproven. For them the first prompt
// came from whatever surface asked (a page load of /challenges, the verdict
// card's mount, Join's gas drip, Check my wearable), and the wallet opened
// cold. So every prompt nobody confirmed is asked about first, in plain
// words, and the wallet opens only after the player says yes.

describe("getWalletAuth asks before it opens the wallet", () => {
  const SIG = `0x${"31".repeat(65)}`;

  it("asks before the plain signature, and a Not now opens nothing and is not remembered", async () => {
    const confirmPrompt = vi.fn(async () => false);
    const signMessage = vi.fn().mockResolvedValue(SIG);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession: null,
      confirmPrompt,
      now: () => NOW,
    });
    expect(auth).toEqual({ kind: "declined" });
    expect(confirmPrompt).toHaveBeenCalledWith(ADDRESS, "signature");
    expect(signMessage).not.toHaveBeenCalled();
    expect(sessionProofWasDeclined(ADDRESS)).toBe(false);
  });

  it("signs once the player says yes", async () => {
    const confirmPrompt = vi.fn(async () => true);
    const signMessage = vi.fn().mockResolvedValue(SIG);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession: async () => "unavailable" as const,
      confirmPrompt,
      now: () => NOW,
    });
    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(auth.kind === "ok" && auth.credential?.signature).toBe(SIG);
  });

  it("a Verify tap is the confirmation: no second question", async () => {
    const confirmPrompt = vi.fn(async () => false);
    const proveSession = vi.fn(async () => "unavailable" as const);
    const signMessage = vi.fn().mockResolvedValue(SIG);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession,
      confirmPrompt,
      confirmed: true,
      now: () => NOW,
    });
    expect(auth.kind).toBe("ok");
    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(proveSession).toHaveBeenCalledWith(ADDRESS, { confirmed: true });
  });

  it("the requester carries the Verify tap's confirmation through", async () => {
    const proveSession = vi.fn(async () => "declined" as const);
    const requestAuth = walletAuthRequester({
      address: ADDRESS,
      signMessage: vi.fn(),
      getSessionToken: () => undefined,
      proveSession,
      confirmPrompt: vi.fn(async () => false),
    });
    await requestAuth({ refresh: true, confirmed: true });
    expect(proveSession).toHaveBeenCalledWith(ADDRESS, { confirmed: true });
  });

  it("a session proof the player waved off is a no for this tap, never remembered as a wallet decline", async () => {
    // Remembering it would send the next tap straight to the plain signature.
    const proveSession = vi.fn(async () => "dismissed" as const);
    const confirmPrompt = vi.fn(async () => true);
    const signMessage = vi.fn();
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession,
      confirmPrompt,
      now: () => NOW,
    });
    expect(auth).toEqual({ kind: "declined" });
    expect(signMessage).not.toHaveBeenCalled();
    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(sessionProofWasDeclined(ADDRESS)).toBe(false);
  });

  it("surfaces asking together share one question", async () => {
    let answer: ((yes: boolean) => void) | undefined;
    const confirmPrompt = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const signMessage = vi.fn().mockResolvedValue(SIG);
    const params = {
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession: null,
      confirmPrompt,
      now: () => NOW,
    };
    const both = Promise.all([getWalletAuth(params), getWalletAuth(params)]);
    await Promise.resolve();
    answer?.(true);
    const results = await both;
    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.kind === "ok")).toBe(true);
  });

  it("uses a credential that landed while the question was open instead of opening the wallet", async () => {
    // The player verified from another surface (or Dynamic signed them in)
    // while this question waited: yes means go on, not sign twice.
    let token: string | undefined;
    const confirmPrompt = vi.fn(async () => {
      token = sessionToken();
      return true;
    });
    const signMessage = vi.fn();
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => token,
      proveSession: null,
      confirmPrompt,
      now: () => NOW,
    });
    expect(signMessage).not.toHaveBeenCalled();
    expect(auth.kind === "ok" && auth.headers.authorization).toBe(`Bearer ${token}`);
  });

  it("a throwing question counts as a no, never as a yes", async () => {
    const signMessage = vi.fn();
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession: null,
      confirmPrompt: async () => {
        throw new Error("sheet unmounted");
      },
      now: () => NOW,
    });
    expect(auth).toEqual({ kind: "declined" });
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("a cachedOnly read never asks", async () => {
    const confirmPrompt = vi.fn(async () => true);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage: vi.fn(),
      getSessionToken: () => undefined,
      proveSession: vi.fn(),
      confirmPrompt,
      cachedOnly: true,
      now: () => NOW,
    });
    expect(auth).toEqual({ kind: "unsigned" });
    expect(confirmPrompt).not.toHaveBeenCalled();
  });

  it("a session token that covers the wallet never asks", async () => {
    const confirmPrompt = vi.fn(async () => true);
    const auth = await getWalletAuth({
      address: ADDRESS,
      signMessage: vi.fn(),
      getSessionToken: () => sessionToken(),
      proveSession: vi.fn(),
      confirmPrompt,
      now: () => NOW,
    });
    expect(auth.kind).toBe("ok");
    expect(confirmPrompt).not.toHaveBeenCalled();
  });
});

// ------------------------------------ a refused token is not refused forever
//
// The server answers 401 to a session token it could not check, and that
// includes a transient failure to reach Dynamic's keys (a JWKS timeout), not
// only a bad token. Setting the token aside for the rest of the tab turned one
// slow key fetch into locked cards and an extra signature for a wallet that
// had already proven itself. A refusal now sets the token aside for a while,
// longer each time the same token is refused again, and a token the server
// accepts again starts clean. A bad token still never loops.

describe("a refused session token recovers", () => {
  const SIG = `0x${"41".repeat(65)}`;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    return () => {
      vi.useRealTimers();
    };
  });

  function requesterFor(token: () => string | undefined, signMessage = vi.fn().mockResolvedValue(SIG)) {
    const requestAuth = (options?: { refresh?: boolean; cachedOnly?: boolean }) =>
      getWalletAuth({
        address: ADDRESS,
        signMessage,
        getSessionToken: token,
        now: () => Date.now(),
        ...options,
      });
    return { requestAuth, signMessage };
  }

  const bearerOf = (auth: ClientAuth) =>
    auth.kind === "ok" ? (auth.headers.authorization ?? null) : null;

  it("sets the token aside for a short while, then tries it again", async () => {
    const token = sessionToken({ expMs: NOW + 2 * 60 * 60 * 1000 });
    const { requestAuth } = requesterFor(() => token);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);

    // Inside the window the signature serves; the token is not resent.
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS - 1_000);
    expect(bearerOf(await requestAuth())).toBeNull();

    // After it, the same token gets its try again.
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    expect(bearerOf(await requestAuth())).toBe(`Bearer ${token}`);
  });

  it("brings page-load reads back to the token once the window passes", async () => {
    const token = sessionToken({ expMs: NOW + 2 * 60 * 60 * 1000 });
    const prompting = walletAuthRequester({
      address: ADDRESS,
      signMessage: vi.fn(),
      getSessionToken: () => token,
      proveSession: vi.fn(),
    });
    const quiet = cachedOnlyRequester(prompting);
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const first = await fetchWithWalletAuth("/api/wearable/progress", undefined, quiet, fetchImpl);
    expect(first.auth).toEqual({ kind: "unsigned" });

    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    expect(bearerOf(await quiet())).toBe(`Bearer ${token}`);
  });

  it("waits longer each time the same token is refused, so a bad token never loops", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth } = requesterFor(() => token);
    const refused = () => vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));

    await fetchWithWalletAuth("/api/x", undefined, requestAuth, refused());
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    const secondAt = Date.now();
    await fetchWithWalletAuth("/api/x", undefined, requestAuth, refused());

    // The second window is twice the first.
    vi.setSystemTime(secondAt + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    expect(bearerOf(await requestAuth())).toBeNull();
    vi.setSystemTime(secondAt + 2 * REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    expect(bearerOf(await requestAuth())).toBe(`Bearer ${token}`);
  });

  it("never waits longer than the cap", async () => {
    const token = sessionToken({ expMs: NOW + 48 * 60 * 60 * 1000 });
    const { requestAuth } = requesterFor(() => token);
    let at = NOW;
    for (let i = 0; i < 12; i++) {
      vi.setSystemTime(at);
      await fetchWithWalletAuth(
        "/api/x",
        undefined,
        requestAuth,
        vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
      );
      at = Date.now() + REFUSED_SESSION_TOKEN_RETRY_MAX_MS + 1_000;
    }
    vi.setSystemTime(at);
    expect(bearerOf(await requestAuth())).toBe(`Bearer ${token}`);
  });

  it("a token the server accepts again starts clean", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth } = requesterFor(() => token);
    await fetchWithWalletAuth(
      "/api/x",
      undefined,
      requestAuth,
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    const accepted = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await fetchWithWalletAuth("/api/x", undefined, requestAuth, accepted);
    const sent = accepted.mock.calls[0][1] as { headers: Headers };
    expect(sent.headers.get("authorization")).toBe(`Bearer ${token}`);

    // One more refusal later is a first refusal again: the short window.
    const thirdAt = Date.now() + 60_000;
    vi.setSystemTime(thirdAt);
    await fetchWithWalletAuth(
      "/api/x",
      undefined,
      requestAuth,
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    vi.setSystemTime(thirdAt + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    expect(bearerOf(await requestAuth())).toBe(`Bearer ${token}`);
  });

  it("keeps a good signature when the token is what the server refused: no second prompt", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth, signMessage } = requesterFor(() => token);
    // First refusal: the retry signs once and the page reads fine.
    await fetchWithWalletAuth(
      "/api/x",
      undefined,
      requestAuth,
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockResolvedValueOnce(new Response("{}", { status: 200 })),
    );
    expect(signMessage).toHaveBeenCalledTimes(1);

    // The window passes while that signature is still fresh, and the token is
    // refused again: the retry rides the signature already in hand.
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const result = await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);

    expect(result.response.status).toBe(200);
    expect(signMessage).toHaveBeenCalledTimes(1);
    const retry = fetchImpl.mock.calls[1][1] as { headers: Headers };
    expect(retry.headers.get(WALLET_AUTH_SIGNATURE_HEADER)).toBe(SIG);
  });

  it("still re-signs a signature the server refused (it aged out)", async () => {
    const { requestAuth, signMessage } = requesterFor(() => undefined);
    await requestAuth();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  it("the third-party fetch lets a refused token recover too", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth } = requesterFor(() => token);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const wrapped = walletAuthFetch(requestAuth, "https://app.example", fetchImpl);
    await wrapped("/api/unlink/x");
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    await wrapped("/api/unlink/x");
    const later = fetchImpl.mock.calls[1][1] as { headers: Headers };
    expect(later.headers.get("authorization")).toBe(`Bearer ${token}`);
  });

  // The claim loop's cadence. Each scenario below runs the real poll rhythm,
  // so "heals" and "never loops" are counted, not inferred from one read.
  const POLL_MS = 800;
  const bearerSent = (init: RequestInit | undefined) =>
    new Headers(init?.headers).get("authorization");

  it("heals a transient 401: the polls ride the signature, then the token again", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth, signMessage } = requesterFor(() => token);
    // Dynamic's keys are unreachable for one request; the token itself is good.
    let blipped = false;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (bearerSent(init) !== null && !blipped) {
        blipped = true;
        return new Response("{}", { status: 401 });
      }
      return new Response("{}", { status: 200 });
    });

    const rodeOn: Array<"token" | "signature"> = [];
    for (let t = 0; t <= 60_000; t += POLL_MS) {
      vi.setSystemTime(NOW + t);
      const result = await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);
      expect(result.response.status).toBe(200);
      rodeOn.push(bearerOf(result.auth) === null ? "signature" : "token");
    }

    // One signature for the blip, the signature through the window, and the
    // first poll past it back on the token for good.
    expect(signMessage).toHaveBeenCalledTimes(1);
    const healedAt = rodeOn.indexOf("token") * POLL_MS;
    expect(healedAt).toBeGreaterThanOrEqual(REFUSED_SESSION_TOKEN_RETRY_MS);
    expect(healedAt).toBeLessThan(REFUSED_SESSION_TOKEN_RETRY_MS + POLL_MS);
    expect(rodeOn.slice(rodeOn.indexOf("token")).every((on) => on === "token")).toBe(true);
  });

  it("never loops on a token the server always refuses", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth, signMessage } = requesterFor(() => token);
    let tokenSends = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (bearerSent(init) !== null) {
        tokenSends += 1;
        return new Response("{}", { status: 401 });
      }
      return new Response("{}", { status: 200 });
    });

    // Seven minutes of polls, inside the signature's eight-minute life.
    for (let t = 0; t <= 7 * 60_000; t += POLL_MS) {
      vi.setSystemTime(NOW + t);
      const before = fetchImpl.mock.calls.length;
      const result = await fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl);
      expect(result.response.status).toBe(200);
      // A read is at most the try and the one retry, never a chain.
      expect(fetchImpl.mock.calls.length - before).toBeLessThanOrEqual(2);
    }

    // Windows of 30s, 60s, 120s and 240s: four tries in 526 polls, one
    // signature, and every read answered.
    expect(tokenSends).toBe(4);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("gives a rotated token its own try at once, with its own short window", async () => {
    const original = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const rotated = sessionToken({ expMs: NOW + 6 * 60 * 60 * 1000 });
    let current = original;
    const { requestAuth } = requesterFor(() => current);
    const refused = () => vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));

    // The original is refused twice, so it sits out a doubled window.
    await fetchWithWalletAuth("/api/x", undefined, requestAuth, refused());
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    const secondAt = Date.now();
    await fetchWithWalletAuth("/api/x", undefined, requestAuth, refused());

    // Dynamic rotates the token inside that window: the new one is sent now.
    current = rotated;
    vi.setSystemTime(secondAt + 1_000);
    expect(bearerOf(await requestAuth())).toBe(`Bearer ${rotated}`);

    // Refused once, the rotated token waits the first window, not the
    // original's doubled one.
    const rotatedAt = Date.now();
    await fetchWithWalletAuth("/api/x", undefined, requestAuth, refused());
    vi.setSystemTime(rotatedAt + REFUSED_SESSION_TOKEN_RETRY_MS - 1_000);
    expect(bearerOf(await requestAuth())).toBeNull();
    vi.setSystemTime(rotatedAt + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    expect(bearerOf(await requestAuth())).toBe(`Bearer ${rotated}`);
  });

  it("serves the signature in hand while the token is set aside, page-load reads included", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const signMessage = vi.fn().mockResolvedValue(SIG);
    const prompting = walletAuthRequester({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => token,
      proveSession: null,
    });
    const quiet = cachedOnlyRequester(prompting);

    // A tapped read meets the refusal and signs once.
    await fetchWithWalletAuth(
      "/api/x",
      undefined,
      prompting,
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockResolvedValueOnce(new Response("{}", { status: 200 })),
    );
    expect(signMessage).toHaveBeenCalledTimes(1);

    // Inside the window, a page-load read (which may never prompt) carries
    // that signature instead of going out unsigned.
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS / 2);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const read = await fetchWithWalletAuth("/api/wearable/progress", undefined, quiet, fetchImpl);
    expect(read.auth.kind).toBe("ok");
    const sent = fetchImpl.mock.calls[0][1] as { headers: Headers };
    expect(sent.headers.get("authorization")).toBeNull();
    expect(sent.headers.get(WALLET_AUTH_SIGNATURE_HEADER)).toBe(SIG);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("counts refusals that land together as one, so a blip across several cards heals in the first window", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth, signMessage } = requesterFor(() => token);
    let release: () => void = () => {};
    const blip = new Promise<void>((resolve) => {
      release = resolve;
    });
    let tokenSends = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (bearerSent(init) !== null) {
        tokenSends += 1;
        await blip;
        return new Response("{}", { status: 401 });
      }
      return new Response("{}", { status: 200 });
    });

    // Three cards read at once and all three meet the same blip.
    const reads = Promise.all(
      [0, 1, 2].map(() => fetchWithWalletAuth("/api/x", undefined, requestAuth, fetchImpl)),
    );
    await vi.waitFor(() => expect(tokenSends).toBe(3));
    release();
    const results = await reads;
    expect(results.every((result) => result.response.status === 200)).toBe(true);
    // The three retries share one signature.
    expect(signMessage).toHaveBeenCalledTimes(1);

    // One blip is one refusal: the token is back after the first window.
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    expect(bearerOf(await requestAuth())).toBe(`Bearer ${token}`);
  });
});

// ------------------------- a route that redacts cannot refuse a token
//
// The claim read (/api/agent/run/[goalId]) never answers 401: a proof it
// cannot check gets the redacted claim with a 200, by design. So it can never
// tell this tab a token is bad, and its 200 says nothing about the token. If a
// token the server refused were sent there again once its window passed, the
// owner would see a withheld claim with a good signature in hand, and the
// claim's "Sign again" would hand back the same token instead of signing: a
// button that does nothing for as long as the server keeps refusing. A token
// refused in this tab stays aside there until a route that can refuse it has
// accepted it again.

describe("a refused token and the claim read, which redacts instead of refusing", () => {
  const SIG = `0x${"41".repeat(65)}`;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    return () => {
      vi.useRealTimers();
    };
  });

  const bearerSent = (init: RequestInit | undefined) =>
    new Headers(init?.headers).get("authorization");
  const isClaimRead = (input: RequestInfo | URL) => String(input).startsWith("/api/agent/run/");

  /** The server as it is: every route but the claim read answers a proof it
   *  will not take with 401; the claim read redacts. `tokenGood` is whether
   *  the server can check the token right now. */
  function server(tokenGood: () => boolean) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const refused = bearerSent(init) !== null && !tokenGood();
      if (isClaimRead(input)) {
        return Response.json({ hasLedger: true, access: refused ? "unproven" : "owner" });
      }
      return new Response("{}", { status: refused ? 401 : 200 });
    });
  }

  function requesterFor(token: () => string) {
    const signMessage = vi.fn().mockResolvedValue(SIG);
    const requestAuth = (options?: { refresh?: boolean; cachedOnly?: boolean }) =>
      getWalletAuth({
        address: ADDRESS,
        signMessage,
        getSessionToken: token,
        now: () => Date.now(),
        ...options,
      });
    return { requestAuth, signMessage };
  }

  it("keeps the claim read on the signature after the window, and Sign again signs", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth, signMessage } = requesterFor(() => token);
    // The server cannot check the token at all (an outage, a skewed clock).
    const fetchImpl = server(() => false);

    await fetchWithWalletAuth("/api/wearable/progress", undefined, requestAuth, fetchImpl);
    expect(signMessage).toHaveBeenCalledTimes(1);

    // Past the window, the claim read still rides the signature in hand.
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    const read = await fetchWithWalletAuth(
      "/api/agent/run/0x1?poolId=1",
      undefined,
      requestAuth,
      fetchImpl,
    );
    expect(await read.response.json()).toMatchObject({ access: "owner" });

    // The claim's Sign again (a refresh, which drops the signature) and the
    // re-read it triggers: the read signs instead of resending the token.
    await requestAuth({ refresh: true });
    const again = await fetchWithWalletAuth(
      "/api/agent/run/0x1",
      { method: "POST" },
      requestAuth,
      fetchImpl,
    );
    expect(await again.response.json()).toMatchObject({ access: "owner" });
    expect(bearerSent(fetchImpl.mock.calls.at(-1)?.[1])).toBeNull();
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  it("a page-load claim read with no signature stays unsigned rather than resending the token", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth } = requesterFor(() => token);
    const quiet = cachedOnlyRequester(requestAuth);
    const fetchImpl = server(() => false);

    await fetchWithWalletAuth("/api/wearable/progress", undefined, quiet, fetchImpl);
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    const read = await fetchWithWalletAuth("/api/agent/run/0x1", undefined, quiet, fetchImpl);
    expect(read.auth).toEqual({ kind: "unsigned" });
    expect(bearerSent(fetchImpl.mock.calls.at(-1)?.[1])).toBeNull();
  });

  it("goes back to the token once a route that can refuse it accepts it again", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth, signMessage } = requesterFor(() => token);
    let good = false;
    const fetchImpl = server(() => good);

    // A blip: refused once, and the retry signs.
    await fetchWithWalletAuth("/api/wearable/progress", undefined, requestAuth, fetchImpl);
    good = true;

    // The window passes; the next read that can refuse it takes the token.
    vi.setSystemTime(NOW + REFUSED_SESSION_TOKEN_RETRY_MS + 1_000);
    const healed = await fetchWithWalletAuth(
      "/api/wearable/progress",
      undefined,
      requestAuth,
      fetchImpl,
    );
    expect(bearerOf(healed.auth)).toBe(`Bearer ${token}`);

    // So the claim read is back on the token too, with no new signature.
    const read = await fetchWithWalletAuth("/api/agent/run/0x1", undefined, requestAuth, fetchImpl);
    expect(bearerOf(read.auth)).toBe(`Bearer ${token}`);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("sends a token that was never refused to the claim read as before", async () => {
    const token = sessionToken({ expMs: NOW + 5 * 60 * 60 * 1000 });
    const { requestAuth, signMessage } = requesterFor(() => token);
    const fetchImpl = server(() => true);
    const read = await fetchWithWalletAuth("/api/agent/run/0x1", undefined, requestAuth, fetchImpl);
    expect(bearerOf(read.auth)).toBe(`Bearer ${token}`);
    expect(signMessage).not.toHaveBeenCalled();
  });

  const bearerOf = (auth: ClientAuth) =>
    auth.kind === "ok" ? (auth.headers.authorization ?? null) : null;
});
