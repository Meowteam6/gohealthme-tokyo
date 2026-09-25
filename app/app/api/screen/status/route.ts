// GET /api/screen/status?goalId= - the payout screening state of one claim.
//
// Reads the claim's ledger and reports the newest "screen" row (written by
// lib/server/screening/gate.ts before SPOTTER signed). It never calls
// Intercepta itself: the key stays server-side and a public GET must not be
// able to spend the quota. With no row yet, the answer is "pending" on a
// deployment that screens and "unconfigured" on one that does not, so the
// UI can say "screening not enabled on this deployment" honestly.
//
// Response JSON: { status, reason?, checkedAt? } per docs/LANES.md.
// Unauthenticated: the row carries trait names, a score and a composed
// reason, machine facts the public feed already serves.

import { readLedger, type LedgerEntry } from "@/lib/server/agent/ledger";
import { screeningConfigured } from "@/lib/server/screening/intercepta";
import { errorMessage, jsonError } from "@/lib/server/http";

type ScreenEntry = Extract<LedgerEntry, { kind: "screen" }>;

const GOAL_ID = /^0x[0-9a-fA-F]{64}$/;

export async function GET(request: Request): Promise<Response> {
  const goalId = new URL(request.url).searchParams.get("goalId") ?? "";
  if (!GOAL_ID.test(goalId)) {
    return jsonError(400, "goalId must be a 32-byte hex string");
  }

  try {
    const ledger = await readLedger(goalId.toLowerCase());
    const latest = [...ledger]
      .reverse()
      .find((e): e is ScreenEntry => e.kind === "screen");
    const headers = { "cache-control": "no-store" };
    if (latest === undefined) {
      return Response.json(
        { status: screeningConfigured() ? "pending" : "unconfigured" },
        { headers },
      );
    }
    return Response.json(
      { status: latest.status, reason: latest.reason, checkedAt: latest.at },
      { headers },
    );
  } catch (err) {
    console.error("screen status error:", errorMessage(err));
    return jsonError(500, "screening status unavailable");
  }
}
