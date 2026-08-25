// GET /api/access/status?address=0x... — this address's closed-beta status.
//
// Unauthenticated on purpose: it reveals only whether an address is approved /
// pending / denied / unknown, plus whether it is an admin wallet. A wallet
// address is already public (on chain, in pool lists), so naming one and
// learning its access status discloses nothing sensitive — and the client gate
// must be able to read this on page load WITHOUT throwing up a wallet-signature
// prompt on every navigation. The decisions this drives (request form vs the
// app) are cosmetic; the money-moving routes enforce separately.
//
// Response JSON: { status: "none" | "pending" | "approved" | "denied", isAdmin }

import { isAddress } from "viem";
import { getAccessStatus } from "@/lib/server/access";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const cid = newCorrelationId("access-status");
  try {
    const address = new URL(request.url).searchParams.get("address");
    if (typeof address !== "string" || !isAddress(address)) {
      return jsonError(400, "address query param must be a 0x address");
    }
    const view = await getAccessStatus(address);
    return Response.json(view);
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
