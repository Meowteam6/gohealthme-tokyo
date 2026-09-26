"use client";

// sweep(poolId): the creator takes back what is left in a settled or
// cancelled pool. Unlike withdraw() it is not a pull from owed[]: the contract
// transfers the pool's remaining balance straight to the creator and emits
// FundsSwept(poolId, creator, amount).
//
// Same shape and the same money rule as useClaimRefund: a Base smart account
// with the CDP paymaster sends gaslessly, everything else signs a normal
// writeContract, and success is reported ONLY from the FundsSwept event for
// this pool and this creator. A green receipt is not a transfer.

import { useCallback, useState } from "react";
import { parseEventLogs, type Address, type Hash, type Log } from "viem";
import { useAccount } from "wagmi";
import {
  FUNDS_SWEPT_ABI,
  getArcPublicClient,
  getHealthPoolsAddress,
  healthPoolsAbi,
} from "@/lib/contract";
import { humanizeTxError } from "@/lib/tx-errors";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  useGasSponsorship,
  type GaslessStatus,
  type SponsoredCall,
} from "@/lib/useGasSponsorship";
import { useEnsureGas, withDripLine } from "@/lib/useEnsureGas";

export type SweepStatus =
  | { kind: "idle" }
  | { kind: "sweeping" }
  | { kind: "done"; txHash: Hash; amount: bigint }
  | { kind: "error"; message: string; raw?: string };

export interface UseSweepPoolResult {
  status: SweepStatus;
  busy: boolean;
  reset: () => void;
  gasless: GaslessStatus;
  sweep: (poolId: bigint) => Promise<{ amount: bigint; txHash: Hash }>;
}

/** The FundsSwept amount for this pool and this creator, or null. */
export function fundsSweptAmount(
  logs: Log[],
  poolId: bigint,
  creator: Address,
): bigint | null {
  const events = parseEventLogs({
    abi: FUNDS_SWEPT_ABI,
    logs,
    eventName: "FundsSwept",
  });
  const hit = events.find(
    (e) =>
      e.args.poolId === poolId &&
      e.args.creator.toLowerCase() === creator.toLowerCase() &&
      e.args.amount > 0n,
  );
  return hit === undefined ? null : hit.args.amount;
}

const NOT_CONFIGURED =
  "Challenges are not switched on for this build yet, so there is nothing to take back here.";

export function useSweepPool(): UseSweepPoolResult {
  const { getArcWalletClient } = useEmbeddedWallet();
  const { address: connectedAddress } = useAccount();
  const { status: sponsorship, sendSponsored } = useGasSponsorship();
  const { dripLine, ensureGas } = useEnsureGas();
  const gasless = withDripLine(sponsorship, dripLine);
  const [status, setStatus] = useState<SweepStatus>({ kind: "idle" });

  const reset = useCallback(() => {
    setStatus({ kind: "idle" });
  }, []);

  const sweep = useCallback(
    async (poolId: bigint): Promise<{ amount: bigint; txHash: Hash }> => {
      const poolsAddress = getHealthPoolsAddress();
      if (poolsAddress === null) {
        setStatus({ kind: "error", message: NOT_CONFIGURED });
        throw new Error(NOT_CONFIGURED);
      }
      const unmoved = (hash: Hash) =>
        new Error(
          `The transaction ${hash} mined but emitted no FundsSwept event for you, so no USDC moved.`,
        );
      try {
        if (gasless.willSponsor) {
          if (connectedAddress === undefined) {
            throw new Error("No Base Account connected. Sign in with Base first.");
          }
          const creator = connectedAddress;
          setStatus({ kind: "sweeping" });
          const call: SponsoredCall = {
            to: poolsAddress,
            abi: healthPoolsAbi,
            functionName: "sweep",
            args: [poolId],
          };
          const { hash } = await sendSponsored([call]);
          const receipt = await getArcPublicClient().getTransactionReceipt({ hash });
          const swept = fundsSweptAmount([...receipt.logs], poolId, creator);
          if (swept === null) throw unmoved(hash);
          setStatus({ kind: "done", txHash: hash, amount: swept });
          return { amount: swept, txHash: hash };
        }

        const walletClient = await getArcWalletClient();
        const publicClient = getArcPublicClient();
        const creator = walletClient.account.address;
        setStatus({ kind: "sweeping" });
        // An unsponsored wallet (the email EOA) pays its own gas: make sure it
        // has some, or this write fails with "gas required exceeds allowance (0)".
        await ensureGas(walletClient);
        const txHash = await walletClient.writeContract({
          address: poolsAddress,
          abi: healthPoolsAbi,
          functionName: "sweep",
          args: [poolId],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") {
          throw new Error(`The transaction ${txHash} reverted on Base Sepolia.`);
        }
        const swept = fundsSweptAmount([...receipt.logs], poolId, creator);
        if (swept === null) throw unmoved(txHash);
        setStatus({ kind: "done", txHash, amount: swept });
        return { amount: swept, txHash };
      } catch (err) {
        const human = humanizeTxError(err);
        setStatus({ kind: "error", message: human.detail, raw: human.raw });
        throw err instanceof Error ? err : new Error(human.detail);
      }
    },
    [getArcWalletClient, gasless.willSponsor, sendSponsored, connectedAddress, ensureGas],
  );

  return { status, busy: status.kind === "sweeping", reset, gasless, sweep };
}
