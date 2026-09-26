// POST /api/ens/link is signature-gated like the claim: no signature, or a
// signature from another wallet, never reaches resolution or the store.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { authHeadersOf } from "@/lib/client-auth";
import { walletAuthMessage } from "@/lib/server/wallet-auth";

const linkEnsName = vi.fn();
const unlinkEnsName = vi.fn();
vi.mock("@/lib/server/ens/link", () => ({
  linkEnsName: (...args: unknown[]) => linkEnsName(...args),
  unlinkEnsName: (...args: unknown[]) => unlinkEnsName(...args),
  liveLinkDeps: () => ({}),
}));

const OWNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const STRANGER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

async function signedHeaders(signer: typeof OWNER, claimed: string) {
  const timestamp = new Date().toISOString();
  const signature = await signer.signMessage({ message: walletAuthMessage(claimed, timestamp) });
  return authHeadersOf({ address: claimed, timestamp, signature });
}

function req(method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ens/link", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  linkEnsName.mockReset();
  unlinkEnsName.mockReset();
  vi.stubEnv("WORLD_VERIFY_MODE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/ens/link", () => {
  it("401s without a signature and never resolves", async () => {
    const { POST } = await import("@/app/api/ens/link/route");
    const res = await POST(req("POST", { address: OWNER.address, name: "andre.eth" }));
    expect(res.status).toBe(401);
    expect(linkEnsName).not.toHaveBeenCalled();
  });

  it("401s when another wallet signed", async () => {
    const { POST } = await import("@/app/api/ens/link/route");
    const headers = await signedHeaders(STRANGER, OWNER.address);
    const res = await POST(req("POST", { address: OWNER.address, name: "andre.eth" }, headers));
    expect(res.status).toBe(401);
    expect(linkEnsName).not.toHaveBeenCalled();
  });

  it("links for the signing wallet", async () => {
    linkEnsName.mockResolvedValue({ ok: true, name: "andre.eth", chain: "mainnet" });
    const { POST } = await import("@/app/api/ens/link/route");
    const headers = await signedHeaders(OWNER, OWNER.address);
    const res = await POST(req("POST", { address: OWNER.address, name: "andre.eth" }, headers));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "andre.eth", chain: "mainnet" });
    expect(linkEnsName.mock.calls[0][0]).toEqual({ address: OWNER.address, rawName: "andre.eth" });
  });

  it("passes a refusal through with its status", async () => {
    linkEnsName.mockResolvedValue({ ok: false, status: 403, reason: "andre.eth points at a different wallet." });
    const { POST } = await import("@/app/api/ens/link/route");
    const headers = await signedHeaders(OWNER, OWNER.address);
    const res = await POST(req("POST", { address: OWNER.address, name: "andre.eth" }, headers));
    expect(res.status).toBe(403);
  });

  it("refuses an unverified wallet while World is on, before any lookup", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "mock");
    const { POST } = await import("@/app/api/ens/link/route");
    const headers = await signedHeaders(OWNER, OWNER.address);
    const res = await POST(req("POST", { address: OWNER.address, name: "andre.eth" }, headers));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "Prove you are one human first, then pick your name." });
    expect(linkEnsName).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/ens/link", () => {
  it("401s without a signature", async () => {
    const { DELETE } = await import("@/app/api/ens/link/route");
    const res = await DELETE(req("DELETE", { address: OWNER.address }));
    expect(res.status).toBe(401);
    expect(unlinkEnsName).not.toHaveBeenCalled();
  });

  it("unlinks for the signing wallet", async () => {
    const { DELETE } = await import("@/app/api/ens/link/route");
    const headers = await signedHeaders(OWNER, OWNER.address);
    const res = await DELETE(req("DELETE", { address: OWNER.address }, headers));
    expect(res.status).toBe(200);
    expect(unlinkEnsName).toHaveBeenCalledWith(OWNER.address);
  });
});
