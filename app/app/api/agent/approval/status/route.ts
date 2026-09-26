// GET /api/agent/approval/status?goalId= - where the human step stands.
// World ID for Agents, ETHGlobal Tokyo 2026.
//
// Unauthenticated on purpose: it carries machine states only (no prose, no
// identity, no health data), the same bar the public /agent feed meets, and
// the card polls it every couple of seconds while a request is open. Reading
// it also materializes expiry, so a window that closes with nobody watching
// still turns into an "expired" row the moment anyone looks.
//
// Response JSON:
//   { status: "none" | "pending" | "approved" | "declined" | "expired" |
//             "cancelled", mode, hit?, requestId?, expiresAt?, provider?, mocked?,
//     attempt? }
//
// mode is "off" | "mock" | "world" | "misconfigured". "misconfigured" means
// the human step is switched on but SPOTTER cannot run it (a bad mode value,
// mock refused on production, or live World credentials missing): the gate
// throws at record time, so no win can pay. The join reads this and shows a
// "payouts paused" lock before any stake, instead of reading the old 503 as
// "the step is off". The reason goes to the server log, never the body.

import type { Hex } from "viem";
import { unconfirmedHitOf } from "@/lib/agent-receipt";
import { readApproval } from "@/lib/server/agent/approval";
import { readLedger } from "@/lib/server/agent/ledger";
import { approvalModeStatus } from "@/lib/server/agent/approval-mode-status";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

const GOAL_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export async function GET(request: Request) {
  const cid = newCorrelationId("approval-status");
  try {
    const goalId = new URL(request.url).searchParams.get("goalId");
    if (goalId === null || !GOAL_ID_RE.test(goalId)) {
      return jsonError(400, "goalId must be a 0x-prefixed bytes32 hex string");
    }

    const mode = approvalModeStatus(cid);
    // A hit SPOTTER read (the pass path, or the sweep after the run ended)
    // with nothing recorded yet: the dashboard asks the player to open the
    // run and confirm it, and never calls the refund "no proof". A yes/no
    // machine state, the same fact the public feed already shows.
    const hit = unconfirmedHitOf(await readLedger(goalId as Hex)) ? { hit: true } : {};

    const record = await readApproval(goalId);
    if (record === null) return Response.json({ status: "none", mode, ...hit });
    return Response.json({
      status: record.status,
      mode,
      ...hit,
      requestId: record.requestId,
      expiresAt: record.expiresAt,
      provider: record.provider,
      mocked: record.provider === "mock",
      attempt: record.attempt,
    });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
