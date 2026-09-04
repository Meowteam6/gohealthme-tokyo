import { describe, it, expect, vi, afterEach } from "vitest";
import { runTestUsdcFunding } from "@/lib/faucet-funding";

// The one-tap funding chain: grant -> read in-app balance -> move onto Base.
// Pinned after a live pilot bug (2026-09-04): the faucet answered 200 with
// applied:false because the wallet already held more than the refill
// threshold - a deliberate, documented skip - and the chip rendered it as
// "could not add it". The chain must tell "you have enough" apart from
// "nothing happened" and from a real refusal, so the UI can say the true thing.

const ADDRESS = "0x1111111111111111111111111111111111111111";

type Reply = { status: number; body: unknown };

function stubFetch(replies: Record<string, Reply>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      const key = Object.keys(replies).find((k) => url.startsWith(k));
      if (key === undefined) throw new Error(`unexpected fetch ${url}`);
      calls.push(key);
      const r = replies[key];
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      };
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runTestUsdcFunding", () => {
  it("reports enough when the faucet skipped a wallet that already holds the threshold", async () => {
    const calls = stubFetch({
      "/api/blink/topup": { status: 200, body: { balanceUusdc: "0", grantedUusdc: "0", applied: false } },
      "/api/balance?": { status: 200, body: { balanceUusdc: "0" } },
    });

    const result = await runTestUsdcFunding(ADDRESS);

    expect(result).toEqual({ kind: "enough" });
    // Nothing to move, so the treasury transfer is never attempted.
    expect(calls).not.toContain("/api/balance/withdraw");
  });

  it("reports empty when the faucet granted nothing and there was nothing to move", async () => {
    stubFetch({
      "/api/blink/topup": { status: 200, body: { balanceUusdc: "0", grantedUusdc: "0", applied: true } },
      "/api/balance?": { status: 200, body: { balanceUusdc: "0" } },
    });

    expect(await runTestUsdcFunding(ADDRESS)).toEqual({ kind: "empty" });
  });

  it("carries the server's own message when a cap refused the grant", async () => {
    stubFetch({
      "/api/blink/topup": { status: 429, body: { error: "Daily practice-money limit reached. Try again in about 6 hours." } },
      "/api/balance?": { status: 200, body: { balanceUusdc: "0" } },
    });

    expect(await runTestUsdcFunding(ADDRESS)).toEqual({
      kind: "budget-exhausted",
      message: "Daily practice-money limit reached. Try again in about 6 hours.",
    });
  });

  it("reports funded only after the move onto Base returned a tx hash", async () => {
    stubFetch({
      "/api/blink/topup": { status: 200, body: { balanceUusdc: "12000000", grantedUusdc: "12000000", applied: true } },
      "/api/balance?": { status: 200, body: { balanceUusdc: "12000000" } },
      "/api/balance/withdraw": { status: 200, body: { txHash: "0xfeed" } },
    });

    expect(await runTestUsdcFunding(ADDRESS)).toEqual({ kind: "funded", movedUusdc: 12_000_000n });
  });
});
