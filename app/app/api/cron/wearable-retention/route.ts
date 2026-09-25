// GET/POST /api/cron/wearable-retention - enforce the health-data retention window.
//
// wearable_days holds per-day wearable aggregates (Apple Health). The privacy
// promise is that they are kept no longer than the retention window (120 days,
// comfortably past the longest pool period). The database function
// sweep_wearable_days deletes older rows; only the service role may call it.
// Nothing ran it until this cron, so retention was a promise with no teeth.
//
// Driven daily by Vercel cron (app/vercel.json). Auth: `authorization: Bearer
// ${CRON_SECRET}`, timing-safe compared, the same proof the other crons use.

import { timingSafeEqual } from "crypto";
import { requireEnv } from "@/lib/server/env";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";
import { getSupabaseServiceRole } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = Buffer.from(`Bearer ${requireEnv("CRON_SECRET")}`);
  const header = request.headers.get("authorization");
  if (header === null) return false;
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

async function run(request: Request): Promise<Response> {
  const cid = newCorrelationId("wearable-retention");
  try {
    if (!authorized(request)) return jsonError(401, "unauthorized");
    const supabase = getSupabaseServiceRole();
    if (supabase === null) {
      // No database on this deployment means no health rows to retain.
      return Response.json({ ok: true, skipped: "no database configured" });
    }
    const { data, error } = await supabase.rpc("sweep_wearable_days", {
      older_than_days: 120,
    });
    if (error) {
      console.error(`[${cid}] sweep_wearable_days failed: ${error.message}`);
      return jsonError(502, `Retention sweep failed. Reference ${cid}.`);
    }
    const deleted = typeof data === "number" ? data : 0;
    console.log(`[${cid}] wearable retention swept ${deleted} rows`);
    return Response.json({ ok: true, deleted });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}
