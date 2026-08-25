// /api/admin/access — the admin's view of the closed-beta queue.
//
//   GET   list every access request, newest first.
//   POST  { address, decision: "approve" | "deny" }  decide one request.
//
// Both are gated twice: the caller must prove control of a wallet (EIP-191
// signature) AND that wallet must be in ADMIN_ADDRESSES. A non-admin gets 403,
// an unsigned caller 401. This is REAL server enforcement — the list of who has
// requested access, and the power to approve, never leave the server for a
// non-admin. isAdmin reads ADMIN_ADDRESSES at request time.

import { isAddress } from "viem";
import {
  decideAccess,
  isAdmin,
  listAccessRequests,
} from "@/lib/server/access";
import { authenticateWallet } from "@/lib/server/wallet-auth";
import {
  jsonError,
  newCorrelationId,
  readJsonBody,
  safeError,
} from "@/lib/server/http";

export const runtime = "nodejs";

type AdminGate =
  | { ok: true; address: string }
  | { ok: false; response: Response };

async function requireAdmin(request: Request): Promise<AdminGate> {
  const auth = await authenticateWallet(request);
  if (!auth.ok) {
    return { ok: false, response: jsonError(401, "Sign in with your admin wallet.") };
  }
  if (!isAdmin(auth.address)) {
    return { ok: false, response: jsonError(403, "That wallet is not an admin.") };
  }
  return { ok: true, address: auth.address };
}

export async function GET(request: Request) {
  const cid = newCorrelationId("admin-access-list");
  try {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const requests = await listAccessRequests();
    return Response.json({ requests });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}

export async function POST(request: Request) {
  const cid = newCorrelationId("admin-access-decide");
  try {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError(400, "Request body must be a JSON object.");
    }

    const { address, decision } = body;
    if (typeof address !== "string" || !isAddress(address)) {
      return jsonError(400, "address must be a 0x address string");
    }
    if (decision !== "approve" && decision !== "deny") {
      return jsonError(400, 'decision must be "approve" or "deny"');
    }

    const result = await decideAccess({
      address,
      decision,
      adminAddress: gate.address,
    });
    if (!result.ok) {
      return jsonError(result.status, result.reason);
    }
    return Response.json({ record: result.record });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
