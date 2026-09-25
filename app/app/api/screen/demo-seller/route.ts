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

import { demoSellerPaymentRequired } from "@/lib/server/screening/demo-seller";

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
