// GET /api/wearable/providers?address=0x...
// { providers: [{ id, label, configured, connected }], selected }
//
// What the device picker renders. `address` is optional: without it the route
// answers which providers this deployment supports at all, which is what a
// logged-out visitor needs; with it, and with a signature, it also says which
// one the wallet has chosen and whether it is actually linked.
//
// `connected` is reported per provider so the UI can show a user who has both
// linked which one their claims will actually use, rather than implying the
// selected one is live when it is not.

import { type NextRequest } from "next/server";
import { isAddress } from "viem";
import { jsonError } from "@/lib/server/http";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import {
  PROVIDER_IDS,
  providerById,
  providerConfigured,
  providerIdFor,
} from "@/lib/server/wearable";

export async function GET(request: NextRequest) {
  try {
    const address = request.nextUrl.searchParams.get("address");

    if (address === null) {
      return Response.json({
        providers: PROVIDER_IDS.map((id) => ({
          id,
          label: providerById(id).label,
          configured: providerConfigured(id),
          connected: false,
        })),
        selected: null,
      });
    }

    if (!isAddress(address)) {
      return jsonError(400, "Query param address must be a valid 0x address");
    }

    const auth = await requireAddressSignature(request, address);
    if (!auth.ok) {
      return jsonError(401, `Wallet signature required: ${auth.reason}`);
    }

    const selected = await providerIdFor(address);

    const providers = await Promise.all(
      PROVIDER_IDS.map(async (id) => {
        const provider = providerById(id);
        const configured = providerConfigured(id);
        let connected = false;
        if (configured) {
          try {
            connected = await provider.isConnected(address);
          } catch (err) {
            // One provider being unreachable must not blank the whole picker;
            // the other path may be exactly what the user needs right now.
            console.error(`[wearable/providers] ${id} status failed`, err);
          }
        }
        return { id, label: provider.label, configured, connected };
      }),
    );

    return Response.json({ providers, selected });
  } catch (err) {
    console.error("[wearable/providers] failed", err);
    return jsonError(502, "Could not read the connection status right now");
  }
}
