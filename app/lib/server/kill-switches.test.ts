import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { killSwitches } from "@/lib/server/kill-switches";

// The pre-launch kill switches (Andre, 2026-09-30): env flags that turn the
// World ID gate and new money into Base off or on without a code change.
// Server env only, parsed strictly: "1" or "true" (any case) throws a switch,
// anything else leaves it alone, so a typo can never pause a live product.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("killSwitches", () => {
  it("is all off when nothing is set (today's behaviour)", () => {
    vi.stubEnv("KILL_WORLD_ID", "");
    vi.stubEnv("KILL_BASE_MONEY_IN", "");
    vi.stubEnv("KILL_REASON", "");
    expect(killSwitches()).toEqual({ worldId: false, baseMoneyIn: false, reason: null });
  });

  it("throws a switch on 1 or true, in any case, with spaces trimmed", () => {
    for (const on of ["1", "true", "TRUE", "True", " true "]) {
      vi.stubEnv("KILL_WORLD_ID", on);
      vi.stubEnv("KILL_BASE_MONEY_IN", on);
      expect(killSwitches()).toMatchObject({ worldId: true, baseMoneyIn: true });
    }
  });

  it("leaves a switch off on anything else", () => {
    for (const off of ["0", "false", "yes", "on", "2", "truee", "kill"]) {
      vi.stubEnv("KILL_WORLD_ID", off);
      vi.stubEnv("KILL_BASE_MONEY_IN", off);
      expect(killSwitches()).toMatchObject({ worldId: false, baseMoneyIn: false });
    }
  });

  it("reads the two switches independently", () => {
    vi.stubEnv("KILL_WORLD_ID", "1");
    vi.stubEnv("KILL_BASE_MONEY_IN", "");
    expect(killSwitches()).toMatchObject({ worldId: true, baseMoneyIn: false });
    vi.stubEnv("KILL_WORLD_ID", "");
    vi.stubEnv("KILL_BASE_MONEY_IN", "true");
    expect(killSwitches()).toMatchObject({ worldId: false, baseMoneyIn: true });
  });

  it("carries KILL_REASON as trimmed, single-line, capped plain text", () => {
    vi.stubEnv("KILL_REASON", "  Back after the contract upgrade on Friday.  ");
    expect(killSwitches().reason).toBe("Back after the contract upgrade on Friday.");

    // (An env value cannot carry NUL: the OS ends the string there.)
    vi.stubEnv("KILL_REASON", "Line one\n\tline\u0007two");
    expect(killSwitches().reason).toBe("Line one line two");

    vi.stubEnv("KILL_REASON", "x".repeat(500));
    expect(killSwitches().reason).toHaveLength(200);

    vi.stubEnv("KILL_REASON", "   ");
    expect(killSwitches().reason).toBeNull();
  });

  it("is never read from a NEXT_PUBLIC_ variable", () => {
    vi.stubEnv("NEXT_PUBLIC_KILL_WORLD_ID", "1");
    vi.stubEnv("NEXT_PUBLIC_KILL_BASE_MONEY_IN", "1");
    vi.stubEnv("KILL_WORLD_ID", "");
    vi.stubEnv("KILL_BASE_MONEY_IN", "");
    expect(killSwitches()).toMatchObject({ worldId: false, baseMoneyIn: false });
  });
});

// MONEY OUT NEVER PAUSES. Neither switch may reach a path that pays, refunds
// or delivers money a player already has in: those files must not read the
// switches at all, so no future edit can quietly gate them on one. The
// behaviour is pinned too (require-human, access, approval-provider and the
// sweep suites run with the switches thrown); this pins the wiring.
describe("money out never reads a kill switch", () => {
  const APP = path.resolve(__dirname, "..", "..");
  const MONEY_OUT = [
    "app/api/agent/run/[goalId]/route.ts",
    "app/api/agent/sweep/route.ts",
    "app/api/agent/approval/request/route.ts",
    "app/api/agent/approval/complete/route.ts",
    "app/api/agent/approval/status/route.ts",
    "app/api/evidence/submit/route.ts",
    "app/api/gas/drip/route.ts",
    "app/api/balance/withdraw/route.ts",
    "components/ClaimPayout.tsx",
    "components/RefundClaim.tsx",
    "components/SweepLeftover.tsx",
    "lib/server/agent/run.ts",
    "lib/server/agent/approved-record.ts",
  ];
  const SWITCH_READS = [
    "kill-switches",
    "KILL_BASE_MONEY_IN",
    "KILL_WORLD_ID",
    "useSwitches",
    "/api/switches",
    "moneyIn",
  ];

  for (const file of MONEY_OUT) {
    it(`${file} never reads a switch`, () => {
      const source = readFileSync(path.join(APP, file), "utf8");
      for (const needle of SWITCH_READS) {
        expect(source.includes(needle), `${file} mentions ${needle}`).toBe(false);
      }
    });
  }
});
