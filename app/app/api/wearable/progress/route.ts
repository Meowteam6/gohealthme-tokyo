// GET /api/wearable/progress?address=0x...&threshold=75&goalDays=7
//   optional: &start=<unixSeconds>&end=<unixSeconds>  (a pool's period window)
// Returns the address's streak from whichever provider backs this wallet:
//   { connected, provider, linkState, metric, streakDays, targetDays, lastSync }
// When start/end are given, progress is scoped to that pool period (counting
// from the goal's start), and targetDays is the period length in days.
// connected=false (rather than 404) when no provider is linked yet.
//
// linkState separates "linked, and we have data" from "linked, and nothing has
// arrived yet". Without it a wallet that connected an hour ago reported
// streakDays 0, which the dashboard rendered as "0 of 7 days" - indistinguishable
// from having missed every night. That is a fake zero about somebody's own
// behaviour, and it is the state every new user passes through.
//
// Replaces /api/junction/progress. The response shape is unchanged apart from
// the added `provider`, because a second provider must not mean a second
// client contract - lib/wearable-provider.ts parses one shape for both.
//
// AUTH: the caller must prove control of `address` with a fresh wallet
// signature (see lib/server/wallet-auth.ts for the header contract). The
// streak, the metric label, and the last sync time are all derived from that
// person's sleep data, and a wallet address is public — it is on chain and in
// this app's own participant lists — so possession of one cannot be treated as
// permission to read their health history.

import { type NextRequest } from "next/server";
import { isAddress } from "viem";
import { jsonError } from "@/lib/server/http";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import { providerFor } from "@/lib/server/wearable";
import { isWearableMetric, metricLabel } from "@/lib/wearable-goal";

/**
 * Upstream failures are logged with detail and answered without any. A
 * provider's error text carries the request path, the account state, and the
 * provider's own message; none of that belongs in a response to a caller who
 * may not even be the account holder.
 */
function upstreamFailure(err: unknown): Response {
  console.error("[wearable/progress] upstream request failed", err);
  return jsonError(502, "Health data is temporarily unavailable");
}

function parsePositiveInt(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 100) return null;
  return n;
}

function unixToISO(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
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

    const threshold = parsePositiveInt(params.get("threshold"), 75);
    const goalDays = parsePositiveInt(params.get("goalDays"), 7);
    if (threshold === null || goalDays === null) {
      return jsonError(400, "threshold and goalDays must be integers in 1..100");
    }

    // Optional pool window (unix seconds). When present, scope to the period.
    const startSec = Number(params.get("start"));
    const endSec = Number(params.get("end"));
    const hasWindow =
      Number.isFinite(startSec) && startSec > 0 && Number.isFinite(endSec) && endSec > startSec;
    const windowStartISO = hasWindow ? unixToISO(startSec) : undefined;
    const windowEndISO = hasWindow ? unixToISO(endSec) : undefined;
    const targetDays = hasWindow
      ? Math.floor((endSec - startSec) / 86400) + 1
      : goalDays;

    const provider = await providerFor(address);

    // WHICH METRIC THIS READ IS ABOUT.
    //
    // Without it the route answers about sleep, because getProgress is the
    // sleep-streak feed. That is right for the dashboard card and wrong for a
    // claim panel: an iPhone with no watch, or any step-only tracker, has zero
    // sleep rows, so the answer was "your device has sent nothing" - and the
    // claim panel hid the run button behind that, permanently, for a wallet
    // whose steps had already synced. Entry fee paid, goal met, claim
    // unstartable.
    const requestedMetric = params.get("metric");
    const metric = isWearableMetric(requestedMetric) ? requestedMetric : null;

    if (!(await provider.isConnected(address))) {
      return Response.json({
        connected: false,
        provider: provider.id,
        linkState: "not-linked",
        metric: null,
        streakDays: null,
        targetDays,
        lastSync: null,
      });
    }

    // A metric-scoped read answers about THAT metric, using the same
    // three-way distinction, from the metric-aware progress every provider
    // already implements.
    if (metric !== null && hasWindow) {
      // Asked BEFORE the call, not discovered by catching the throw. A
      // provider refuses an unmeasurable metric by throwing, the route used to
      // flatten that into a generic 502, and the client read 502 as an
      // OUTAGE - so somebody whose device simply cannot measure the goal was
      // told "this is on us, not on your device. Connecting one would not
      // change it", which is false on both counts when connecting another
      // device is precisely the fix. Same check the verdict path makes.
      if (!provider.metrics.includes(metric)) {
        return Response.json({
          connected: true,
          provider: provider.id,
          linkState: "metric-unavailable",
          metric: `${metricLabel(metric)} · since ${windowStartISO}`,
          streakDays: null,
          targetDays,
          lastSync: null,
        });
      }

      const scoped = await provider.getMetricProgress(
        address,
        metric,
        threshold,
        windowStartISO as string,
        windowEndISO as string,
      );
      return Response.json({
        connected: true,
        provider: provider.id,
        linkState:
          scoped.daysWithSource === 0
            ? "awaiting-first-sync"
            : scoped.daysWithData === 0
              ? "metric-unavailable"
              : "linked",
        metric: `${metricLabel(metric)} · since ${windowStartISO}`,
        streakDays: scoped.qualifyingDays,
        targetDays,
        lastSync: null,
      });
    }

    const progress = await provider.getProgress(
      address,
      threshold,
      goalDays,
      windowStartISO,
      windowEndISO,
    );
    // Three different situations hide behind an empty day list, and they need
    // different answers:
    //   nothing reported at all  -> the device has not synced yet; waiting works
    //   nights reported, none scored -> the device does not produce this number;
    //                                   waiting never works
    //   days present             -> normal
    const noScoredDays = progress.days.length === 0;
    const awaitingFirstSync = noScoredDays && progress.nightsReported === 0;
    const deviceCannotMeasure = noScoredDays && progress.nightsReported > 0;

    // Name the number this provider actually produces. A device that reports
    // sleep efficiency and not a proprietary score must not have its 92 called
    // a "sleep score" - they are different measurements on the same scale.
    const scoreLabel = provider.metrics.includes("sleep_score")
      ? "Sleep score"
      : provider.metrics.includes("sleep_efficiency")
        ? "Sleep efficiency"
        : "Sleep";

    return Response.json({
      connected: true,
      provider: provider.id,
      linkState: awaitingFirstSync
        ? "awaiting-first-sync"
        : deviceCannotMeasure
          ? "metric-unavailable"
          : "linked",
      metric: hasWindow
        ? `${scoreLabel} ≥ ${threshold} · since ${windowStartISO}`
        : `${scoreLabel} ≥ ${threshold}`,
      streakDays: progress.streakDays,
      targetDays,
      lastSync: progress.days[0]?.date ?? null,
    });
  } catch (err) {
    return upstreamFailure(err);
  }
}
