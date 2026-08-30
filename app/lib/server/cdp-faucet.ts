// CDP testnet faucet top-up for the practice-money treasury.
//
// WHY. The practice faucet (app/api/blink/topup) grants test USDC only while
// the treasury holds enough to cover a grant (treasuryCanCover). On Base
// Sepolia the treasury drains because testnet USDC is faucet-scarce, and the
// app then reports "nothing to grant" and no one can join. This refills the
// treasury from Coinbase Developer Platform's testnet faucet so the grant path
// keeps working with no human topping it up by hand.
//
// It funds treasuryAddress() - the same EOA the practice faucet pays FROM - so
// the treasury address never has to be known outside the server.
//
// AUTH. The CDP API key (CDP_API_KEY_ID + CDP_API_KEY_SECRET). No wallet secret
// is needed: requesting faucet funds to an address is a platform call, not a
// wallet signature, so CDP_WALLET_SECRET is intentionally omitted.
//
// LIMITS. The CDP faucet is rate-limited and grants a fixed testnet amount per
// claim, so this is a steady trickle that keeps a modest pilot funded - it is
// not a way to bankroll heavy activity. A busy pilot still needs the treasury
// seeded from a larger faucet. Every failure (rate-limit, missing key) is
// returned, never thrown, so the cron can log it and move on.

import { CdpClient } from "@coinbase/cdp-sdk";
import { treasuryAddress } from "@/app/api/_money/treasury-balance";

let cachedClient: CdpClient | null = null;

/** Lazily build the CDP client from env. Throws if the API key env is unset. */
function cdpClient(): CdpClient {
  if (cachedClient !== null) return cachedClient;
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (
    apiKeyId === undefined ||
    apiKeyId === "" ||
    apiKeySecret === undefined ||
    apiKeySecret === ""
  ) {
    throw new Error("CDP_API_KEY_ID / CDP_API_KEY_SECRET are not set");
  }
  cachedClient = new CdpClient({ apiKeyId, apiKeySecret });
  return cachedClient;
}

export interface CdpFaucetResult {
  /** True when the USDC faucet request was accepted. */
  ok: boolean;
  /** The treasury address that was funded. */
  address: string;
  usdcTxHash?: string;
  ethTxHash?: string;
  /** First failure encountered (rate-limit, missing key, transient), if any. */
  error?: string;
}

/**
 * Request testnet USDC (and optionally ETH for gas) from the CDP faucet into the
 * treasury. Best-effort: a rate-limit or transient error is returned in
 * `error`, never thrown.
 */
export async function fundTreasuryFromCdpFaucet(
  opts: { includeEth?: boolean } = {},
): Promise<CdpFaucetResult> {
  const address = treasuryAddress();
  const result: CdpFaucetResult = { ok: false, address };

  let cdp: CdpClient;
  try {
    cdp = cdpClient();
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }

  try {
    const usdc = await cdp.evm.requestFaucet({
      address: address as `0x${string}`,
      network: "base-sepolia",
      token: "usdc",
    });
    result.usdcTxHash = usdc.transactionHash;
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  if (opts.includeEth === true) {
    try {
      const eth = await cdp.evm.requestFaucet({
        address: address as `0x${string}`,
        network: "base-sepolia",
        token: "eth",
      });
      result.ethTxHash = eth.transactionHash;
    } catch (err) {
      // ETH is only for gas; a USDC success still counts. Record the reason
      // only if USDC did not already set one.
      if (result.error === undefined) {
        result.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  return result;
}
