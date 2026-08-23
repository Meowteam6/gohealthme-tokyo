"use client";

import { useCallback } from "react";
import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { useAccount, useCapabilities, useConfig, useSendCalls } from "wagmi";
import { waitForCallsStatus } from "@wagmi/core";
import { baseSepolia } from "@/lib/chains";
import { CDP_PAYMASTER_URL, PAYMASTER_CONFIGURED } from "@/lib/config";

/**
 * CDP paymaster (gasless) sponsorship for money-path transactions, via EIP-5792
 * (wallet_getCapabilities + wallet_sendCalls) through the wagmi connector that
 * DynamicWagmiConnector bridges. This is the ONLY place the sponsored path
 * lives; each money-path surface keeps its existing viem writeContract flow as
 * the untouched normal (user-paid) fallback and only branches into
 * sendSponsored when status.willSponsor is true.
 *
 * Sponsorship requires BOTH halves:
 *   1. NEXT_PUBLIC_CDP_PAYMASTER_URL is set (PAYMASTER_CONFIGURED).
 *   2. The connected wallet advertises paymasterService on Base Sepolia — i.e.
 *      it is a smart account: a Base Account (Coinbase Smart Wallet), or the
 *      Dynamic email embedded wallet upgraded to an ERC-4337 smart account
 *      (ZeroDev Kernel) when EMAIL_AA_ENABLED. A plain EOA (the email wallet
 *      with AA off, or an external EOA) reports no capability, so willSponsor is
 *      false and the caller takes the normal path. This is the required
 *      graceful degradation: never fake gasless, never crash.
 *
 * This hook is wallet-agnostic on purpose: it keys off the EIP-5792
 * paymasterService capability, not the wallet brand, so the email smart account
 * flows through the exact same sponsored send as Base Account with no branch.
 */

export interface GaslessStatus {
  /** NEXT_PUBLIC_CDP_PAYMASTER_URL is set. */
  paymasterConfigured: boolean;
  /**
   * Connected wallet advertises EIP-5792 paymasterService on Base Sepolia — i.e.
   * it is a smart account (Base Account, or the email wallet upgraded to an
   * ERC-4337 smart account under EMAIL_AA_ENABLED), not a plain EOA.
   */
  smartWalletDetected: boolean;
  /** Both above true: the next money-path tx will be gaslessly sponsored. */
  willSponsor: boolean;
  /** One-line, honest explanation of the current mode for the UI. */
  reason: string;
}

/** A contract call to include in a sponsored EIP-5792 bundle. */
export interface SponsoredCall {
  to: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

export interface SponsoredResult {
  /** The on-chain hash of the last call in the bundle. */
  hash: Hash;
  sponsored: true;
}

export interface UseGasSponsorshipResult {
  status: GaslessStatus;
  /**
   * Send a batch of contract calls sponsored by the CDP paymaster (single
   * signature, atomic). Throws if sponsorship is unavailable — callers gate on
   * status.willSponsor and otherwise use their normal viem path. Resolves only
   * after every receipt reports success; a reverted call throws (no silent
   * failure on the money path).
   */
  sendSponsored: (calls: SponsoredCall[]) => Promise<SponsoredResult>;
}

export function useGasSponsorship(): UseGasSponsorshipResult {
  const { address } = useAccount();
  const config = useConfig();
  // Grouped by chain id. Disabled until a wallet is connected so a signed-out
  // session does not fire wallet_getCapabilities. An EOA that does not support
  // the method leaves data undefined -> smartWalletDetected false.
  const { data: capabilities } = useCapabilities({
    account: address,
    query: { enabled: address !== undefined },
  });
  const { sendCallsAsync } = useSendCalls();

  const paymasterConfigured = PAYMASTER_CONFIGURED;
  const smartWalletDetected = Boolean(
    capabilities?.[baseSepolia.id]?.paymasterService?.supported,
  );
  const willSponsor = paymasterConfigured && smartWalletDetected;

  const reason = willSponsor
    ? "Gas sponsored by the Base paymaster - you pay no network fee."
    : !smartWalletDetected
      ? "This wallet is a plain EOA (no smart-account paymaster capability), so it pays its own gas."
      : "No paymaster is configured, so this wallet pays its own gas.";

  const sendSponsored = useCallback(
    async (calls: SponsoredCall[]): Promise<SponsoredResult> => {
      if (!willSponsor) {
        // Programmer error, not a runtime money-path failure: callers must
        // check status.willSponsor first and take the normal path otherwise.
        throw new Error(
          "Gasless sponsorship is unavailable. Use the normal transaction path.",
        );
      }
      if (calls.length === 0) {
        throw new Error("No calls to send.");
      }

      const encoded = calls.map((call) => ({
        to: call.to,
        data: encodeFunctionData({
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
        } as Parameters<typeof encodeFunctionData>[0]) as Hex,
      }));

      const { id } = await sendCallsAsync({
        calls: encoded,
        capabilities: { paymasterService: { url: CDP_PAYMASTER_URL } },
      });

      // waitForCallsStatus resolves once the bundle is included; then assert on
      // the receipts, never on the bare send. A reverted call still returns a
      // receipt (status "reverted"), so success is only success when every
      // receipt says so.
      const { receipts } = await waitForCallsStatus(config, { id });
      if (receipts === undefined || receipts.length === 0) {
        throw new Error(
          "Sponsored transaction did not confirm on Base Sepolia.",
        );
      }
      for (const receipt of receipts) {
        if (receipt.status !== "success") {
          throw new Error(
            "A sponsored money-path call reverted on Base Sepolia.",
          );
        }
      }

      const last = receipts[receipts.length - 1];
      return { hash: last.transactionHash, sponsored: true };
    },
    [willSponsor, sendCallsAsync, config],
  );

  return {
    status: { paymasterConfigured, smartWalletDetected, willSponsor, reason },
    sendSponsored,
  };
}
