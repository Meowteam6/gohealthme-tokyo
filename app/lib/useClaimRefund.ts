"use client";

// claimRefund(poolId) on a CANCELLED pool: credits the joiner's stake to
// owed[] on-chain and emits RefundCredited. It is the missing first half of
// the refund path (P18, found 2026-09-06): once it lands, the existing
// ClaimPayout card sees owed > 0 and the normal withdraw() pulls the USDC.
//
// Same shape and the same money rule as useWithdraw: a Base smart account with
// the CDP paymaster sends gaslessly, everything else signs a normal
// writeContract, and success is reported ONLY from the RefundCredited event
// for this participant and this pool - a green receipt is not a refund.

import { useCallback, useState } from "react";
import { parseEventLogs, type Address, type Hash, type Log } from "viem";
import { useAccount } from "wagmi";
import {
  getArcPublicClient,
  getHealthPoolsAddress,
  healthPoolsAbi,
  REFUND_CREDITED_ABI,
} from "@/lib/contract";
import { humanizeTxError } from "@/lib/tx-errors";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  useGasSponsorship,
  type GaslessStatus,
  type SponsoredCall,
} from "@/lib/useGasSponsorship";

export type ClaimRefundStatus =
  | { kind: "idle" }
  | { kind: "claiming" }
  | { kind: "done"; txHash: Hash; amount: bigint }
  | { kind: "error"; message: string; raw?: string };

export interface UseClaimRefundResult {
  status: ClaimRefundStatus;
  busy: boolean;
  reset: () => void;
  gasless: GaslessStatus;
  claimRefund: (poolId: bigint) => Promise<{ amount: bigint; txHash: Hash }>;
}

/** This participant's RefundCredited amount for this pool, or null. */
export function refundCreditedAmount(
  logs: Log[],
  poolId: bigint,
  owner: Address,
): bigint | null {
  const events = parseEventLogs({
    abi: REFUND_CREDITED_ABI,
    logs,
    eventName: "RefundCredited",
  });
  const hit = events.find(
    (e) =>
      e.args.poolId === poolId &&
      e.args.participant.toLowerCase() === owner.toLowerCase() &&
      e.args.amount > 0n,
  );
  return hit === undefined ? null : hit.args.amount;
}

export function useClaimRefund(): UseClaimRefundResult {
  const { getArcWalletClient } = useEmbeddedWallet();
  const { address: connectedAddress } = useAccount();
  const { status: gasless, sendSponsored } = useGasSponsorship();
  const [status, setStatus] = useState<ClaimRefundStatus>({ kind: "idle" });

  const reset = useCallback(() => {
    setStatus({ kind: "idle" });
  }, []);

  const claimRefund = useCallback(
    async (poolId: bigint): Promise<{ amount: bigint; txHash: Hash }> => {
      const poolsAddress = getHealthPoolsAddress();
      if (poolsAddress === null) {
        const message =
          "HealthPools contract address is not configured. Set NEXT_PUBLIC_HEALTH_POOLS_ADDRESS.";
        setStatus({ kind: "error", message });
        throw new Error(message);
      }
      try {
        if (gasless.willSponsor) {
          if (connectedAddress === undefined) {
            throw new Error("No Base Account connected. Sign in with Base first.");
          }
          const owner = connectedAddress;
          setStatus({ kind: "claiming" });
          const call: SponsoredCall = {
            to: poolsAddress,
            abi: healthPoolsAbi,
            functionName: "claimRefund",
            args: [poolId],
          };
          const { hash } = await sendSponsored([call]);
          const receipt = await getArcPublicClient().getTransactionReceipt({
            hash,
          });
          const credited = refundCreditedAmount([...receipt.logs], poolId, owner);
          if (credited === null) {
            throw new Error(
              `The refund claim ${hash} mined but emitted no RefundCredited event for you, so nothing was credited.`,
            );
          }
          setStatus({ kind: "done", txHash: hash, amount: credited });
          return { amount: credited, txHash: hash };
        }

        const walletClient = await getArcWalletClient();
        const publicClient = getArcPublicClient();
        const owner = walletClient.account.address;
        setStatus({ kind: "claiming" });
        const txHash = await walletClient.writeContract({
          address: poolsAddress,
          abi: healthPoolsAbi,
          functionName: "claimRefund",
          args: [poolId],
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        if (receipt.status !== "success") {
          throw new Error(
            `The refund claim ${txHash} reverted on Base Sepolia.`,
          );
        }
        const credited = refundCreditedAmount([...receipt.logs], poolId, owner);
        if (credited === null) {
          throw new Error(
            `The refund claim ${txHash} mined but emitted no RefundCredited event for you, so nothing was credited.`,
          );
        }
        setStatus({ kind: "done", txHash, amount: credited });
        return { amount: credited, txHash };
      } catch (err) {
        const human = humanizeTxError(err);
        setStatus({ kind: "error", message: human.detail, raw: human.raw });
        throw err instanceof Error ? err : new Error(human.detail);
      }
    },
    [getArcWalletClient, gasless.willSponsor, sendSponsored, connectedAddress],
  );

  return { status, busy: status.kind === "claiming", reset, gasless, claimRefund };
}
