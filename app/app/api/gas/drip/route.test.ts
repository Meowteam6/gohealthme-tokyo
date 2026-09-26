import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  WALLET_AUTH_ADDRESS_HEADER,
  WALLET_AUTH_SIGNATURE_HEADER,
  WALLET_AUTH_TIMESTAMP_HEADER,
  walletAuthMessage,
} from "@/lib/server/wallet-auth";

// POST /api/gas/drip. The drip logic is unit-tested in lib/server/gas-drip;
// this pins the HTTP contract: a signature for THAT address is required, and
// every outcome maps to its status with plain copy.

const runGasDrip = vi.fn();
vi.mock("@/lib/server/gas-drip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/gas-drip")>();
  return {
    ...actual,
    liveGasDripDeps: () => ({}),
    runGasDrip: (...a: unknown[]) => runGasDrip(...a),
  };
});

const OWNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const STRANGER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

async function signedHeaders(signer = OWNER): Promise<Record<string, string>> {
  const timestamp = new Date().toISOString();
  const signature = await signer.signMessage({
    message: walletAuthMessage(signer.address, timestamp),
  });
  return {
    [WALLET_AUTH_ADDRESS_HEADER]: signer.address,
    [WALLET_AUTH_TIMESTAMP_HEADER]: timestamp,
    [WALLET_AUTH_SIGNATURE_HEADER]: signature,
  };
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/gas/drip", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown, headers?: Record<string, string>) {
  const { POST } = await import("@/app/api/gas/drip/route");
  return POST(req(body, headers));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/gas/drip", () => {
  it("refuses a bad address", async () => {
    const res = await post({ address: "nope" }, await signedHeaders());
    expect(res.status).toBe(400);
    expect(runGasDrip).not.toHaveBeenCalled();
  });

  it("requires a signature", async () => {
    const res = await post({ address: OWNER.address });
    expect(res.status).toBe(401);
    expect(runGasDrip).not.toHaveBeenCalled();
  });

  it("refuses a signature for a different address", async () => {
    const res = await post({ address: OWNER.address }, await signedHeaders(STRANGER));
    expect(res.status).toBe(401);
    expect(runGasDrip).not.toHaveBeenCalled();
  });

  it("returns the drip with the balance read back", async () => {
    runGasDrip.mockResolvedValue({
      kind: "dripped",
      tx: "0xabc",
      balanceWei: 500_000_000_000_000n,
      minWei: 200_000_000_000_000n,
    });
    const res = await post({ address: OWNER.address }, await signedHeaders());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dripped: true,
      tx: "0xabc",
      balanceWei: "500000000000000",
      minWei: "200000000000000",
    });
    expect(runGasDrip.mock.calls[0][0]).toBe(OWNER.address);
  });

  it("answers a funded wallet with dripped:false", async () => {
    runGasDrip.mockResolvedValue({
      kind: "funded",
      balanceWei: 900_000_000_000_000n,
      minWei: 200_000_000_000_000n,
    });
    const res = await post({ address: OWNER.address }, await signedHeaders());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dripped: false,
      balanceWei: "900000000000000",
      minWei: "200000000000000",
    });
  });

  it("maps the caps to 429 with Retry-After and plain copy", async () => {
    runGasDrip.mockResolvedValue({
      kind: "address-cap",
      retryAfterSeconds: 3600,
      message: "This wallet has had 3 gas top-ups today.",
    });
    const res = await post({ address: OWNER.address }, await signedHeaders());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    const body = await res.json();
    expect(body.error).toBe("This wallet has had 3 gas top-ups today.");
    expect(body.reason).toBe("address-cap");
  });

  it("maps the treasury floor to 503 with plain copy", async () => {
    runGasDrip.mockResolvedValue({ kind: "treasury-low", message: "Our test ETH supply is low." });
    const res = await post({ address: OWNER.address }, await signedHeaders());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Our test ETH supply is low.");
    expect(body.reason).toBe("treasury-low");
  });

  it("maps a failed send to 502 without leaking the error", async () => {
    runGasDrip.mockResolvedValue({
      kind: "failed",
      message: "We could not send test ETH for gas.",
      error: new Error("RPC https://secret-endpoint exploded"),
    });
    const res = await post({ address: OWNER.address }, await signedHeaders());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("We could not send test ETH for gas.");
    expect(text).not.toContain("secret-endpoint");
  });
});
