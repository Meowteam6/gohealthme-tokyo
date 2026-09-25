// GET /api/agent/wallet - SPOTTER's public identity card.
//
// The Circle credentials are server-only, so this route is the browser's
// window onto the agent's wallet: address, live USDC balance, and the
// block-explorer URL that Circle's proof 3 requires. Read-only; nothing here
// can move money.

import { getCircleClient, getSpotterWallet, getSpotterUsdcBalance } from "@/lib/server/agent/wallet";
import { arcAddressUrl } from "@/lib/chains";
import { errorMessage, jsonError, newCorrelationId } from "@/lib/server/http";

export async function GET() {
  try {
    const client = getCircleClient();
    const [wallet, balance] = await Promise.all([
      getSpotterWallet(client),
      getSpotterUsdcBalance(client),
    ]);
    return Response.json({
      address: wallet.address,
      blockchain: wallet.blockchain,
      balanceUsd: balance.amount,
      explorerUrl: arcAddressUrl(wallet.address),
    });
  } catch (err) {
    // The detail names env vars and the wallet id; it stays in the log. The
    // browser gets a product state (fetchAgentWallet reads non-ok as unknown).
    const cid = newCorrelationId("agent-wallet");
    console.error(`[${cid}] ${errorMessage(err)}`);
    return jsonError(503, `SPOTTER's wallet is unavailable right now. Reference ${cid}.`);
  }
}
