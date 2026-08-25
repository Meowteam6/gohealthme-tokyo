// POST /api/junction/mobile-token
// Body: { address }
// Returns: { userId, signInToken }
//
// Mints a short-lived Vital (Junction) SDK sign-in token so the GoHealthMe
// native mobile app can authenticate its Apple Health / Health Connect sync
// WITHOUT ever shipping JUNCTION_API_KEY to the device. The token is scoped to
// the SAME Junction user the wallet maps to on the web (client_user_id =
// address.toLowerCase()), so the phone's HealthKit data lands under the user
// the verdict path already reads — one wallet, one health identity.
//
// AUTH: same wallet-signature contract as /api/junction/progress and
// /api/junction/data. A wallet address is public — it is on chain and in this
// app's own participant lists — and a sign-in token is a bearer credential that
// would let its holder impersonate this user to the Vital SDK. So possession of
// the address alone must not mint one. See lib/server/wallet-auth.ts for the
// header contract.

import { isAddress } from "viem";
import { createSignInToken } from "@/lib/server/junction";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import {
  errorMessage,
  jsonError,
  newCorrelationId,
  readJsonBody,
} from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch (err) {
      return jsonError(400, errorMessage(err));
    }

    const { address } = body;
    if (typeof address !== "string" || !isAddress(address)) {
      return jsonError(400, "address must be a valid 0x address");
    }

    const auth = await requireAddressSignature(request, address);
    if (!auth.ok) {
      return jsonError(401, `Wallet signature required: ${auth.reason}`);
    }

    const { userId, signInToken } = await createSignInToken(address);
    return Response.json({ userId, signInToken });
  } catch (err) {
    // Vital's failure text names the user id and request path, and a
    // missing/invalid JUNCTION_API_KEY throws here too — none of that belongs
    // on the wire. Log the real cause in full; answer with a generic line and a
    // correlation id. Never a fake token: the app surfaces this as "could not
    // start Apple Health", not a silent no-op.
    const correlationId = newCorrelationId("junction-mobile-token");
    console.error(`[${correlationId}] ${errorMessage(err)}`, err);
    return jsonError(
      502,
      `Apple Health sign-in is temporarily unavailable. Reference ${correlationId}.`,
    );
  }
}
