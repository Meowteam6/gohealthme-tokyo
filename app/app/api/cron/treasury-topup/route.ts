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
// one CDP faucet grant (USDC, plus ETH for gas). The CDP faucet is rate-limited,
// so a below-target tick that gets refused is normal - it is reported, not an
// error, and the next tick tries again.
//
// Auth: `authorization: Bearer ${CRON_SECRET}`, timing-safe compared - the same
// proof the sweep cron uses. Vercel cron sends it automatically.

import { timingSafeEqual } from "crypto";
import { requireEnv } from "@/lib/server/env";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";
import { treasuryUsdcBalanceUusdc } from "@/app/api/_money/treasury-balance";
import { fundTreasuryFromCdpFaucet } from "@/lib/server/cdp-faucet";
import { FAUCET_ADDRESS_DAILY_CAP_UUSDC } from "@/lib/money-guards";

// Refill until the treasury can cover a full day of one address's grants. Set
// to the per-address faucet cap so a single active player is always coverable.
const TREASURY_TARGET_UUSDC = FAUCET_ADDRESS_DAILY_CAP_UUSDC;

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
    const faucet = await fundTreasuryFromCdpFaucet({ includeEth: true });
    // Money-path observability: the outcome only rides the response body, so log
    // it too - a rate-limit or missing-key reason must be visible in the logs.
    console.log(
      `[${cid}] treasury-topup treasury=${faucet.address} before=${balanceUusdc.toString()} ok=${faucet.ok} usdcTx=${faucet.usdcTxHash ?? "-"} ethTx=${faucet.ethTxHash ?? "-"} error=${faucet.error ?? "-"}`,
    );
    return Response.json({
      toppedUp: faucet.ok,
      treasury: faucet.address,
      balanceBeforeUusdc: balanceUusdc.toString(),
      targetUusdc: TREASURY_TARGET_UUSDC.toString(),
      usdcTxHash: faucet.usdcTxHash ?? null,
      ethTxHash: faucet.ethTxHash ?? null,
      error: faucet.error ?? null,
      cid,
    });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}

export const GET = handle;
export const POST = handle;
