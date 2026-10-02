import { describe, it, expect, vi, afterEach } from "vitest";
import { runTestUsdcFunding } from "@/lib/faucet-funding";
import { testUsdcPausedDetail } from "@/lib/switches";

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

  it("still delivers balance already waiting when a cap refused the grant, with no note", async () => {
    stubFetch({
      "/api/blink/topup": { status: 429, body: { error: "Daily practice-money limit reached." } },
      "/api/balance?": { status: 200, body: { balanceUusdc: "5000000" } },
      "/api/balance/withdraw": { status: 200, body: { txHash: "0xfeed" } },
    });

    expect(await runTestUsdcFunding(ADDRESS)).toEqual({ kind: "funded", movedUusdc: 5_000_000n });
  });
});

// KILL_BASE_MONEY_IN (2026-09-30): /api/blink/topup answers 503 before any
// grant. That pauses NEW test USDC only. Practice money already waiting in the
// app is money already in, so the header chip must still deliver it, and the
// player is told plainly that new test USDC is paused.
describe("runTestUsdcFunding while new money is paused", () => {
  const PAUSED_503 = {
    status: 503,
    body: { error: "Test USDC top-ups are paused for now, along with new stakes. Nothing was credited." },
  };

  it("skips the top-up and still delivers balance already waiting, saying new test USDC is paused", async () => {
    const calls = stubFetch({
      "/api/blink/topup": PAUSED_503,
      "/api/switches": { status: 200, body: { worldId: false, baseMoneyIn: true, reason: null } },
      "/api/balance?": { status: 200, body: { balanceUusdc: "7000000" } },
      "/api/balance/withdraw": { status: 200, body: { txHash: "0xfeed" } },
    });

    expect(await runTestUsdcFunding(ADDRESS)).toEqual({
      kind: "funded",
      movedUusdc: 7_000_000n,
      note: testUsdcPausedDetail(null, true),
    });
    expect(calls).toContain("/api/balance/withdraw");
  });

  it("says new test USDC is paused when nothing was waiting, and moves nothing", async () => {
    const calls = stubFetch({
      "/api/blink/topup": PAUSED_503,
      "/api/switches": { status: 200, body: { worldId: false, baseMoneyIn: true, reason: "Back Friday." } },
      "/api/balance?": { status: 200, body: { balanceUusdc: "0" } },
    });

    expect(await runTestUsdcFunding(ADDRESS)).toEqual({
      kind: "budget-exhausted",
      message: testUsdcPausedDetail("Back Friday.", false),
    });
    expect(calls).not.toContain("/api/balance/withdraw");
  });

  it("carries the operator's reason on a delivery too", async () => {
    stubFetch({
      "/api/blink/topup": PAUSED_503,
      "/api/switches": { status: 200, body: { worldId: false, baseMoneyIn: true, reason: "Back Friday." } },
      "/api/balance?": { status: 200, body: { balanceUusdc: "1000000" } },
      "/api/balance/withdraw": { status: 200, body: { txHash: "0xfeed" } },
    });

    const result = await runTestUsdcFunding(ADDRESS);
    expect(result).toMatchObject({ kind: "funded", note: testUsdcPausedDetail("Back Friday.", true) });
  });

  it("still delivers waiting balance when the switches read fails, and keeps the server's words", async () => {
    stubFetch({
      "/api/blink/topup": PAUSED_503,
      "/api/switches": { status: 500, body: {} },
      "/api/balance?": { status: 200, body: { balanceUusdc: "2000000" } },
      "/api/balance/withdraw": { status: 200, body: { txHash: "0xfeed" } },
    });

    expect(await runTestUsdcFunding(ADDRESS)).toEqual({ kind: "funded", movedUusdc: 2_000_000n });
  });

  it("reports the server's own words when the switches read fails and nothing was waiting", async () => {
    stubFetch({
      "/api/blink/topup": PAUSED_503,
      "/api/switches": { status: 500, body: {} },
      "/api/balance?": { status: 200, body: { balanceUusdc: "0" } },
    });

    expect(await runTestUsdcFunding(ADDRESS)).toEqual({ kind: "error", message: PAUSED_503.body.error });
  });

  it("still delivers waiting balance past any other faucet 503, and keeps that refusal an error when nothing moved", async () => {
    const treasuryLow = {
      status: 503,
      body: { error: "The testnet treasury is too low to back a faucet grant right now. Nothing was credited." },
    };
    const notPaused = { status: 200, body: { worldId: false, baseMoneyIn: false, reason: null } };
    stubFetch({
      "/api/blink/topup": treasuryLow,
      "/api/switches": notPaused,
      "/api/balance?": { status: 200, body: { balanceUusdc: "3000000" } },
      "/api/balance/withdraw": { status: 200, body: { txHash: "0xfeed" } },
    });
    expect(await runTestUsdcFunding(ADDRESS)).toEqual({ kind: "funded", movedUusdc: 3_000_000n });

    vi.unstubAllGlobals();
    stubFetch({
      "/api/blink/topup": treasuryLow,
      "/api/switches": notPaused,
      "/api/balance?": { status: 200, body: { balanceUusdc: "0" } },
    });
    expect(await runTestUsdcFunding(ADDRESS)).toEqual({ kind: "error", message: treasuryLow.body.error });
  });

  it("never reads the switches on a faucet that answered", async () => {
    const calls = stubFetch({
      "/api/blink/topup": { status: 200, body: { balanceUusdc: "0", grantedUusdc: "0", applied: true } },
      "/api/balance?": { status: 200, body: { balanceUusdc: "0" } },
    });
    await runTestUsdcFunding(ADDRESS);
    expect(calls).not.toContain("/api/switches");
  });
});
