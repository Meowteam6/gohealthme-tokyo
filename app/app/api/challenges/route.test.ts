// POST /api/challenges mints a challenge link only for a wearable run on a
// launch goal: every launch metric passes for both variants (stake on yourself
// and challenge a friend), and anything else is refused with the launch-goal
// sentence before a link exists.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolInfo } from "@/lib/contract";

const CREATOR = "0x1111111111111111111111111111111111111111" as const;

let pool: PoolInfo;
const createChallenge = vi.fn();

vi.mock("@/lib/contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contract")>();
  return { ...actual, fetchPool: async () => pool };
});
vi.mock("@/lib/server/wallet-auth", () => ({
  requireAddressSignature: async (_req: Request, address: string) => ({
    ok: true,
    address,
  }),
}));
vi.mock("@/lib/server/access", () => ({ isAllowed: async () => true }));
vi.mock("@/lib/server/challenges", () => ({
  createChallenge: (...args: unknown[]) => createChallenge(...args),
}));

function poolWith(goalSpec: string, variant: "self" | "friend"): PoolInfo {
  return {
    id: 7n,
    creator: CREATOR,
    bountyModel: 2,
    settled: false,
    cancelled: false,
    periodStart: 1n,
    periodEnd: 2n,
    entryFee: 5_000_000n,
    // A friend challenge seeds a reward at creation; stake on yourself does not.
    balance: variant === "friend" ? 10_000_000n : 0n,
    initiative: "challenge",
    goalSpec,
  };
}

async function post(): Promise<Response> {
  const { POST } = await import("@/app/api/challenges/route");
  return POST(
    new Request("http://localhost/api/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: CREATOR, poolId: "7" }),
    }),
  );
}

beforeEach(() => {
  createChallenge.mockReset();
  createChallenge.mockResolvedValue({
    ok: true,
    challenge: { inviteToken: "t".repeat(32), poolId: "7" },
  });
});

const LAUNCH_GOALS = [
  "Sleep at least 7 hours for 1 night",
  "Sleep efficiency 85% or better for 1 night",
  "Complete at least 1 workout for 1 day",
];

describe("POST /api/challenges", () => {
  for (const variant of ["self", "friend"] as const) {
    for (const goal of LAUNCH_GOALS) {
      it(`mints a ${variant} challenge on "${goal}"`, async () => {
        pool = poolWith(goal, variant);
        const res = await post();
        expect(res.status).toBe(200);
        expect(createChallenge).toHaveBeenCalledTimes(1);
      });
    }

    it(`refuses a ${variant} challenge on a metric not every wearable measures`, async () => {
      pool = poolWith("Walk 8000 steps a day for 7 days", variant);
      const res = await post();
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/^Runs have to work with every wearable/);
      expect(createChallenge).not.toHaveBeenCalled();
    });

    it(`refuses a ${variant} challenge that needs an uploaded document`, async () => {
      pool = poolWith("[doc] Sleep at least 7 hours for 1 night", variant);
      const res = await post();
      expect(res.status).toBe(422);
      expect(createChallenge).not.toHaveBeenCalled();
    });
  }
});
