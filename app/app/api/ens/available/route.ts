// GET /api/ens/available?label=<label> - can this wallet-agnostic label be
// minted as <label>.gohealthme.eth right now?
//
// Public and read-only. The pure rule (length, charset, reserved words,
// ENSIP-15 normalization) answers first so the form can refuse before any
// signature; anything that passes is answered by the registry on Sepolia
// (findOwner), so a name minted outside this app still reads as taken.
//
// Response JSON: { available: boolean, reason?: string, name?: string }

import { labelAvailability } from "@/lib/server/ens/resolve";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cid = newCorrelationId("ens-available");
  try {
    const label = new URL(request.url).searchParams.get("label") ?? "";
    if (label.length > 64) {
      return Response.json({ available: false, reason: "That name is too long." });
    }
    const outcome = await labelAvailability(label);
    return Response.json(outcome);
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
