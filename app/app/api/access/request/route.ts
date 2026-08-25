// POST /api/access/request — ask to join the closed family-and-friends beta.
//
// The request is gated by an EIP-191 signature that proves the caller controls
// the address they are requesting for (requireAddressSignature, the same proof
// the handle and Junction routes use). Without it, anyone could file requests
// for addresses they do not own and flood the admin queue. The typed
// name/email/reason are recorded only for the admin's human decision — never
// trusted as identity. Idempotent: a re-submit while pending or after approval
// returns the existing record unchanged.
//
// GEO COMPLIANCE. The declared US `state` is passed to requestAccess, which is
// the authoritative geo gate: a state excluded from the self-staked pilot is
// refused there with a 403 that this route surfaces via the !result.ok handler.
// The client form pre-checks the same rule for a fast message, but this server
// path is the real refusal — a hand-built POST from a blocked state does not get
// in.
//
// Request JSON:  { address, name?, email?, reason?, state? }
// Response JSON: { record } on success.

import { requestAccess } from "@/lib/server/access";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import {
  jsonError,
  newCorrelationId,
  readJsonBody,
  safeError,
} from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const cid = newCorrelationId("access-request");
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError(400, "Request body must be a JSON object.");
    }

    const { address, name, email, reason, state } = body;
    if (typeof address !== "string" || address === "") {
      return jsonError(400, "address must be a 0x address string");
    }
    if (name !== undefined && name !== null && typeof name !== "string") {
      return jsonError(400, "name must be a string when provided");
    }
    if (email !== undefined && email !== null && typeof email !== "string") {
      return jsonError(400, "email must be a string when provided");
    }
    if (reason !== undefined && reason !== null && typeof reason !== "string") {
      return jsonError(400, "reason must be a string when provided");
    }
    if (state !== undefined && state !== null && typeof state !== "string") {
      return jsonError(400, "state must be a string when provided");
    }

    // The proof must be for THIS address, not merely some address.
    const auth = await requireAddressSignature(request, address);
    if (!auth.ok) {
      return jsonError(401, "Sign with the wallet you are requesting access for.");
    }

    const result = await requestAccess({
      address: auth.address,
      name: name ?? "",
      email: email ?? "",
      reason: reason ?? "",
      state: state ?? "",
    });
    if (!result.ok) {
      return jsonError(result.status, result.reason);
    }
    return Response.json({ record: result.record });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
