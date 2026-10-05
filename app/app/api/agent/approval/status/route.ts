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
//             "cancelled", mode, hit?, confirm?, requestId?, expiresAt?,
//     provider?, mocked?, attempt? }
//
// confirm is "world" | "verdict": whether this claim's payout waits on a
// World ID confirm (Andre, 2026-10-02, "Pay on the verdict"). "verdict" for
// an admin or an approved list player, and for everyone while the
// confirmation is off; "world" for a World-bound wallet or one that is
// neither. Read for the claim's participant (the plan row), else for the
// optional `address` query param; absent when neither names a wallet. The
// verdict screen reads it so a list player never sees a World ID card.
//
// mode is "off" | "mock" | "world" | "misconfigured". "misconfigured" means
// the human step is switched on but SPOTTER cannot run it (a bad mode value,
// mock refused on production, or live World credentials missing): the gate
// throws at record time, so no win can pay. The join reads this and shows a
// "payouts paused" lock before any stake, instead of reading the old 503 as
// "the step is off". The reason goes to the server log, never the body.

import { getAddress, isAddress, type Hex } from "viem";
import { unconfirmedHitOf } from "@/lib/agent-receipt";
import { payoutConfirmFor, readApproval } from "@/lib/server/agent/approval";
import { claimParticipantOf } from "@/lib/server/agent/claim-access";
import { readLedger } from "@/lib/server/agent/ledger";
import { approvalModeStatus } from "@/lib/server/agent/approval-mode-status";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

const GOAL_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export async function GET(request: Request) {
  const cid = newCorrelationId("approval-status");
  try {
    const params = new URL(request.url).searchParams;
    const goalId = params.get("goalId");
    if (goalId === null || !GOAL_ID_RE.test(goalId)) {
      return jsonError(400, "goalId must be a 0x-prefixed bytes32 hex string");
    }

    const mode = approvalModeStatus(cid);
    const ledger = await readLedger(goalId as Hex);
    // A hit SPOTTER read (the pass path, or the sweep after the run ended)
    // with nothing recorded yet: the dashboard asks the player to open the
    // run and confirm it, and never calls the refund "no proof". A yes/no
    // machine state, the same fact the public feed already shows.
    const hit = unconfirmedHitOf(ledger) ? { hit: true } : {};
    const confirm = await confirmOf(mode, ledger, params.get("address"));

    const record = await readApproval(goalId);
    if (record === null) return Response.json({ status: "none", mode, ...hit, ...confirm });
    return Response.json({
      status: record.status,
      mode,
      ...hit,
      ...confirm,
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

/** The claim's payout path (header, confirm), or nothing when no wallet is
 *  named. The participant on the plan row wins over the query param. */
async function confirmOf(
  mode: string,
  ledger: Awaited<ReturnType<typeof readLedger>>,
  addressParam: string | null,
): Promise<{ confirm?: "world" | "verdict" }> {
  const participant =
    claimParticipantOf(ledger) ??
    (addressParam !== null && isAddress(addressParam) ? getAddress(addressParam) : null);
  if (participant === null) return {};
  if (mode === "off") return { confirm: "verdict" };
  return { confirm: await payoutConfirmFor(participant) };
}
