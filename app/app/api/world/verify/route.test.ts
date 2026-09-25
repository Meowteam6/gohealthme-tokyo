import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "viem/accounts";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { walletAuthMessage } from "@/lib/server/wallet-auth";

// The verify route is the one door through which a wallet becomes "one
// human". Pinned end to end through the real handlers, with a real wallet
// signature and the real file store:
//   - the success path in event (mock) mode, and that status flips to verified
//   - the two 409s: same human on a second wallet (with the first wallet
//     named), and a second human on a bound wallet
//   - a proof made for another wallet is refused even with a valid signature
//   - an unsigned call, a malformed proof, and a deployment with the mode off
//   - the live path against a stubbed World verify API, success and refusal

const A = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const B = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const ACTION = "prove-human";

async function signedHeaders(account: typeof A): Promise<Record<string, string>> {
  const timestamp = new Date().toISOString();
  return {
    "x-gohealthme-address": account.address,
    "x-gohealthme-timestamp": timestamp,
    "x-gohealthme-signature": await account.signMessage({
      message: walletAuthMessage(account.address, timestamp),
    }),
  };
}

/** An IDKit-shaped payload for `address`, as ProveHuman builds it in event
 *  mode. `identity` stands in for the human. */
function proofFor(address: string, identity: string, environment = "mock") {
  return {
    protocol_version: "4.0",
    nonce: "0x01",
    action: ACTION,
    environment,
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: hashSignal(address.toLowerCase()),
        proof: ["0x0", "0x0", "0x0", "0x0", "0x0"],
        nullifier: hashSignal(`identity:${identity}`),
        issuer_schema_id: 1,
        expires_at_min: 1_900_000_000,
      },
    ],
  };
}

async function load(env: Record<string, string>) {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "world-verify-")));
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const verify = await import("@/app/api/world/verify/route");
  const status = await import("@/app/api/world/status/route");
  return { verify, status };
}

function post(
  route: { POST: (r: Request) => Promise<Response> },
  body: unknown,
  headers: Record<string, string> = {},
) {
  return route.POST(
    new Request("http://localhost/api/world/verify", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function statusOf(route: { GET: (r: Request) => Promise<Response> }, address: string) {
  return route
    .GET(new Request(`http://localhost/api/world/status?address=${address}`))
    .then((r) => r.json());
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/world/verify (event mode)", () => {
  it("binds a signed mock proof and flips status to verified", async () => {
    const { verify, status } = await load({ WORLD_VERIFY_MODE: "mock" });
    expect(await statusOf(status, A.address)).toEqual({
      human: "unverified",
      mode: "mock",
    });

    const res = await post(
      verify,
      { address: A.address, proof: proofFor(A.address, "andre") },
      await signedHeaders(A),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, mode: "mock", created: true });
    expect(body.nullifierHash).toMatch(/^0x[0-9a-f]{64}$/);

    const after = await statusOf(status, A.address);
    expect(after.human).toBe("verified");
    expect(after.mode).toBe("mock");
    expect(after.verifiedAt).toBe(body.verifiedAt);

    // Verifying again with the same wallet and identity is a no-op, not a 409.
    const again = await post(
      verify,
      { address: A.address, proof: proofFor(A.address, "andre") },
      await signedHeaders(A),
    );
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);
  });

  it("refuses the same human on a second wallet and names the first wallet", async () => {
    const { verify, status } = await load({ WORLD_VERIFY_MODE: "mock" });
    await post(verify, { address: A.address, proof: proofFor(A.address, "andre") }, await signedHeaders(A));

    const res = await post(
      verify,
      { address: B.address, proof: proofFor(B.address, "andre") },
      await signedHeaders(B),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflict).toBe("human-has-other-wallet");
    expect(body.otherWallet).toBe(A.address);
    expect(body.error).toMatch(/Sign in with that wallet/);
    expect((await statusOf(status, B.address)).human).toBe("unverified");
  });

  it("refuses a second human on an already bound wallet", async () => {
    const { verify } = await load({ WORLD_VERIFY_MODE: "mock" });
    await post(verify, { address: A.address, proof: proofFor(A.address, "andre") }, await signedHeaders(A));

    const res = await post(
      verify,
      { address: A.address, proof: proofFor(A.address, "nikki") },
      await signedHeaders(A),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).conflict).toBe("wallet-has-other-human");
  });

  it("refuses a proof made for another wallet even when the signature is valid", async () => {
    const { verify, status } = await load({ WORLD_VERIFY_MODE: "mock" });
    const res = await post(
      verify,
      { address: A.address, proof: proofFor(B.address, "andre") },
      await signedHeaders(A),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/different wallet/);
    expect((await statusOf(status, A.address)).human).toBe("unverified");
  });

  it("refuses an unsigned call, and a signature for a different wallet", async () => {
    const { verify } = await load({ WORLD_VERIFY_MODE: "mock" });
    const unsigned = await post(verify, { address: A.address, proof: proofFor(A.address, "andre") });
    expect(unsigned.status).toBe(401);

    const wrongSigner = await post(
      verify,
      { address: A.address, proof: proofFor(A.address, "andre") },
      await signedHeaders(B),
    );
    expect(wrongSigner.status).toBe(401);
  });

  it("rejects a malformed body before touching the wallet signature", async () => {
    const { verify } = await load({ WORLD_VERIFY_MODE: "mock" });
    expect((await post(verify, { address: "nope", proof: {} })).status).toBe(400);
    expect((await post(verify, { address: A.address, proof: "x" })).status).toBe(400);
    expect(
      (await post(verify, { address: A.address, proof: { protocol_version: "9" } })).status,
    ).toBe(400);
  });

  it("answers 503 with the reason when prove-human is off on this deployment", async () => {
    const { verify, status } = await load({ WORLD_VERIFY_MODE: "" });
    const res = await post(
      verify,
      { address: A.address, proof: proofFor(A.address, "andre") },
      await signedHeaders(A),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not enabled/);
    expect(await statusOf(status, A.address)).toEqual({ human: "unverified", mode: "off" });
  });

  it("answers 400 for a bad address on the status route", async () => {
    const { status } = await load({ WORLD_VERIFY_MODE: "mock" });
    const res = await status.GET(new Request("http://localhost/api/world/status?address=nope"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/world/verify (live mode)", () => {
  const LIVE = {
    WORLD_VERIFY_MODE: "live",
    WORLD_APP_ID: "app_test",
    WORLD_RP_ID: "rp_test",
    WORLD_RP_SIGNING_KEY: "0x11",
    WORLD_ENVIRONMENT: "staging",
  };

  /**
   * Stub fetch for World's verify API only. The wallet-signature check in
   * lib/server/wallet-auth.ts goes through viem's public client, which asks
   * the chain (ERC-6492 path) before falling back to offline recovery, so a
   * blanket fetch stub would also swallow those RPC calls. Everything that is
   * not World passes through untouched.
   */
  function stubWorldFetch(answer: (init: RequestInit | undefined) => Response) {
    const realFetch = globalThis.fetch;
    const worldCalls = vi.fn(answer);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://developer.world.org/api/v4/verify/")) {
        return worldCalls(init);
      }
      return realFetch(input, init);
    });
    return worldCalls;
  }

  function worldJson(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("forwards the proof to World and binds the returned nullifier", async () => {
    const worldCalls = stubWorldFetch(() =>
      worldJson(200, { success: true, nullifier: "12345", environment: "staging" }),
    );
    const { verify, status } = await load(LIVE);
    const res = await post(
      verify,
      { address: A.address, proof: proofFor(A.address, "andre", "staging") },
      await signedHeaders(A),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("live");
    expect(body.nullifierHash).toBe(`0x${(12345).toString(16).padStart(64, "0")}`);
    expect(worldCalls).toHaveBeenCalledTimes(1);
    // Forwarded as-is: the body World sees is the payload the widget produced.
    const forwarded = JSON.parse(worldCalls.mock.calls[0][0]?.body as string);
    expect(forwarded).toEqual(proofFor(A.address, "andre", "staging"));
    expect((await statusOf(status, A.address)).human).toBe("verified");
  });

  it("refuses when World rejects the proof, and records nothing", async () => {
    stubWorldFetch(() =>
      worldJson(400, { success: false, code: "all_verifications_failed", detail: "bad" }),
    );
    const { verify, status } = await load(LIVE);
    const res = await post(
      verify,
      { address: A.address, proof: proofFor(A.address, "andre", "staging") },
      await signedHeaders(A),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/could not verify/);
    expect((await statusOf(status, A.address)).human).toBe("unverified");
  });

  it("refuses a mock-environment payload on a live deployment without calling World", async () => {
    const worldCalls = stubWorldFetch(() => worldJson(200, { success: true }));
    const { verify } = await load(LIVE);
    const res = await post(
      verify,
      { address: A.address, proof: proofFor(A.address, "andre", "mock") },
      await signedHeaders(A),
    );
    expect(res.status).toBe(401);
    expect(worldCalls).not.toHaveBeenCalled();
  });
});
