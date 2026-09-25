// GET /api/world/status?address=0x... - has this wallet proven it is one human?
//
// Unauthenticated on purpose, like /api/access/status: a wallet address is
// public, and "verified or not" discloses nothing about the person (the
// nullifier itself is never returned). The character card reads this on
// every render without a wallet prompt.
//
// Response JSON: { human: "verified" | "unverified", verifiedAt?, mode }
//   mode is "live" | "mock" | "off" for this deployment, so the UI can label a
//   mocked verification as such and never present it as a real one.

import { isAddress } from "viem";
import { worldSetup } from "@/lib/server/world/config";
import { humanStatus } from "@/lib/server/world/human";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const cid = newCorrelationId("world-status");
  try {
    const address = new URL(request.url).searchParams.get("address");
    if (typeof address !== "string" || !isAddress(address)) {
      return jsonError(400, "address query param must be a 0x address");
    }
    const view = await humanStatus(address);
    return Response.json({ ...view, mode: worldSetup().mode });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
