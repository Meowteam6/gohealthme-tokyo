// GET /api/ens/resolve?address=0xabc[,0xdef...] - the ENSv2 name a wallet
// should be shown as, resolved on Sepolia.
//
// Public and read-only. A name is returned only when it resolves back to the
// address on chain: an own ENS name the wallet linked (POST /api/ens/link,
// re-verified on mainnet and Sepolia at least hourly), else the wallet's ENS
// primary name, else a gohealthme.eth subname whose addr(60) record is the
// wallet. There is no lookup table.
// Cached server-side for a few minutes per address and invalidated by the
// claim route, so a feed of forty rows is not forty registry walks.
//
// Response JSON: { name: string | null } for one address; with several,
// { name, names: { [lowercased address]: string | null } }.

import { isAddress } from "viem";
import { cachedResolvedName } from "@/lib/server/ens/cache";
import { displayNameForAddress } from "@/lib/server/ens/link";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** One request resolves at most this many addresses. */
const RESOLVE_BATCH_MAX = 50;

export async function GET(request: Request) {
  const cid = newCorrelationId("ens-resolve");
  try {
    const raw = new URL(request.url).searchParams.get("address") ?? "";
    const requested = Array.from(
      new Set(
        raw
          .split(",")
          .map((a) => a.trim())
          .filter((a) => a !== ""),
      ),
    ).slice(0, RESOLVE_BATCH_MAX);
    if (requested.length === 0) {
      return jsonError(400, "address is required");
    }
    for (const address of requested) {
      if (!isAddress(address, { strict: false })) {
        return jsonError(400, `${address} is not a 0x address`);
      }
    }

    const names: Record<string, string | null> = {};
    await Promise.all(
      requested.map(async (address) => {
        names[address.toLowerCase()] = await cachedResolvedName(
          address,
          (a) => displayNameForAddress(a),
        );
      }),
    );
    const first = names[requested[0].toLowerCase()] ?? null;
    return Response.json(
      requested.length === 1 ? { name: first } : { name: first, names },
      { headers: { "cache-control": "private, max-age=30" } },
    );
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
