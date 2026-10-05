// POST /api/wearable/apple/pair/redeem
// Body: { code }
// Returns: { deviceToken, address }
//
// The GoHealthMe iPhone app calls this once, with the code the player's
// signed-in web session showed them. Unauthenticated by design: the code IS
// the proof, it was minted only after a wallet signature on the web, it lives
// ten minutes and works once. Every failure is one plain 400 so a guesser
// learns nothing, and /api/wearable/* sits behind the per-IP rate limit.
//
// Redeeming switches no provider. See lib/server/wearable/apple-pairing.ts.

import { errorMessage, jsonError, readJsonBody } from "@/lib/server/http";
import { appleConfigured } from "@/lib/server/wearable/apple";
import { redeemPairingCode } from "@/lib/server/wearable/apple-pairing";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return jsonError(400, errorMessage(err));
  }

  if (!appleConfigured()) {
    return jsonError(503, "Apple Health pairing is not available right now.");
  }

  const { code } = body;
  if (typeof code !== "string") {
    return jsonError(400, "code is required");
  }

  try {
    const result = await redeemPairingCode(code);
    if (!result.ok) {
      return jsonError(
        400,
        "That code did not work. Codes last ten minutes and work once. Get a new one on the GoHealthMe website.",
      );
    }
    return Response.json(
      { deviceToken: result.deviceToken, address: result.address },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[wearable/apple/pair/redeem] failed", err);
    return jsonError(502, "Could not pair right now. Try again in a moment.");
  }
}
