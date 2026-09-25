import { describe, it, expect, vi } from "vitest";
import type { ClientAuth } from "@/lib/client-auth";
import {
  fetchHumanStatus,
  fetchWorldConfig,
  mintRpContext,
  signatureBlockReason,
  submitProof,
} from "@/lib/world/api";

// The browser-side reading of the prove-human routes. Pinned: only a server
// `ok: true` becomes a client success; every refusal keeps its reason and the
// 409's conflict details; a missing wallet signature is reported as such and
// never sent as a success.

const ADDRESS = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const OK_AUTH: ClientAuth = {
  kind: "ok",
  credential: { address: ADDRESS, timestamp: "t", signature: "0x1" },
  headers: { "x-gohealthme-address": ADDRESS },
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchWorldConfig / mintRpContext", () => {
  it("reads GET for config and POST for a fresh context", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
      json(200, init?.method === "POST" ? { mode: "mock", action: "a", minted: true } : { mode: "off", problem: null }),
    ) as unknown as typeof fetch;
    expect(await fetchWorldConfig(fetchImpl)).toEqual({ mode: "off", problem: null });
    expect(await mintRpContext(fetchImpl)).toMatchObject({ mode: "mock", minted: true });
  });

  it("throws on a non-2xx so the card shows a retry, not a blank", async () => {
    const fetchImpl = vi.fn(async () => json(500, { error: "x" })) as unknown as typeof fetch;
    await expect(fetchWorldConfig(fetchImpl)).rejects.toThrow(/500/);
  });
});

describe("fetchHumanStatus", () => {
  it("returns the server view", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`/api/world/status?address=${ADDRESS}`);
      return json(200, { human: "verified", verifiedAt: "2026-09-26T00:00:00.000Z", mode: "mock" });
    }) as unknown as typeof fetch;
    expect(await fetchHumanStatus(ADDRESS, fetchImpl)).toEqual({
      human: "verified",
      verifiedAt: "2026-09-26T00:00:00.000Z",
      mode: "mock",
    });
  });
});

describe("submitProof", () => {
  it("returns success only when the server says ok", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { ok: true, nullifierHash: "0xabc", mode: "mock", created: true }),
    ) as unknown as typeof fetch;
    const result = await submitProof({
      address: ADDRESS,
      proof: { protocol_version: "4.0" },
      requestAuth: async () => OK_AUTH,
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, nullifierHash: "0xabc", mode: "mock", created: true, credential: null });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-gohealthme-address")).toBe(ADDRESS);
    expect(JSON.parse(init.body as string)).toEqual({ address: ADDRESS, proof: { protocol_version: "4.0" } });
  });

  it("carries the 409 conflict and the other wallet through", async () => {
    const fetchImpl = vi.fn(async () =>
      json(409, {
        error: "You already proved you're one human with wallet 0x8ba1...BA72.",
        conflict: "human-has-other-wallet",
        otherWallet: ADDRESS,
      }),
    ) as unknown as typeof fetch;
    const result = await submitProof({
      address: "0x2222222222222222222222222222222222222222",
      proof: {},
      requestAuth: async () => OK_AUTH,
      fetchImpl,
    });
    expect(result).toEqual({
      ok: false,
      status: 409,
      reason: "You already proved you're one human with wallet 0x8ba1...BA72.",
      conflict: "human-has-other-wallet",
      otherWallet: ADDRESS,
    });
  });

  it("keeps a 401 reason and never invents a success from a 200 without ok", async () => {
    const refused = await submitProof({
      address: ADDRESS,
      proof: {},
      requestAuth: async () => OK_AUTH,
      fetchImpl: vi.fn(async () => json(401, { error: "That proof was made for a different wallet." })) as unknown as typeof fetch,
    });
    expect(refused).toEqual({
      ok: false,
      status: 401,
      reason: "That proof was made for a different wallet.",
    });

    const odd = await submitProof({
      address: ADDRESS,
      proof: {},
      requestAuth: async () => OK_AUTH,
      fetchImpl: vi.fn(async () => json(200, { something: "else" })) as unknown as typeof fetch,
    });
    expect(odd.ok).toBe(false);
  });

  it("reports a declined or missing wallet signature without sending a verdict", async () => {
    const fetchImpl = vi.fn(async () => json(200, { ok: true })) as unknown as typeof fetch;
    const declined = await submitProof({
      address: ADDRESS,
      proof: {},
      requestAuth: async () => ({ kind: "declined" }),
      fetchImpl,
    });
    expect(declined).toEqual({
      ok: false,
      status: 0,
      reason: signatureBlockReason({ kind: "declined" }),
    });
    expect(declined.ok).toBe(false);
    expect(signatureBlockReason({ kind: "no-wallet" })).toMatch(/Connect your wallet/);
    expect(signatureBlockReason({ kind: "failed", message: "boom" })).toContain("boom");
  });

  it("reports a network failure as a retryable state", async () => {
    const result = await submitProof({
      address: ADDRESS,
      proof: {},
      requestAuth: async () => OK_AUTH,
      fetchImpl: vi.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false, status: 0 });
    if (!result.ok) expect(result.reason).toMatch(/connection/);
  });
});
