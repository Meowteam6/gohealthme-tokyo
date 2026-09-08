// GET /api/wearable/data?address=0x...&days=7
// Recent per-day sleep and activity from whichever provider backs this wallet,
// for the dashboard display. { connected, provider, sleep[], activity[] }.
//
// Replaces /api/junction/data.
//
// `activity` is empty on the WHOOP path: WHOOP measures strain and does not
// report step counts, and the app deliberately does not request the scopes
// that would carry other metrics. That is reported as an absent series rather
// than a row of zeros, which would read as a user who did not move.
//
// AUTH: the caller must prove control of `address` with a fresh wallet
// signature (see lib/server/wallet-auth.ts for the header contract). This
// route returns somebody's per-day sleep scores, sleep hours, and step counts
// keyed on a wallet address — a value that is public on chain and visible in
// this app's own participant lists. Without the signature, reading a stranger's
// health history took nothing more than copying their address out of a pool.

import { type NextRequest } from "next/server";
import { isAddress } from "viem";
import { jsonError } from "@/lib/server/http";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import { providerFor } from "@/lib/server/wearable";

function upstreamFailure(err: unknown): Response {
  console.error("[wearable/data] upstream request failed", err);
  return jsonError(502, "Health data is temporarily unavailable");
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const address = params.get("address");
    if (address === null || !isAddress(address)) {
      return jsonError(400, "Query param address must be a valid 0x address");
    }

    const auth = await requireAddressSignature(request, address);
    if (!auth.ok) {
      return jsonError(401, `Wallet signature required: ${auth.reason}`);
    }

    const daysRaw = Number(params.get("days") ?? 7);
    const days = Number.isInteger(daysRaw) && daysRaw > 0 && daysRaw <= 30 ? daysRaw : 7;

    const provider = await providerFor(address);

    if (!(await provider.isConnected(address))) {
      return Response.json({
        connected: false,
        provider: provider.id,
        sleep: [],
        activity: [],
      });
    }
    const recent = await provider.getRecent(address, days);
    return Response.json({ connected: true, provider: provider.id, ...recent });
  } catch (err) {
    return upstreamFailure(err);
  }
}
