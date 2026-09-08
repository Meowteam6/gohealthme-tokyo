// POST /api/wearable/disconnect
// Body: { address }
// Drops this wallet's connection at whichever provider currently backs it.
//
// Only the WHOOP path can honour this. Junction owns its own link and
// isConnected asks Junction directly, so deleting anything on our side would
// leave the app reporting "disconnected" while the next read reported
// "connected" again. That is returned as a clear 409 naming where the user
// actually has to go, rather than a success that does nothing.
//
// AUTH: signature required. Disconnecting somebody else's device would stop
// their claims from ever verifying.

import { isAddress } from "viem";
import { errorMessage, jsonError, readJsonBody } from "@/lib/server/http";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import { providerFor } from "@/lib/server/wearable";

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

    const provider = await providerFor(address);
    if (provider.id !== "whoop") {
      return jsonError(
        409,
        "This device was linked through Junction. Disconnect it from " +
          "Junction's own connection page.",
      );
    }

    await provider.disconnect(address);
    return Response.json({ disconnected: true, provider: provider.id });
  } catch (err) {
    console.error("[wearable/disconnect] failed", err);
    return jsonError(502, "Could not disconnect the device right now");
  }
}
