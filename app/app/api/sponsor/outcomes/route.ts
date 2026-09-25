// Server-side sponsor outcome aggregation.
//
// fetchPoolEventTotals does a historical eth_getLogs scan that the BROWSER RPCs
// cannot serve: the primary Arc RPC prunes deploy-era history and the archival
// public one caps getLogs well below a full scan and rate-limits bursts. Run it
// here instead, where getArcPublicClient() uses the archival ARC_RPC_URL
// override that can serve the logs, then hand the client JSON-safe totals
// (bigints as strings).
//
// A failed scan is a 503 with a plain line, never {totals:{}}: an empty map
// reads in the console as zero joiners and $0.00 funded, a confident wrong
// answer to a sponsor. The console shows "outcomes could not be read" instead.

import { NextResponse } from "next/server";
import { ContractNotConfiguredError } from "@/lib/contract";
import { fetchPoolEventTotals } from "@/lib/sponsor-data";
import { newCorrelationId } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SerializedTotals {
  joined: number;
  completions: number;
  paidUsdc: string;
  toppedUpUsdc: string;
}

export async function GET() {
  const cid = newCorrelationId("sponsor-outcomes");
  try {
    const totals = await fetchPoolEventTotals();
    const out: Record<string, SerializedTotals> = {};
    for (const [poolId, t] of Object.entries(totals)) {
      out[poolId] = {
        joined: t.joined,
        completions: t.completions,
        paidUsdc: t.paidUsdc.toString(),
        toppedUpUsdc: t.toppedUpUsdc.toString(),
      };
    }
    return NextResponse.json({ totals: out });
  } catch (err) {
    console.error(`[${cid}] sponsor outcomes unavailable`, err);
    const error =
      err instanceof ContractNotConfiguredError
        ? "Runs are not open on this build yet."
        : `Outcomes could not be read right now. Reference ${cid}.`;
    return NextResponse.json({ error }, { status: 503 });
  }
}
