// GET /api/ens/receipt?poolId=<id> - the settlement receipt at
// pool-<id>.gohealthme.eth, read through real ENSv2 resolution on Sepolia.
//
// Public and read-only. The four records are what the universal resolver
// returns right now; `status` says whether SPOTTER has written them
// ("written"), has sent a transaction that has not resolved yet ("pending",
// with the Sepolia tx so the wait is checkable), or has written nothing
// ("none"). A pending receipt is never rendered as a written one.
//
// Response JSON:
//   { name, status, records: { txHash?, settledAt?, settledBy?, achieverCount? },
//     receipt: SettlementReceipt | null, pendingTx?: string, links: {...} }

import { RECEIPT_KEYS, ensAppUrl, sepoliaTxUrl } from "@/lib/ens/names";
import { readStoredReceipt } from "@/lib/server/ens/receipt";
import { readPoolReceipt } from "@/lib/server/ens/resolve";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cid = newCorrelationId("ens-receipt");
  try {
    const raw = new URL(request.url).searchParams.get("poolId") ?? "";
    if (!/^[1-9][0-9]{0,18}$/.test(raw)) {
      return jsonError(400, "poolId must be a positive integer");
    }
    const poolId = BigInt(raw);

    const read = await readPoolReceipt(poolId);
    if (read === null) {
      return jsonError(503, "Names are not enabled on this deployment yet.");
    }
    const stored = await readStoredReceipt(poolId);
    const records = {
      txHash: read.records[RECEIPT_KEYS.txHash] ?? undefined,
      settledAt: read.records[RECEIPT_KEYS.settledAt] ?? undefined,
      settledBy: read.records[RECEIPT_KEYS.settledBy] ?? undefined,
      achieverCount: read.records[RECEIPT_KEYS.achieverCount] ?? undefined,
    };
    const status =
      read.receipt !== null
        ? "written"
        : stored !== null && stored.status !== "failed"
          ? "pending"
          : "none";

    return Response.json({
      name: read.name,
      status,
      records,
      receipt: read.receipt,
      pendingTx: status === "pending" ? (stored?.sepoliaTxHash ?? undefined) : undefined,
      failure: stored?.status === "failed" ? stored.reason : undefined,
      links: {
        ensApp: ensAppUrl(read.name),
        sepoliaTx:
          stored?.sepoliaTxHash !== null && stored?.sepoliaTxHash !== undefined
            ? sepoliaTxUrl(stored.sepoliaTxHash)
            : undefined,
      },
    });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
