// POST /api/ens/claim is signature-gated exactly like the handle claim: no
// signature, or a signature from a different wallet, never reaches the mint.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { authHeadersOf } from "@/lib/client-auth";
import { walletAuthMessage } from "@/lib/server/wallet-auth";

const claimEnsName = vi.fn();
vi.mock("@/lib/server/ens/claim", () => ({
  claimEnsName: (...args: unknown[]) => claimEnsName(...args),
  liveClaimDeps: () => ({}),
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

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ens/claim", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  claimEnsName.mockReset();
});

describe("POST /api/ens/claim", () => {
  it("401s without a signature and never mints", async () => {
    const { POST } = await import("@/app/api/ens/claim/route");
    const res = await POST(post({ address: OWNER.address, label: "ironhabit" }));
    expect(res.status).toBe(401);
    expect(claimEnsName).not.toHaveBeenCalled();
  });

  it("401s when another wallet signed for this address", async () => {
    const { POST } = await import("@/app/api/ens/claim/route");
    const headers = await signedHeaders(STRANGER, OWNER.address);
    const res = await POST(post({ address: OWNER.address, label: "ironhabit" }, headers));
    expect(res.status).toBe(401);
    expect(claimEnsName).not.toHaveBeenCalled();
  });

  it("mints for the signing wallet and returns the name and tx", async () => {
    claimEnsName.mockResolvedValue({
      ok: true,
      name: "ironhabit.gohealthme.eth",
      label: "ironhabit",
      tx: `0x${"22".repeat(32)}`,
      alreadyOwned: false,
    });
    const { POST } = await import("@/app/api/ens/claim/route");
    const headers = await signedHeaders(OWNER, OWNER.address);
    const res = await POST(post({ address: OWNER.address, label: "ironhabit" }, headers));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "ironhabit.gohealthme.eth" });
    expect(claimEnsName.mock.calls[0][0]).toMatchObject({ address: OWNER.address, rawLabel: "ironhabit" });
  });

  it("passes a refusal through with its status", async () => {
    claimEnsName.mockResolvedValue({ ok: false, status: 409, reason: "That name is already taken." });
    const { POST } = await import("@/app/api/ens/claim/route");
    const headers = await signedHeaders(OWNER, OWNER.address);
    const res = await POST(post({ address: OWNER.address, label: "ironhabit" }, headers));
    expect(res.status).toBe(409);
  });
});
