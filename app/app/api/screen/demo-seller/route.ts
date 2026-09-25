// GET|POST /api/screen/demo-seller - a real HTTP 402 x402 seller whose
// payee is a sanctioned mainnet address.
//
// This exists to demonstrate the BLOCKED half of Intercepta's bar honestly.
// SPOTTER's buy side (lib/server/agent/x402.ts) preflights a seller with
// GatewayClient.supports(), reads payTo out of the PAYMENT-REQUIRED header,
// screens that payee live, and refuses to sign when Intercepta flags it.
// Nobody controls the private key of a sanctioned wallet, so the only honest
// way to put one in a payment flow is as the RECIPIENT of an agent payment,
// which is exactly what a seller's payTo is.
//
// Point X402_CHAIN_READ_URL at this route (plus X402_PRIVATE_KEY, a throwaway
// EOA that needs no funds to be refused) and the post-settle chain-read
// purchase quotes this seller, screens its payTo, and is held before any
// authorization is signed. The receipt's settle row carries the reason.
//
// The header shape mirrors what @circle-fin/x402-batching's supports() reads:
// base64 JSON with accepts[] containing a GatewayWalletBatched option for the
// client's chain. Chain id and GatewayWallet come from the SDK's CHAIN_CONFIGS,
// never hard-coded here.
//
// This route never accepts a payment. A request carrying a PAYMENT-SIGNATURE
// header still gets 402: the point is that SPOTTER never sends one.

import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { getAddress, isAddress } from "viem";
import { optionalEnv } from "@/lib/server/env";

/** OFAC SDN: Lazarus Group (DPRK), Ronin bridge exploiter, listed
 *  2022-04-14. A public, documented sanctioned mainnet address, used here
 *  only as the recipient a screened agent must refuse to pay. Override with
 *  X402_DEMO_SELLER_PAYTO to demo against another address. */
export const DEFAULT_DEMO_SELLER_PAYTO =
  "0x098B716B8Aaf21512996dC57EB0615e2383E2f96";

/** One-tenth of a cent in USDC atomic units, matching the chain-read
 *  estimate SPOTTER plans with. */
const DEMO_PRICE_ATOMIC = "1000";

export function demoSellerPayTo(): string {
  const raw = optionalEnv("X402_DEMO_SELLER_PAYTO", DEFAULT_DEMO_SELLER_PAYTO);
  return isAddress(raw) ? getAddress(raw) : DEFAULT_DEMO_SELLER_PAYTO;
}

/** The PAYMENT-REQUIRED payload, decoded. Exported for the test and for the
 *  docs, which print it. */
export function demoSellerPaymentRequired(resourceUrl: string) {
  const config = CHAIN_CONFIGS.arcTestnet;
  return {
    x402Version: 2,
    resource: { url: resourceUrl, description: "GoHealthMe demo x402 seller (screening demo)" },
    accepts: [
      {
        scheme: "exact",
        network: `eip155:${config.chain.id}`,
        amount: DEMO_PRICE_ATOMIC,
        asset: config.usdc,
        payTo: demoSellerPayTo(),
        maxTimeoutSeconds: 300,
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: config.gatewayWallet,
        },
      },
    ],
  };
}

function paymentRequired(request: Request): Response {
  const payload = demoSellerPaymentRequired(new URL(request.url).toString());
  const header = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
  return Response.json(
    {
      error: "payment required",
      demo: "This seller's payTo is a sanctioned mainnet address. SPOTTER screens it with Intercepta and refuses to sign.",
      payTo: payload.accepts[0].payTo,
    },
    {
      status: 402,
      headers: { "PAYMENT-REQUIRED": header, "cache-control": "no-store" },
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  return paymentRequired(request);
}

export async function POST(request: Request): Promise<Response> {
  return paymentRequired(request);
}
