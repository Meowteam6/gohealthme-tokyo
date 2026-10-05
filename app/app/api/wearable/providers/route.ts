// GET /api/wearable/providers?address=0x...
// { providers: [{ id, label, configured, connected, metrics, observedMetrics }],
//   selected }
//
// What the device picker renders. `address` is optional: without it the route
// answers which providers this deployment supports at all, which is what a
// logged-out visitor needs; with it, and with a signature, it also says which
// one the wallet has chosen and whether it is actually linked.
//
// `connected` is reported per provider so the UI can show a user who has both
// linked which one their claims will actually use, rather than implying the
// selected one is live when it is not.
//
// `metrics` is what the INTEGRATION can serve. `observedMetrics` is what this
// wallet's actual hardware has produced, and it is the one the gate prefers.
//
// The two differ in the cases that matter. Junction fronts several brands, so
// it declares a proprietary sleep score even for a wallet whose tracker has
// none. A phone-based provider declares sleep even for somebody syncing steps
// from an iPhone with no watch. Both wallets would otherwise be invited to
// stake on a goal their setup can never satisfy, and would learn at the claim -
// after the money moved, which is a trap rather than an error.
//
// Probed only for the provider actually backing this wallet, and only when it
// is connected: a browse surface must not pay for a probe of a provider nobody
// is using. Apple is the one exception (see GET): it is linked from the moment
// a phone redeems a code, before it is the stored choice, and its probe is a
// read of our own table. Null narrows nothing, so an upstream hiccup can never
// take challenges off somebody's board.

import { type NextRequest } from "next/server";
import { isAddress } from "viem";
import { jsonError } from "@/lib/server/http";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import type { ObservedCapability } from "@/lib/server/wearable";
import {
  PROVIDER_IDS,
  providerById,
  providerConfigured,
  providerIdFor,
} from "@/lib/server/wearable";
import { appleAppAvailable, appleConfigured } from "@/lib/server/wearable/apple";
import { whoopSeatStatus } from "@/lib/server/wearable/whoop-seats";

const WHOOP_FULL_NOTE =
  "WHOOP's direct seats are full. Pair through Junction instead; it covers WHOOP straps too.";
// The Apple store exists but APPLE_APP_AVAILABLE is off, so Apple is neither
// offered nor read (lib/server/wearable/index.ts providerConfigured). A wallet
// whose iPhone already synced is served by the fallback provider in that
// state; this line keeps that from being silent.
const APPLE_NOT_OPEN_NOTE = "Apple Watch is not open on this build yet.";

function appleNote(): string | null {
  return appleConfigured() && !appleAppAvailable() ? APPLE_NOT_OPEN_NOTE : null;
}

export async function GET(request: NextRequest) {
  try {
    const address = request.nextUrl.searchParams.get("address");

    if (address === null) {
      return Response.json({
        providers: await Promise.all(PROVIDER_IDS.map(async (id) => ({
          id,
          label: providerById(id).label,
          // WHOOP pairing is allowlisted per wallet; with no address, nobody
          // is on the list, so it is not offered.
          configured:
            id === "whoop"
              ? providerConfigured(id) && (await whoopSeatStatus(null)).seatsLeft > 0
              : providerConfigured(id),
          note:
            id === "whoop" && providerConfigured(id) && (await whoopSeatStatus(null)).seatsLeft === 0
              ? WHOOP_FULL_NOTE
              : id === "apple"
                ? appleNote()
                : null,
          connected: false,
          metrics: providerById(id).metrics,
          capability: "declared",
          observedMetrics: null,
        }))),
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

        // Four-way, and the wire keeps all four. "unknown" means we could
        // not find out, and "awaiting-sync" means a multi-brand provider has
        // nothing from this device yet. The client must withhold on both
        // rather than fall back to the declared union - that fallback is how
        // a Junction outage handed a wallet all seven metrics on no evidence,
        // and how a WHOOP-via-Junction wallet was offered steps runs.
        //
        // Apple is probed whenever it is linked, selected or not. It records
        // itself as the wallet's provider only when the first day arrives, so
        // a phone that redeemed a code and has not synced is linked while the
        // stored choice is still Junction or WHOOP. The pairing panel reads
        // Apple's entry directly (lib/wearable-connect.ts phonePairingOf),
        // and "declared" there renders as paired with every metric before a
        // single day exists. The probe is a query against our own table, so
        // nothing upstream is paid for a provider nobody is using.
        let capability: ObservedCapability = { kind: "declared" };
        if (connected && (id === selected || id === "apple")) {
          try {
            capability = await provider.observedMetrics(address);
          } catch (err) {
            console.error(`[wearable/providers] ${id} probe failed`, err);
            capability = { kind: "unknown" };
          }
        }

        // WHOOP is offered only to allowlisted wallets (10-member sandbox cap);
        // a wallet already linked keeps its link and reads either way.
        const offered =
          id === "whoop"
            ? configured && ((await whoopSeatStatus(address)).allowed || connected)
            : configured;

        return {
          id,
          label: provider.label,
          configured: offered,
          note:
            id === "whoop" && configured && !offered
              ? WHOOP_FULL_NOTE
              : id === "apple"
                ? appleNote()
                : null,
          connected,
          metrics: provider.metrics,
          capability: capability.kind,
          observedMetrics:
            capability.kind === "observed" ? capability.metrics : null,
        };
      }),
    );

    return Response.json({ providers, selected });
  } catch (err) {
    console.error("[wearable/providers] failed", err);
    return jsonError(502, "Could not read the connection status right now");
  }
}
