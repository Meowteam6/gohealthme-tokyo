// POST /api/agent/approval/complete - the human's answer to SPOTTER's ask.
// World ID for Agents, ETHGlobal Tokyo 2026.
//
// Request JSON: { requestId, proof } to approve, or { requestId, decline: true }
// to say no. Wallet-signature headers required: the signer must be the wallet
// the request was opened for. In mock mode the proof carries no identity, so
// without the signature anyone holding a requestId could approve somebody
// else's payout; in world mode the signature additionally binds World's
// proof to the wallet SPOTTER is about to pay.
//
// The proof is validated SERVER-SIDE by the configured provider
// (lib/server/agent/approval-provider.ts): action binding, World's verify
// endpoint with the environment pinned from env, nullifier consumed once.
// Nothing about the proof is trusted from the client.
//
// Response JSON: { status: "approved" | "declined" | "expired" | "cancelled" }.
// A proof that does not verify is 401 with a plain reason and the request
// stays pending, so the human can try again inside the window.

import { completeApproval } from "@/lib/server/agent/approval";
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
import { NOT_ENABLED_MESSAGE } from "@/app/api/agent/approval/request/route";

export async function POST(request: Request) {
  const cid = newCorrelationId("approval-complete");
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError(400, "Request body must be a JSON object.");
    }
    const { requestId, proof, decline } = body;
    if (typeof requestId !== "string" || requestId === "") {
      return jsonError(400, "requestId must be a non-empty string");
    }
    if (decline !== undefined && decline !== true) {
      return jsonError(400, "decline must be true when present");
    }
    if (decline !== true && (proof === undefined || proof === null)) {
      return jsonError(400, "send a proof to approve, or decline: true");
    }

    const auth = await authenticateWallet(request);
    if (!auth.ok) {
      return jsonError(401, "Sign with the wallet this confirmation is for.");
    }

    let mode: ReturnType<typeof approvalMode>;
    try {
      mode = approvalMode();
    } catch (err) {
      console.error(`[${cid}] ${errorMessage(err)}`);
      return jsonError(503, "Human confirmation is misconfigured on this deployment.");
    }
    if (mode === "off") return jsonError(409, NOT_ENABLED_MESSAGE);

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

    const outcome = await completeApproval({
      requestId,
      address: auth.address,
      decision: decline === true ? { decision: "decline" } : { decision: "approve", proof },
      provider,
    });

    switch (outcome.status) {
      case "unknown":
        return jsonError(404, "That confirmation request does not exist.");
      case "superseded":
        return Response.json(
          {
            error: "That request was replaced by a newer one. Use the current one.",
            status: outcome.record.status,
            requestId: outcome.record.requestId,
          },
          { status: 409 },
        );
      case "forbidden":
        return jsonError(403, "That confirmation belongs to a different wallet.");
      case "rejected":
        return Response.json(
          { error: `Not confirmed: ${outcome.reason}.`, status: "pending" },
          { status: 401 },
        );
      default:
        return Response.json({ status: outcome.status });
    }
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
