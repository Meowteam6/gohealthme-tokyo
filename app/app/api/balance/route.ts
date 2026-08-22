// GET /api/balance?address=0x...
//   (file path: app/app/api/balance/route.ts -> route /api/balance)
//
// Returns the current GoHealthMe balance for an address in uUSDC (integer
// micro-USDC, 6 decimals). The amount is serialized as a string because it is
// a bigint. Returns 0 for an address with no ledger entry.
//
// Request:  query param ?address=<0x address>
// Response: { balanceUusdc: string }  e.g. { "balanceUusdc": "2000000" }
//           { error: string } on 400 (bad address) or 500 (unexpected failure)

import { isAddress, type Address } from "viem";
import { getBalance } from "@/lib/server/balance";
import { errorMessage, jsonError } from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    const address = new URL(request.url).searchParams.get("address");
    if (address === null || !isAddress(address)) {
      return jsonError(400, "address query param must be a valid 0x address");
    }

    const balanceUusdc = await getBalance(address as Address);
    return Response.json({ balanceUusdc: balanceUusdc.toString() });
  } catch (err) {
    // Last-resort guard -- the route must never crash.
    return jsonError(500, errorMessage(err));
  }
}
