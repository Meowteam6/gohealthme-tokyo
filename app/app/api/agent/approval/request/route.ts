// POST /api/agent/approval/request - the achiever asks SPOTTER (or SPOTTER's
// ask is picked up by the browser) for the fresh human confirmation that
// gates the payout. World ID for Agents, ETHGlobal Tokyo 2026.
//
// Request JSON: { goalId }, plus the wallet-signature headers from
// lib/server/wallet-auth.ts. The signer must be the claim's participant, the
// same proof the handle route and the run route's owner view use: a goalId is
// public (the feed publishes them), so it is not a credential.
//
// Idempotent. SPOTTER's run loop opens the request the moment it decides to
// pay (approval.ts); the card's call then hands that same request back with
// what the browser needs to complete it. After a decline or an expiry the
// same call opens a fresh attempt ("ask again"). One active request per goal.
//
// Response JSON:
//   { requestId, expiresAt, status, attempt, action, provider, mocked, world? }
// `world` (app id, server-signed rp_context, environment) is present only in
// world mode. The signing key never leaves the server.

import { isClaimOwner, claimParticipantOf } from "@/lib/server/agent/claim-access";
import { readLedger } from "@/lib/server/agent/ledger";
import { requestApproval } from "@/lib/server/agent/approval";
import {
  approvalMode,
  approvalProviderFor,
} from "@/lib/server/agent/approval-provider";
import { authenticateWallet } from "@/lib/server/wallet-auth";
import {
  errorMessage,
  jsonError,
  newCorrelationId,
  readJsonBody,
  safeError,
} from "@/lib/server/http";

const GOAL_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export const NOT_ENABLED_MESSAGE =
  "Human confirmation is not enabled on this deployment (WORLD_APPROVAL_MODE is unset).";

export async function POST(request: Request) {
  const cid = newCorrelationId("approval-request");
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError(400, "Request body must be a JSON object.");
    }
    const { goalId } = body;
    if (typeof goalId !== "string" || !GOAL_ID_RE.test(goalId)) {
      return jsonError(400, "goalId must be a 0x-prefixed bytes32 hex string");
    }

    const auth = await authenticateWallet(request);
    if (!auth.ok) {
      return jsonError(401, "Sign with the wallet that made this claim.");
    }

    let mode: ReturnType<typeof approvalMode>;
    try {
      mode = approvalMode();
    } catch (err) {
      console.error(`[${cid}] ${errorMessage(err)}`);
      return jsonError(503, "Human confirmation is misconfigured on this deployment.");
    }
    if (mode === "off") return jsonError(409, NOT_ENABLED_MESSAGE);

    const ledger = await readLedger(goalId);
    if (ledger.length === 0) {
      return jsonError(404, "There is no claim to confirm yet.");
    }
    if (!isClaimOwner(ledger, auth.address)) {
      return jsonError(403, "That claim belongs to a different wallet.");
    }
    const plan = ledger.find((e) => e.kind === "plan");
    const poolId = plan?.kind === "plan" ? plan.poolId : undefined;
    if (poolId === undefined || !/^\d+$/.test(poolId)) {
      return jsonError(409, "This claim has no pool linkage to confirm against.");
    }
    // Only a pay decision needs a human; nothing to confirm otherwise. The
    // newest reason row is SPOTTER's current decision.
    const reason = [...ledger].reverse().find((e) => e.kind === "reason");
    if (reason?.kind !== "reason" || reason.decision !== "pay") {
      return jsonError(
        409,
        "SPOTTER has not decided to pay this claim, so there is nothing to confirm.",
      );
    }
    if (ledger.some((e) => e.kind === "record")) {
      return jsonError(409, "This claim is already recorded on-chain.");
    }

    let provider;
    try {
      provider = approvalProviderFor(mode);
    } catch (err) {
      console.error(`[${cid}] ${errorMessage(err)}`);
      return jsonError(
        503,
        "World ID for Agents is not configured on this deployment; a WORLD_* variable is missing.",
      );
    }

    const participant = claimParticipantOf(ledger) ?? auth.address;
    const { record, challenge } = await requestApproval({
      goalId,
      poolId,
      address: participant,
      provider,
      askedBy: "human",
    });
    return Response.json({
      requestId: record.requestId,
      expiresAt: record.expiresAt,
      status: record.status,
      attempt: record.attempt,
      action: record.action,
      provider: challenge.provider,
      mocked: challenge.mocked,
      ...(challenge.world === undefined ? {} : { world: challenge.world }),
    });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
