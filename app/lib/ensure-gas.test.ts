import { describe, it, expect, vi } from "vitest";
import type { Address } from "viem";
import type { ClientAuth } from "@/lib/client-auth";
import {
  CLIENT_GAS_MIN_WEI,
  GAS_DRIP_STATUS_LINE,
  ensureGas,
  type EnsureGasDeps,
} from "@/lib/ensure-gas";
import { GasDripRefusedError, humanizeTxError, NEEDS_GAS_TITLE } from "@/lib/tx-errors";

const ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const DRIP = 500_000_000_000_000n;

const OK_AUTH: ClientAuth = {
  kind: "ok",
  credential: { address: ADDRESS, timestamp: "t", signature: "0x01" },
  headers: { "x-gohealthme-signature": "0x01" },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deps(overrides: Partial<EnsureGasDeps> = {}): EnsureGasDeps & {
  lines: (string | null)[];
} {
  const lines: (string | null)[] = [];
  return {
    address: ADDRESS,
    readBalance: vi.fn(async () => 0n),
    requestAuth: vi.fn(async () => OK_AUTH),
    fetchImpl: vi.fn(async () =>
      json(200, { dripped: true, tx: "0xabc", balanceWei: DRIP.toString(), minWei: CLIENT_GAS_MIN_WEI.toString() }),
    ) as unknown as typeof fetch,
    onStatus: (line) => lines.push(line),
    sleep: async () => undefined,
    now: () => 0,
    lines,
    ...overrides,
  };
}

describe("ensureGas", () => {
  it("does nothing for a wallet that already has gas", async () => {
    const d = deps({ readBalance: vi.fn(async () => CLIENT_GAS_MIN_WEI) });
    const result = await ensureGas(d);
    expect(result).toEqual({ dripped: false, balanceWei: CLIENT_GAS_MIN_WEI });
    expect(d.fetchImpl).not.toHaveBeenCalled();
    expect(d.requestAuth).not.toHaveBeenCalled();
    expect(d.lines).toEqual([]);
  });

  it("signs, asks for the drip, and waits until the wallet shows it", async () => {
    const balances = [0n, 0n, DRIP];
    const d = deps({ readBalance: vi.fn(async () => balances.shift() ?? DRIP) });
    const result = await ensureGas(d);
    expect(result).toEqual({ dripped: true, balanceWei: DRIP });
    const [url, init] = (d.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/gas/drip");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ address: ADDRESS });
    expect(new Headers(init.headers).get("x-gohealthme-signature")).toBe("0x01");
    // One plain status line while it runs, cleared at the end.
    expect(d.lines).toEqual([GAS_DRIP_STATUS_LINE, null]);
  });

  it("surfaces a refused drip as plain copy with the next step", async () => {
    const d = deps({
      fetchImpl: vi.fn(async () =>
        json(429, {
          error: "This wallet has had 3 gas top-ups today. Try again in about 4 hours, or get Base Sepolia ETH from the faucet.",
          reason: "address-cap",
          retryAfterSeconds: 14400,
        }),
      ) as unknown as typeof fetch,
    });
    const err = await ensureGas(d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GasDripRefusedError);
    const human = humanizeTxError(err);
    expect(human.title).toBe(NEEDS_GAS_TITLE);
    expect(human.detail).toMatch(/Try again in about 4 hours/);
    expect(d.lines.at(-1)).toBeNull();
  });

  it("says so plainly when the player declines to sign", async () => {
    const d = deps({ requestAuth: vi.fn(async () => ({ kind: "declined" }) as ClientAuth) });
    const err = await ensureGas(d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GasDripRefusedError);
    expect((err as Error).message).toMatch(/sign/i);
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to continue when the drip never shows up in the wallet", async () => {
    let t = 0;
    const d = deps({
      readBalance: vi.fn(async () => 0n),
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    const err = await ensureGas(d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GasDripRefusedError);
    expect((err as Error).message).toMatch(/does not show it yet/);
  });

  it("still asks the server when the balance read fails", async () => {
    const reads = [Promise.reject(new Error("rpc down")), Promise.resolve(DRIP)];
    const d = deps({ readBalance: vi.fn(() => reads.shift() ?? Promise.resolve(DRIP)) });
    const result = await ensureGas(d);
    expect(result.dripped).toBe(true);
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("continues without waiting when the server says the wallet is funded", async () => {
    const d = deps({
      readBalance: vi.fn(async () => 0n),
      fetchImpl: vi.fn(async () =>
        json(200, { dripped: false, balanceWei: "300000000000000", minWei: "200000000000000" }),
      ) as unknown as typeof fetch,
    });
    const result = await ensureGas(d);
    expect(result).toEqual({ dripped: false, balanceWei: 300_000_000_000_000n });
  });
});
