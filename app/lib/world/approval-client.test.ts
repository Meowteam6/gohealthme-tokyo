import { describe, it, expect } from "vitest";
import {
  CLIENT_MOCK_PROOF_KIND,
  formatCountdown,
  mockApprovalProof,
  mountActionFor,
  outcomeCopy,
  parseOpenRequest,
  parseStatus,
  secondsLeft,
} from "@/lib/world/approval-client";
import { MOCK_PROOF_KIND } from "@/lib/server/agent/approval-provider";

describe("mountActionFor", () => {
  it("adopts a finished answer on mount and never re-asks for it", () => {
    // A reload after "Not now, do not pay" must not open a fresh request.
    expect(mountActionFor("declined")).toBe("adopt");
    expect(mountActionFor("expired")).toBe("adopt");
    expect(mountActionFor("cancelled")).toBe("adopt");
    expect(mountActionFor("approved")).toBe("adopt");
  });

  it("only picks up a pending request, or SPOTTER's ask that has not landed", () => {
    expect(mountActionFor("pending")).toBe("open");
    expect(mountActionFor("none")).toBe("open");
  });
});

describe("approval-client", () => {
  it("mirrors the server's mock proof kind exactly (wire format)", () => {
    expect(CLIENT_MOCK_PROOF_KIND).toBe(MOCK_PROOF_KIND);
    expect(mockApprovalProof("settle:0xabc:1")).toEqual({
      kind: MOCK_PROOF_KIND,
      action: "settle:0xabc:1",
      approve: true,
    });
  });

  it("counts down in whole seconds and never below zero", () => {
    const now = Date.parse("2026-09-26T03:00:00.000Z");
    expect(secondsLeft("2026-09-26T03:01:30.000Z", now)).toBe(90);
    expect(secondsLeft("2026-09-26T03:00:00.400Z", now)).toBe(1);
    expect(secondsLeft("2026-09-26T02:59:00.000Z", now)).toBe(0);
    expect(secondsLeft("nope", now)).toBe(0);
    expect(formatCountdown(90)).toBe("1:30");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(-3)).toBe("0:00");
  });

  it("refuses a half-shaped request, and a world request without its context", () => {
    const base = {
      requestId: "apr_x",
      expiresAt: "2026-09-26T03:01:30.000Z",
      status: "pending",
      attempt: 1,
      action: "settle:0xabc:1",
      provider: "mock",
      mocked: true,
    };
    expect(parseOpenRequest(base)).toMatchObject({ requestId: "apr_x", provider: "mock" });
    expect(parseOpenRequest({ ...base, attempt: "1" })).toBeNull();
    expect(parseOpenRequest({ ...base, provider: "world", mocked: false })).toBeNull();
    expect(
      parseOpenRequest({
        ...base,
        provider: "world",
        mocked: false,
        world: { appId: "app_1", rpContext: {}, environment: "staging", allowLegacyProofs: false },
      }),
    ).toMatchObject({ provider: "world" });
    expect(parseOpenRequest(null)).toBeNull();
  });

  it("parses status responses and rejects unknown states", () => {
    expect(parseStatus({ status: "none", mode: "mock" })).toEqual({ status: "none" });
    expect(parseStatus({ status: "pending", requestId: "apr_x", expiresAt: "t" })).toEqual({
      status: "pending",
      requestId: "apr_x",
      expiresAt: "t",
    });
    expect(parseStatus({ status: "paid" })).toBeNull();
  });

  it("every terminal outcome has honest copy; only declined and expired offer ask-again", () => {
    expect(outcomeCopy("approved").askAgain).toBe(false);
    expect(outcomeCopy("declined").askAgain).toBe(true);
    expect(outcomeCopy("expired").askAgain).toBe(true);
    expect(outcomeCopy("cancelled").askAgain).toBe(false);
    for (const outcome of ["declined", "expired", "cancelled"] as const) {
      expect(outcomeCopy(outcome).headline).toMatch(/nothing moved/);
    }
  });
});
