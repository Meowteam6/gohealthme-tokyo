import { describe, it, expect, vi } from "vitest";
import type { Hex } from "viem";
import {
  CHALLENGE_BOUNTY_MODEL,
  CHALLENGE_INITIATIVE,
  HEALTH_UNREACHABLE_MESSAGE,
  challengeCreateCall,
  fetchChallengesHealth,
  readChallengeForm,
  runChallengeFlow,
  type ChallengeFlowSteps,
  type ChallengeForm,
} from "@/lib/challenge-flow";

// The one challenge flow (Andre, 2026-09-27): equal stakes. I stake S, my
// friend matches S, anyone can add extra to the pot. The create call is a
// commitment pool (bountyModel 2) with entryFee S and initialFunding E; the
// creator's own S goes in when they join on the challenge page, behind the
// same join gate every stake uses.

const HASH = ("0x" + "ab".repeat(32)) as Hex;
const USDC = 1_000_000n;
const NOW = 1_790_000_000n;
const SLEEP = "Sleep at least 7 hours for 1 night";

describe("readChallengeForm", () => {
  it("reads the goal, the stake, the extra and the friend", () => {
    expect(readChallengeForm({ goal: ` ${SLEEP} `, stake: "10", extra: "2.5", friend: " @Nikki " })).toEqual({
      ok: true,
      form: { goal: SLEEP, stake: 10n * USDC, extra: 2_500_000n, targetHandle: "nikki" },
    });
  });

  it("an empty extra is zero and an empty friend is nobody in particular", () => {
    expect(readChallengeForm({ goal: SLEEP, stake: "5", extra: "", friend: "" })).toEqual({
      ok: true,
      form: { goal: SLEEP, stake: 5n * USDC, extra: 0n, targetHandle: null },
    });
  });

  it("asks for a goal before anything else", () => {
    const read = readChallengeForm({ goal: " ", stake: "10", extra: "", friend: "" });
    expect(read).toEqual({ ok: false, reason: 'Pick your goal, for example "Sleep at least 7 hours for 1 night".' });
  });

  it("refuses a goal not every wearable can check, in the launch-goal words", () => {
    const read = readChallengeForm({ goal: "Walk at least 8,000 steps for 1 day", stake: "10", extra: "", friend: "" });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toMatch(/every wearable/);
  });

  it("refuses a stake that is empty, zero or not a number", () => {
    for (const stake of ["", "0", "abc", "-3"]) {
      const read = readChallengeForm({ goal: SLEEP, stake, extra: "", friend: "" });
      expect(read).toEqual({
        ok: false,
        reason: "Put up a stake above zero. It is your own money on the line, and your friend matches it.",
      });
    }
  });

  it("refuses an extra that is not a number of USDC", () => {
    for (const extra of ["abc", "-1"]) {
      const read = readChallengeForm({ goal: SLEEP, stake: "10", extra, friend: "" });
      expect(read).toEqual({ ok: false, reason: "Add the extra as a number of USDC, or leave it at 0." });
    }
  });

  it("refuses a friend name longer than the invite can hold", () => {
    const read = readChallengeForm({ goal: SLEEP, stake: "10", extra: "", friend: "x".repeat(41) });
    expect(read.ok).toBe(false);
  });
});

describe("challengeCreateCall", () => {
  it("is a commitment pool with entryFee S and initialFunding E, and deposits only E", () => {
    const { deposit, call } = challengeCreateCall({
      goal: SLEEP,
      stake: 10n * USDC,
      extra: 2n * USDC,
      durationDays: 7,
      nowSeconds: NOW,
    });
    expect(CHALLENGE_INITIATIVE).toBe("challenge");
    expect(CHALLENGE_BOUNTY_MODEL).toBe(2);
    expect(call).toEqual({
      functionName: "createPool",
      args: ["challenge", SLEEP, 10n * USDC, NOW, NOW + 7n * 86_400n, 2, 2n * USDC],
    });
    // The creator's stake is pulled by joinPool, never at create.
    expect(deposit).toBe(2n * USDC);
  });

  it("with no extra it deposits nothing at create", () => {
    const { deposit, call } = challengeCreateCall({
      goal: SLEEP,
      stake: 5n * USDC,
      extra: 0n,
      durationDays: 30,
      nowSeconds: NOW,
    });
    expect(deposit).toBe(0n);
    expect(call.args[2]).toBe(5n * USDC);
    expect(call.args[6]).toBe(0n);
  });
});

function steps(overrides: Partial<ChallengeFlowSteps> = {}) {
  return {
    checkHealth: vi.fn(async () => ({ ok: true as const })),
    deposit: vi.fn(async () => HASH),
    resolvePoolId: vi.fn(async () => 9n),
    mintInvite: vi.fn(async () => ({ ok: true as const, token: "T".repeat(32) })),
    ...overrides,
  };
}

const FORM: ChallengeForm = { goal: SLEEP, stake: 10n * USDC, extra: 2n * USDC, targetHandle: null };
const run = (s: ChallengeFlowSteps, form: ChallengeForm = FORM) =>
  runChallengeFlow(s, { form, durationDays: 7, nowSeconds: NOW });

describe("runChallengeFlow", () => {
  it("checks, creates the pool with S and E, then hands the creator to the join", async () => {
    const s = steps();
    const result = await run(s);
    expect(s.checkHealth).toHaveBeenCalledTimes(1);
    expect(s.deposit).toHaveBeenCalledWith(2n * USDC, {
      functionName: "createPool",
      args: ["challenge", SLEEP, 10n * USDC, NOW, NOW + 7n * 86_400n, 2, 2n * USDC],
    });
    expect(s.resolvePoolId).toHaveBeenCalledWith(HASH);
    // The creator joins with S on the challenge page, through the join gate.
    expect(result).toEqual({
      kind: "created",
      poolId: 9n,
      joinHref: "/pools/9",
      stake: 10n * USDC,
      extra: 2n * USDC,
      invite: { kind: "none" },
    });
    expect(s.mintInvite).not.toHaveBeenCalled();
  });

  it("names the friend once the pool exists, so it lands under Invited to you", async () => {
    const s = steps();
    const result = await run(s, { ...FORM, targetHandle: "nikki" });
    expect(s.mintInvite).toHaveBeenCalledWith(9n, "nikki");
    expect(result).toMatchObject({ kind: "created", invite: { kind: "sent", targetHandle: "nikki" } });
  });

  it("refuses before any money moves when challenge links are not ready", async () => {
    const s = steps({
      checkHealth: vi.fn(async () => ({ ok: false as const, message: "Challenges are not live on this build yet. Nothing was charged." })),
    });
    expect(await run(s)).toEqual({
      kind: "unavailable",
      message: "Challenges are not live on this build yet. Nothing was charged.",
    });
    expect(s.deposit).not.toHaveBeenCalled();
  });

  it("refuses before any money moves when the check cannot be reached", async () => {
    const s = steps({
      checkHealth: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    expect(await run(s)).toEqual({ kind: "unavailable", message: HEALTH_UNREACHABLE_MESSAGE });
    expect(s.deposit).not.toHaveBeenCalled();
  });

  it("a failed create moved nothing and names no pool", async () => {
    const s = steps({
      deposit: vi.fn(async () => {
        throw new Error("user rejected");
      }),
    });
    expect(await run(s)).toEqual({ kind: "depositFailed" });
    expect(s.resolvePoolId).not.toHaveBeenCalled();
    expect(s.mintInvite).not.toHaveBeenCalled();
  });

  it("a created pool whose id did not read yet is still created, and says where to find it", async () => {
    const s = steps({
      resolvePoolId: vi.fn(async () => {
        throw new Error("receipt not found");
      }),
    });
    expect(await run(s, { ...FORM, targetHandle: "nikki" })).toEqual({ kind: "unresolved", depositHash: HASH });
    expect(s.mintInvite).not.toHaveBeenCalled();
  });

  it("a refused or thrown invite never undoes the challenge: the join is still offered", async () => {
    const refused = await run(
      steps({ mintInvite: vi.fn(async () => ({ ok: false as const, message: "Sign to send it." })) }),
      { ...FORM, targetHandle: "nikki" },
    );
    expect(refused).toMatchObject({
      kind: "created",
      joinHref: "/pools/9",
      invite: { kind: "failed", targetHandle: "nikki", message: "Sign to send it." },
    });
    const thrown = await run(
      steps({
        mintInvite: vi.fn(async () => {
          throw new Error("network");
        }),
      }),
      { ...FORM, targetHandle: "nikki" },
    );
    expect(thrown).toMatchObject({
      kind: "created",
      invite: { kind: "failed", targetHandle: "nikki", message: "Could not save the invite." },
    });
  });
});

describe("fetchChallengesHealth", () => {
  it("maps 200 to ok", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    expect(await fetchChallengesHealth(fetchImpl as unknown as typeof fetch)).toEqual({
      ok: true,
    });
  });

  it("carries the server's player copy on a 503", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: "Challenges are off." }), {
          status: 503,
        }),
    );
    expect(await fetchChallengesHealth(fetchImpl as unknown as typeof fetch)).toEqual({
      ok: false,
      message: "Challenges are off.",
    });
  });

  it("falls back to plain copy when the body is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 502 }));
    expect(await fetchChallengesHealth(fetchImpl as unknown as typeof fetch)).toEqual({
      ok: false,
      message: HEALTH_UNREACHABLE_MESSAGE,
    });
  });
});
