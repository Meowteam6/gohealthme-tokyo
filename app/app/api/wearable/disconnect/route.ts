// POST /api/wearable/disconnect
// Body: { address }
// Drops this wallet's connection at whichever provider currently backs it.
//
// Whether this works depends on who owns the link, not on which provider it
// is. A provider that holds the connection on our behalf can honour it; one
// that owns the link itself cannot, because isConnected asks upstream and
// would immediately report "connected" again - a success that does nothing.
//
// The provider decides by whether its disconnect throws, so a new provider
// that CAN disconnect is allowed through without editing this route. Hardcoding
// "only WHOOP" here would have made every other self-disconnecting provider a
// dead end, sending its users to a Junction page that knows nothing about them.
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

    try {
      await provider.disconnect(address);
    } catch (err) {
      // A provider that owns its own link refuses by throwing. Its message
      // names where the user actually has to go, so it is relayed rather than
      // replaced - this is guidance, not an internal failure.
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[wearable/disconnect] ${provider.id} cannot disconnect from here: ${reason}`,
      );
      return jsonError(409, reason);
    }

    return Response.json({ disconnected: true, provider: provider.id });
  } catch (err) {
    console.error("[wearable/disconnect] failed", err);
    return jsonError(502, "Could not disconnect the device right now");
  }
}
