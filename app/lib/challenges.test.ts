import { describe, it, expect } from "vitest";
import {
  INVITE_TOKEN_PATTERN,
  INVITE_TOKEN_BYTES,
  TARGET_HANDLE_MAX,
  MESSAGE_MAX,
  base64UrlNoPad,
  generateInviteToken,
  isValidInviteToken,
  checkMessage,
  checkTargetHandle,
  normalizeTargetHandle,
  challengeShareUrl,
  challengeBackerUrl,
  isBackerView,
  darePot,
  challengeGoalIssue,
  challengePauseReason,
} from "@/lib/challenges";

const USDC = (n: number): bigint => BigInt(n) * 1_000_000n;

describe("darePot", () => {
  const live = { settled: false, cancelled: false };

  it("a $10 dare with a $5 lock-in accepted reads reward $10, not $15", () => {
    const pot = darePot({
      ...live,
      balance: USDC(15),
      entryFee: USDC(5),
      participantCount: 1,
      contributed: 0n,
    });
    expect(pot).toEqual({ prize: USDC(10), stakes: USDC(5), seed: USDC(10) });
  });

  it("splits friends' top-ups out of the challenger's seed", () => {
    const pot = darePot({
      ...live,
      balance: USDC(10 + 5 + 7),
      entryFee: USDC(5),
      participantCount: 1,
      contributed: USDC(7),
    });
    expect(pot.prize).toBe(USDC(17));
    expect(pot.seed).toBe(USDC(10));
  });

  it("leaves the seed unknown when top-ups were not read", () => {
    const pot = darePot({
      ...live,
      balance: USDC(12),
      entryFee: USDC(2),
      participantCount: 0,
    });
    expect(pot).toEqual({ prize: USDC(12), stakes: 0n, seed: null });
  });

  it("a self-commitment with only stakes has zero prize, never stakes as reward", () => {
    const pot = darePot({
      ...live,
      balance: USDC(20),
      entryFee: USDC(10),
      participantCount: 2,
      contributed: 0n,
    });
    expect(pot.prize).toBe(0n);
  });

  it("states nothing when the count is unknown or the pool is settled or cancelled", () => {
    const base = { balance: USDC(15), entryFee: USDC(5), participantCount: 1 };
    const none = { prize: null, stakes: null, seed: null };
    expect(darePot({ ...base, ...live, participantCount: null })).toEqual(none);
    expect(darePot({ ...base, settled: true, cancelled: false })).toEqual(none);
    expect(darePot({ ...base, settled: false, cancelled: true })).toEqual(none);
  });

  it("never goes negative", () => {
    const pot = darePot({
      ...live,
      balance: USDC(3),
      entryFee: USDC(5),
      participantCount: 1,
      contributed: USDC(9),
    });
    expect(pot.prize).toBe(0n);
    expect(pot.seed).toBe(0n);
  });
});

describe("backer links", () => {
  it("adds the backer flag to the same /c/<token> link", () => {
    expect(challengeBackerUrl("https://x.app/", "tok_abc")).toBe(
      "https://x.app/c/tok_abc?as=backer",
    );
  });

  it("only the exact backer flag switches the view", () => {
    expect(isBackerView("backer")).toBe(true);
    expect(isBackerView(["backer"])).toBe(true);
    expect(isBackerView(undefined)).toBe(false);
    expect(isBackerView("player")).toBe(false);
  });
});

describe("invite tokens", () => {
  it("encodes bytes into the URL-safe alphabet with no padding", () => {
    // 0xfb 0xff 0xbf would base64 to "+/+/"; url-safe swaps to "-_-_".
    const encoded = base64UrlNoPad(new Uint8Array([0xfb, 0xff, 0xbf]));
    expect(encoded).toBe("-_-_");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("generates tokens that satisfy the DB CHECK pattern", () => {
    // A deterministic 24-byte source proves the length lands in range and the
    // alphabet is legal; the live generator uses crypto-random bytes.
    const bytes = Uint8Array.from({ length: INVITE_TOKEN_BYTES }, (_, i) => i);
    const token = generateInviteToken(() => bytes);
    expect(INVITE_TOKEN_PATTERN.test(token)).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token.length).toBeLessThanOrEqual(64);
  });

  it("produces distinct tokens from the live crypto source", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(isValidInviteToken(a)).toBe(true);
    expect(isValidInviteToken(b)).toBe(true);
  });

  it("rejects the sequential pool id and other malformed tokens", () => {
    expect(isValidInviteToken("1")).toBe(false); // a pool id is not a token
    expect(isValidInviteToken("42")).toBe(false);
    expect(isValidInviteToken("short")).toBe(false);
    expect(isValidInviteToken("has spaces in it aaaaaaaaaaaaaaaa")).toBe(false);
    expect(isValidInviteToken("contains/slash/aaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      false,
    );
    expect(isValidInviteToken("a".repeat(65))).toBe(false); // too long
  });
});

describe("checkMessage", () => {
  it("treats absent or blank as null (the column is nullable)", () => {
    expect(checkMessage(undefined)).toEqual({ ok: true, message: null });
    expect(checkMessage(null)).toEqual({ ok: true, message: null });
    expect(checkMessage("   ")).toEqual({ ok: true, message: null });
  });

  it("trims and keeps a normal message", () => {
    expect(checkMessage("  bet you can't  ")).toEqual({
      ok: true,
      message: "bet you can't",
    });
  });

  it("rejects a message over the column length", () => {
    const result = checkMessage("x".repeat(MESSAGE_MAX + 1));
    expect(result.ok).toBe(false);
  });

  it("accepts exactly the max length", () => {
    const result = checkMessage("x".repeat(MESSAGE_MAX));
    expect(result).toEqual({ ok: true, message: "x".repeat(MESSAGE_MAX) });
  });
});

describe("checkTargetHandle", () => {
  it("treats absent or blank as null", () => {
    expect(checkTargetHandle(undefined)).toEqual({
      ok: true,
      targetHandle: null,
    });
    expect(checkTargetHandle("")).toEqual({ ok: true, targetHandle: null });
  });

  it("trims and keeps a normal label", () => {
    expect(checkTargetHandle("  my son  ")).toEqual({
      ok: true,
      targetHandle: "my son",
    });
  });

  it("rejects a label over the column length", () => {
    const result = checkTargetHandle("x".repeat(TARGET_HANDLE_MAX + 1));
    expect(result.ok).toBe(false);
  });
});

describe("normalizeTargetHandle", () => {
  it("strips a leading @, lowercases, and trims", () => {
    expect(normalizeTargetHandle("@Nikki")).toBe("nikki");
    expect(normalizeTargetHandle("  @NIKKI_HU  ")).toBe("nikki_hu");
    expect(normalizeTargetHandle("nikki")).toBe("nikki");
  });

  it("matches what a claimed handle canonicalizes to, so the two line up", () => {
    // A profile stores handles lowercased [a-z0-9_]; the challenger may type the
    // @ and any case. Both sides must land on the identical string.
    expect(normalizeTargetHandle("@Coach_Maya")).toBe("coach_maya");
  });

  it("collapses a blank or lone @ to the empty string (no target)", () => {
    expect(normalizeTargetHandle("")).toBe("");
    expect(normalizeTargetHandle("   ")).toBe("");
    expect(normalizeTargetHandle("@")).toBe("");
  });
});

describe("challengeShareUrl", () => {
  it("builds the /c/<token> path and does not double the slash", () => {
    expect(challengeShareUrl("https://gohealthme.app", "tok_abc")).toBe(
      "https://gohealthme.app/c/tok_abc",
    );
    expect(challengeShareUrl("https://gohealthme.app/", "tok_abc")).toBe(
      "https://gohealthme.app/c/tok_abc",
    );
  });
});

describe("challengeGoalIssue", () => {
  it("accepts every launch goal as a plain wearable goal", () => {
    expect(challengeGoalIssue("Sleep at least 7 hours for 1 night")).toBeNull();
    expect(challengeGoalIssue("Sleep efficiency 85% or better for 1 night")).toBeNull();
    expect(challengeGoalIssue("Complete at least 1 workout for 1 day")).toBeNull();
  });

  it("refuses steps and any document or photo goal with the launch sentence", () => {
    for (const goal of [
      "Walk 8000 steps a day for 7 days",
      "[doc] Sleep at least 7 hours for 1 night",
      "[proof=doc+self] Complete at least 1 workout for 1 day",
    ]) {
      expect(challengeGoalIssue(goal)).toMatch(/^Challenges have to work with every wearable/);
    }
  });
});

describe("challengePauseReason", () => {
  it("never pauses a wearable challenge because the document checker is off", () => {
    expect(
      challengePauseReason({
        goalSpec: "Sleep at least 7 hours for 1 night",
        documentCheckerAvailable: false,
        payoutsMisconfigured: false,
      }),
    ).toBeNull();
  });

  it("pauses an older document challenge while the checker is off", () => {
    expect(
      challengePauseReason({
        goalSpec: "[doc] Upload a flu shot record",
        documentCheckerAvailable: false,
        payoutsMisconfigured: false,
      }),
    ).toBe("checker");
  });

  it("pauses any challenge whose win could not pay", () => {
    expect(
      challengePauseReason({
        goalSpec: "Complete at least 1 workout for 1 day",
        documentCheckerAvailable: false,
        payoutsMisconfigured: true,
      }),
    ).toBe("payouts");
  });

  // KILL_BASE_MONEY_IN (Andre, 2026-09-30): no chip-in and no rally while new
  // money is paused, with its own reason so the card says why.
  it("pauses chipping in while new money is paused", () => {
    expect(
      challengePauseReason({
        goalSpec: "Sleep at least 7 hours for 1 night",
        documentCheckerAvailable: true,
        payoutsMisconfigured: false,
        moneyInPaused: true,
      }),
    ).toBe("money-in");
  });

  it("keeps the older reasons first when they also hold", () => {
    expect(
      challengePauseReason({
        goalSpec: "Complete at least 1 workout for 1 day",
        documentCheckerAvailable: true,
        payoutsMisconfigured: true,
        moneyInPaused: true,
      }),
    ).toBe("payouts");
  });

  it("is unchanged with new money open (regression)", () => {
    expect(
      challengePauseReason({
        goalSpec: "Sleep at least 7 hours for 1 night",
        documentCheckerAvailable: true,
        payoutsMisconfigured: false,
        moneyInPaused: false,
      }),
    ).toBeNull();
  });
});
