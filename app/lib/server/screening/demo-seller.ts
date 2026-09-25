// The x402 screening demo seller: a sanctioned mainnet payee SPOTTER must
// refuse to pay. Lives outside the route file because Next rejects non-handler
// exports from app/api route modules.

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
