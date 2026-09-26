// Treasury signer for sponsoring Arc USDC from a user's GoHealthMe balance
// (server only).
//
// The HealthPools contract pulls USDC from msg.sender, so the treasury cannot
// join or fund a pool on a user's behalf without making the treasury the
// participant. Instead, when a user draws on their GoHealthMe balance (funded
// via Blink on Base Sepolia), the treasury delivers the same amount of spendable
// USDC to the user's Arc wallet, and the existing join/fund/back flows pull from
// it unchanged. The balance ledger is debited first; this transfer settles it.
//
// Arc testnet: chain id 5042002, USDC ERC-20 at 0x3600..., 6 decimals. The
// GoHealthMe balance unit (uUSDC) maps 1:1 to this token's base units.
//
// Chain access goes through the shared fallback client in
// lib/server/arc-client.ts. This is a money path: a transfer that cannot reach
// the one hard-coded endpoint is a user whose balance was already debited.

import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDC_ADDRESS } from "@/lib/contract";
import { arcPublicClient, arcWalletClient } from "@/lib/server/arc-client";
import { requireEnv } from "@/lib/server/env";
import { withLock } from "@/lib/server/store";

/**
 * Every Base Sepolia send from the treasury key goes through this one lock.
 * viem picks the nonce from the pending transaction count, so two lambdas
 * sending at once from the same key can read the same count and one of the
 * two transactions is dropped or replaced. Holding the lock from nonce pick to
 * receipt means the next sender always sees the previous one mined.
 */
export const TREASURY_SEND_LOCK = "treasury-base-sender";
const TREASURY_SEND_LOCK_TTL_MS = 90_000;
const TREASURY_SEND_LOCK_WAIT_MS = 20_000;

/** Run fn while holding the treasury send lock. Throws LockUnavailableError
 *  when another send holds it past the wait, so the caller can say "busy". */
export function withTreasurySendLock<T>(fn: () => Promise<T>): Promise<T> {
  return withLock(
    TREASURY_SEND_LOCK,
    TREASURY_SEND_LOCK_TTL_MS,
    fn,
    TREASURY_SEND_LOCK_WAIT_MS,
  );
}

const USDC_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function treasuryAccount() {
  const pk = requireEnv("TREASURY_PRIVATE_KEY");
  const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  return privateKeyToAccount(normalized);
}

/**
 * Transfer amountUusdc (6-decimal micro-USDC) of the Arc USDC ERC-20 from the
 * treasury to the recipient and wait for inclusion. Returns the tx hash. A
 * debit of N uUSDC on the ledger delivers N uUSDC of spendable Arc USDC.
 */
export async function sponsorUsdc(
  to: Address,
  amountUusdc: bigint,
): Promise<Hex> {
  if (amountUusdc <= 0n) {
    throw new Error("Sponsor amount must be greater than zero.");
  }

  const account = treasuryAccount();
  const wallet = arcWalletClient(account);
  const publicClient = arcPublicClient();

  return withTreasurySendLock(async () => {
    // simulate first so revert reasons surface as readable errors
    const { request } = await publicClient.simulateContract({
      account,
      address: USDC_ADDRESS,
      abi: USDC_TRANSFER_ABI,
      functionName: "transfer",
      args: [to, amountUusdc],
    });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Treasury USDC transfer tx ${hash} reverted on Arc testnet`);
    }
    return hash;
  });
}

/**
 * Broadcast a plain native-ETH transfer from the treasury on Base Sepolia and
 * return its hash. Does NOT wait or lock: the gas drip holds the send lock
 * itself across this call and its receipt, then asserts the recipient's
 * balance delta.
 */
export async function sendTreasuryEth(
  to: Address,
  valueWei: bigint,
): Promise<Hex> {
  if (valueWei <= 0n) {
    throw new Error("ETH send amount must be greater than zero.");
  }
  const account = treasuryAccount();
  const wallet = arcWalletClient(account);
  return wallet.sendTransaction({
    account,
    chain: wallet.chain ?? null,
    to,
    value: valueWei,
  });
}
