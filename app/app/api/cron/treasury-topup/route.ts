// GET/POST /api/cron/treasury-topup - keep the practice-money treasury funded.
//
// Driven by Vercel cron (app/vercel.json). The blink/topup faucet only grants
// test USDC while the treasury can cover a grant; on Base Sepolia the treasury
// drains because testnet USDC is scarce, and the app then reports "nothing to
// grant". This tops the treasury up from the CDP testnet faucet whenever it
// falls below a target, so the grant path keeps working with no human in the
// loop.
//
// Idempotent and cheap: above the target it does nothing. Below it, it requests
// one CDP faucet grant (USDC, plus ETH for gas only when the treasury's ETH is
// under a floor). The CDP faucet is rate-limited, so a below-target tick that
// gets refused is normal - it is reported, not an error - but it is NOT retried
// every tick: a refusal starts a cooldown, and until it lapses the cron does
// nothing but say so. Measured 2026-09-04 before this: 288 refused USDC
// requests a day at a 58 USDC treasury, each one still pulling ETH that was
// never needed.
//
// Auth: `authorization: Bearer ${CRON_SECRET}`, timing-safe compared - the same
// proof the sweep cron uses. Vercel cron sends it automatically.

import { timingSafeEqual } from "crypto";
import { requireEnv } from "@/lib/server/env";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";
import {
  treasuryEthBalanceWei,
  treasuryUsdcBalanceUusdc,
} from "@/app/api/_money/treasury-balance";
import { fundTreasuryFromCdpFaucet } from "@/lib/server/cdp-faucet";
import { FAUCET_ADDRESS_DAILY_CAP_UUSDC } from "@/lib/money-guards";
import { readJson, writeJson } from "@/lib/server/store";

// Refill until the treasury can cover a full day of one address's grants. Set
// to the per-address faucet cap so a single active player is always coverable.
const TREASURY_TARGET_UUSDC = FAUCET_ADDRESS_DAILY_CAP_UUSDC;

/** Ask the faucet for ETH only below this. 0.02 ETH funds hundreds of the
 *  treasury's sponsored transfers on Base Sepolia. */
const TREASURY_ETH_FLOOR_WEI = 20_000_000_000_000_000n;

/** How long to stand down after the faucet refuses. CDP limits are per token
 *  per network per day; six hours gives a few honest retries a day instead of
 *  one every tick. */
const REFUSAL_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const COOLDOWN_FILE = "treasury-topup-cooldown.json";

interface Cooldown {
  untilMs: number;
  reason: string;
}

/** A CDP faucet refusal, as opposed to a transient failure worth retrying. */
function isRefusal(error: string | undefined): boolean {
  return error !== undefined && /limit reached|rate limit|too many requests/i.test(error);
}

function authorized(request: Request): boolean {
  const expected = Buffer.from(`Bearer ${requireEnv("CRON_SECRET")}`);
  const header = request.headers.get("authorization");
  if (header === null) return false;
  const provided = Buffer.from(header);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function handle(request: Request): Promise<Response> {
  const cid = newCorrelationId("treasury-topup");
  if (!authorized(request)) {
    return jsonError(401, "Missing or invalid authorization bearer token");
  }
  try {
    const balanceUusdc = await treasuryUsdcBalanceUusdc();
    if (balanceUusdc >= TREASURY_TARGET_UUSDC) {
      return Response.json({
        toppedUp: false,
        reason: "at or above target",
        balanceUusdc: balanceUusdc.toString(),
        targetUusdc: TREASURY_TARGET_UUSDC.toString(),
        cid,
      });
    }
    const now = Date.now();
    const cooldown = await readJson<Cooldown | null>(COOLDOWN_FILE, null);
    if (cooldown !== null && cooldown.untilMs > now) {
      return Response.json({
        toppedUp: false,
        reason: `cooling down after a faucet refusal (${cooldown.reason})`,
        cooldownUntil: new Date(cooldown.untilMs).toISOString(),
        balanceUusdc: balanceUusdc.toString(),
        targetUusdc: TREASURY_TARGET_UUSDC.toString(),
        cid,
      });
    }

    const ethWei = await treasuryEthBalanceWei();
    const ethRequested = ethWei < TREASURY_ETH_FLOOR_WEI;
    const faucet = await fundTreasuryFromCdpFaucet({ includeEth: ethRequested });

    let cooldownUntil: string | null = null;
    if (!faucet.ok && isRefusal(faucet.error)) {
      const untilMs = now + REFUSAL_COOLDOWN_MS;
      await writeJson<Cooldown>(COOLDOWN_FILE, {
        untilMs,
        reason: faucet.error ?? "refused",
      });
      cooldownUntil = new Date(untilMs).toISOString();
    }

    // Money-path observability: the outcome only rides the response body, so log
    // it too - a rate-limit or missing-key reason must be visible in the logs.
    console.log(
      `[${cid}] treasury-topup treasury=${faucet.address} before=${balanceUusdc.toString()} ethWei=${ethWei.toString()} ethRequested=${ethRequested} ok=${faucet.ok} usdcTx=${faucet.usdcTxHash ?? "-"} ethTx=${faucet.ethTxHash ?? "-"} error=${faucet.error ?? "-"} cooldownUntil=${cooldownUntil ?? "-"}`,
    );
    return Response.json({
      toppedUp: faucet.ok,
      treasury: faucet.address,
      balanceBeforeUusdc: balanceUusdc.toString(),
      targetUusdc: TREASURY_TARGET_UUSDC.toString(),
      ethRequested,
      usdcTxHash: faucet.usdcTxHash ?? null,
      ethTxHash: faucet.ethTxHash ?? null,
      error: faucet.error ?? null,
      cooldownUntil,
      cid,
    });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}

export const GET = handle;
export const POST = handle;
