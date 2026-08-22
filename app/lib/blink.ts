"use client";

/**
 * Thin typed wrapper around the Blink "For Apps" deposit SDK
 * (@swype-org/deposit). Blink pulls stablecoins from a user's existing funded
 * wallet in one tap and settles them to our merchant address on Base Sepolia
 * (chain id 84532).
 *
 * This is a DECOUPLED top-up: Blink does not touch Arc. The USDC lands at the
 * merchant address; a separate balance ledger credits the user and later pool
 * actions draw from that balance. This module's only job is to start the
 * deposit and resolve with the outcome. It never calls a pool contract.
 *
 * Build-time config follows the app/lib/config.ts pattern: NEXT_PUBLIC_ values
 * are inlined by Next, and a missing value yields a visible configuration
 * error in the UI instead of a runtime crash.
 *
 * Docs: https://docs.blink.cash (For Apps integration, Web SDK reference).
 * Amount semantics confirmed from the docs: requestDeposit takes a human USD
 * number, not 6-decimal base units. Blink performs the on-chain USDC transfer.
 */

import { Deposit, DepositError, type DepositResult } from "@swype-org/deposit";

// ---------------------------------------------------------------- chain/token

/** Base Sepolia. Blink's testnet sandbox supports this chain. */
export const BLINK_CHAIN_ID = 84532;

/** USDC decimals on Base Sepolia (and every USDC), used for the uusdc math. */
export const BLINK_USDC_DECIMALS = 6;

// ---------------------------------------------------------------------- config

/**
 * Blink environment. Sandbox routes the hosted flow to pay-sandbox.blink.cash
 * (where testnet merchants live); production routes to pay.blink.cash. A
 * sandbox merchant is invisible to production and vice versa, so this MUST
 * match where the merchant was registered.
 */
export type BlinkEnvironment = "sandbox" | "production";

export interface BlinkConfig {
  /**
   * Endpoint that signs the deposit request server-side (ECDSA P-256). Blink
   * requires this; the client never holds the merchant signing key.
   */
  signerEndpoint: string;
  /** Base Sepolia USDC token address the deposit settles in. */
  usdcAddress: `0x${string}`;
  /** Base Sepolia address that receives the pulled USDC (our merchant wallet). */
  merchantAddress: `0x${string}`;
  /** Which Blink environment the merchant is registered in. */
  environment: BlinkEnvironment;
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function readAddress(value: string | undefined): `0x${string}` | null {
  if (value === undefined || value === "") return null;
  return HEX_ADDRESS.test(value) ? (value as `0x${string}`) : null;
}

/**
 * Resolve Blink config from env. Returns null when any required value is
 * missing or malformed so the UI can render a configuration error rather than
 * attempting a deposit that would fail.
 *
 * Env vars:
 *   NEXT_PUBLIC_BLINK_SIGNER_ENDPOINT  signer route (default /api/blink/sign)
 *   NEXT_PUBLIC_BLINK_USDC_ADDRESS     Base Sepolia USDC token address
 *   NEXT_PUBLIC_BLINK_MERCHANT_ADDRESS Base Sepolia merchant receive address
 *
 * BLINK_MERCHANT_ADDRESS (server-only) is read by the signer route; the client
 * needs the public NEXT_PUBLIC_ copy to populate the deposit destination.
 */
export function getBlinkConfig(): BlinkConfig | null {
  const signerEndpoint =
    process.env.NEXT_PUBLIC_BLINK_SIGNER_ENDPOINT ?? "/api/blink/sign";
  const usdcAddress = readAddress(process.env.NEXT_PUBLIC_BLINK_USDC_ADDRESS);
  const merchantAddress = readAddress(
    process.env.NEXT_PUBLIC_BLINK_MERCHANT_ADDRESS,
  );
  // Default to sandbox: testnet merchants are registered there. Override with
  // NEXT_PUBLIC_BLINK_ENV=production only when using a production merchant.
  const environment: BlinkEnvironment =
    process.env.NEXT_PUBLIC_BLINK_ENV === "production"
      ? "production"
      : "sandbox";

  if (signerEndpoint === "" || usdcAddress === null || merchantAddress === null) {
    return null;
  }

  return { signerEndpoint, usdcAddress, merchantAddress, environment };
}

export const BLINK_CONFIGURED: boolean = getBlinkConfig() !== null;

// ----------------------------------------------------------------- the result

export interface BlinkDepositOutcome {
  /**
   * On-chain transfer reference. Blink exposes an on-chain hash when the
   * destination transfer settles; when only the transfer id is available
   * (status pending past the widget close) we fall back to that id so callers
   * and the ledger always have a stable handle.
   */
  txHash: string;
  /** Amount actually requested, in 6-decimal USDC base units (micro-USDC). */
  amountUusdc: number;
}

// ----------------------------------------------------------- result extraction

interface DestinationLike {
  chainId?: string | number;
  address?: string;
  hash?: string;
  txHash?: string;
  transactionHash?: string;
}

interface TransferLike {
  id?: string;
  hash?: string;
  txHash?: string;
  transactionHash?: string;
  destinations?: DestinationLike[];
}

/**
 * The documented DepositResult surfaces a transfer summary; the on-chain hash
 * is not a guaranteed top-level field, so probe the known places (transfer
 * hash, then the matching destination's hash) and fall back to the transfer
 * id. This keeps onConfirmed resolvable even when the widget closes before the
 * settlement hash is attached.
 */
function extractTxHash(result: DepositResult): string {
  const transfer = (result as { transfer?: TransferLike }).transfer;
  if (transfer === undefined) {
    throw new BlinkResolutionError(
      "Blink deposit returned no transfer summary.",
    );
  }

  const direct =
    transfer.hash ?? transfer.txHash ?? transfer.transactionHash ?? null;
  if (direct !== null && direct !== "") return direct;

  const destinations = transfer.destinations ?? [];
  for (const dest of destinations) {
    const destHash = dest.hash ?? dest.txHash ?? dest.transactionHash ?? null;
    if (destHash !== null && destHash !== "") return destHash;
  }

  if (transfer.id !== undefined && transfer.id !== "") return transfer.id;

  throw new BlinkResolutionError(
    "Blink deposit completed but exposed no transaction reference.",
  );
}

/** Raised when a deposit completes but no usable reference can be read out. */
export class BlinkResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlinkResolutionError";
  }
}

/** Raised when Blink is not configured. */
export class BlinkNotConfiguredError extends Error {
  constructor() {
    super(
      "Blink is not configured. Set NEXT_PUBLIC_BLINK_USDC_ADDRESS and NEXT_PUBLIC_BLINK_MERCHANT_ADDRESS.",
    );
    this.name = "BlinkNotConfiguredError";
  }
}

// ----------------------------------------------------------------- conversion

/**
 * Convert a human USDC amount to 6-decimal base units without floating-point
 * drift. Blink itself takes the human USD number; we compute the base-unit
 * value ourselves for the callback and the downstream ledger credit.
 */
export function usdcToUusdc(amountUsdc: number): number {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    throw new Error("Top-up amount must be a positive number.");
  }
  // Round to cents-of-a-microunit safely: scale, round, integer result.
  return Math.round(amountUsdc * 10 ** BLINK_USDC_DECIMALS);
}

// ------------------------------------------------------------------ the action

export interface StartBlinkTopUpArgs {
  /** Human USDC amount to pull, e.g. 25 for 25 USDC. Must be > 0. */
  amountUsdc: number;
  /**
   * Optional reconciliation reference, e.g. the signed-in user's address, so
   * the ledger can match the merchant-side deposit back to the right user.
   */
  reference?: string;
}

/**
 * Start a one-tap USDC deposit on Base Sepolia into the merchant address.
 * Resolves with the on-chain reference and the micro-USDC amount on success;
 * rejects with a DepositError (user cancel, signer failure, settlement error)
 * or a BlinkNotConfiguredError / BlinkResolutionError.
 *
 * Throwing on cancel is intentional so the caller's status machine can route
 * cancels to its error/idle state, mirroring the imperative flow in JoinPool.
 */
export async function startBlinkTopUp(
  args: StartBlinkTopUpArgs,
): Promise<BlinkDepositOutcome> {
  const config = getBlinkConfig();
  if (config === null) {
    throw new BlinkNotConfiguredError();
  }

  const amountUusdc = usdcToUusdc(args.amountUsdc);

  const deposit = new Deposit({
    signer: config.signerEndpoint,
    // Route the hosted flow to the environment the merchant is registered in
    // (sandbox -> pay-sandbox.blink.cash). Mismatch yields MERCHANT_NOT_FOUND.
    environment: config.environment,
    // Show the full entry screen: it offers deposit addresses (pay from any
    // wallet or exchange) alongside the Blink one-tap path. The one-tap-only
    // surface assumes an already-funded Blink account, which a first-time user
    // does not have, so it dead-ends at "no tokens to link".
    enableFullWidget: true,
  });

  const result = await deposit.requestDeposit({
    amount: args.amountUsdc,
    chainId: BLINK_CHAIN_ID,
    address: config.merchantAddress,
    token: config.usdcAddress,
    reference: args.reference,
  });

  return { txHash: extractTxHash(result), amountUusdc };
}

export { DepositError };
