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
//             "cancelled", mode, requestId?, expiresAt?, provider?, mocked?,
//     attempt? }
//
// mode is "off" | "mock" | "world" | "misconfigured". "misconfigured" means
// the human step is switched on but SPOTTER cannot run it (a bad mode value,
// mock refused on production, or live World credentials missing): the gate
// throws at record time, so no win can pay. The join reads this and shows a
// "payouts paused" lock before any stake, instead of reading the old 503 as
// "the step is off". The reason goes to the server log, never the body.

import { readApproval } from "@/lib/server/agent/approval";
import {
  approvalMode,
  approvalProviderFor,
  type ApprovalMode,
} from "@/lib/server/agent/approval-provider";
import {
  errorMessage,
  jsonError,
  newCorrelationId,
  safeError,
} from "@/lib/server/http";

const GOAL_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export async function GET(request: Request) {
  const cid = newCorrelationId("approval-status");
  try {
    const goalId = new URL(request.url).searchParams.get("goalId");
    if (goalId === null || !GOAL_ID_RE.test(goalId)) {
      return jsonError(400, "goalId must be a 0x-prefixed bytes32 hex string");
    }

    let mode: ApprovalMode | "misconfigured";
    try {
      const resolved = approvalMode();
      // Build the provider too: WORLD_APPROVAL_MODE=world with its credentials
      // missing parses fine but throws the moment SPOTTER needs it.
      if (resolved !== "off") approvalProviderFor(resolved);
      mode = resolved;
    } catch (err) {
      console.error(`[${cid}] human confirmation misconfigured: ${errorMessage(err)}`);
      mode = "misconfigured";
    }

    const record = await readApproval(goalId);
    if (record === null) return Response.json({ status: "none", mode });
    return Response.json({
      status: record.status,
      mode,
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
