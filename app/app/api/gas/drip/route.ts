// POST /api/gas/drip
//   (file path: app/app/api/gas/drip/route.ts -> route /api/gas/drip)
//
// Sends a small amount of Base Sepolia ETH from the treasury to a wallet that
// cannot pay its own gas: the Dynamic email wallet is a plain EOA with 0 ETH
// and the paymaster only sponsors smart accounts. The client
// (lib/ensure-gas.ts) calls this right before the first on-chain write of any
// money path. Rules and caps live in lib/server/gas-drip.ts.
//
// Auth: EIP-191 signature headers (lib/server/wallet-auth) proving control of
// `address`. Anyone can sign for a fresh address, so the signature stops
// dripping to somebody else's wallet; the per-address and global caps bound
// the rest.
//
// Request JSON:  { address: string }
// Response JSON:
//   200 { dripped: true, tx, balanceWei, minWei }   sent, balance delta seen
//   200 { dripped: false, balanceWei, minWei }      already has enough gas
//   400 bad address | 401 no or wrong signature
//   429 { error, reason, retryAfterSeconds }        per-address cap or daily budget
//   503 { error, reason }                           treasury floor, lock busy, RPC down
//   502 { error, reason }                           send failed or not yet visible

import { isAddress, type Address } from "viem";
import { jsonError, readJsonBody } from "@/lib/server/http";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import {
  gasDripConfig,
  liveGasDripDeps,
  runGasDrip,
} from "@/lib/server/gas-drip";
import { serverFailure } from "@/lib/money-guards";

// viem signing and Base Sepolia RPC reads need the Node runtime.
export const runtime = "nodejs";

const SCOPE = "api/gas/drip";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError(400, "Body must be a JSON object.");
  }
  const { address } = body;
  if (typeof address !== "string" || !isAddress(address)) {
    return jsonError(400, "address must be a valid 0x address");
  }

  const auth = await requireAddressSignature(request, address);
  if (!auth.ok) {
    return jsonError(401, `Sign in with this wallet to get gas: ${auth.reason}.`);
  }

  let outcome;
  try {
    outcome = await runGasDrip(auth.address as Address, gasDripConfig(), liveGasDripDeps());
  } catch (err) {
    return serverFailure(SCOPE, err, {
      status: 503,
      message:
        "We could not reach the network to check your gas, so nothing was sent. Try again in a moment.",
    });
  }

  switch (outcome.kind) {
    case "dripped":
      return Response.json({
        dripped: true,
        tx: outcome.tx,
        balanceWei: outcome.balanceWei.toString(),
        minWei: outcome.minWei.toString(),
      });
    case "funded":
      return Response.json({
        dripped: false,
        balanceWei: outcome.balanceWei.toString(),
        minWei: outcome.minWei.toString(),
      });
    case "address-cap":
    case "budget":
      return Response.json(
        {
          error: outcome.message,
          reason: outcome.kind,
          retryAfterSeconds: outcome.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(outcome.retryAfterSeconds) },
        },
      );
    case "treasury-low":
    case "busy":
      return Response.json(
        { error: outcome.message, reason: outcome.kind },
        { status: 503 },
      );
    case "failed":
      if (outcome.error !== undefined) {
        console.error(`[${SCOPE}] drip failed`, outcome.error);
      }
      return Response.json(
        { error: outcome.message, reason: outcome.kind },
        { status: 502 },
      );
  }
}
