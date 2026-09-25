"use client";

import { useCallback, useState } from "react";
import { parseEventLogs, type Address, type Hash, type Log } from "viem";
import { useAccount } from "wagmi";
import {
  getArcPublicClient,
  getHealthPoolsAddress,
  healthPoolsAbi,
  POOLS_NOT_CONFIGURED_COPY,
} from "@/lib/contract";
import { humanizeTxError } from "@/lib/tx-errors";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  useGasSponsorship,
  type GaslessStatus,
  type SponsoredCall,
} from "@/lib/useGasSponsorship";

/**
 * The withdraw side of the pull-payment contract (C-1).
 *
 * settle() only CREDITS owed[user]; the money does not reach the wallet until
 * withdraw() runs, and withdraw() is the only path that actually transfers USDC
 * out. So this is a money path, and it obeys the money-path rule: success is
 * asserted on the Withdrawn event (real USDC out), NEVER on a mined transaction
 * alone. A tx can mine and still move nothing, so the amount reported is read
 * from the event, and if the event never fired the withdraw is treated as
 * failed rather than reported as a payout.
 *
 * Mirrors useUsdcDeposit's two paths: a Base smart account with a configured
 * CDP paymaster withdraws gaslessly through the EIP-5792 bundle; every other
 * wallet signs a normal viem writeContract. Errors surface through
 * humanizeTxError so a wallet's multi-line dump never reaches the UI verbatim.
 */

export type WithdrawStatus =
  | { kind: "idle" }
  | { kind: "withdrawing" }
  | { kind: "done"; txHash: Hash; amount: bigint }
  // message is the one-line human detail; raw carries the untouched wallet
  // error text for a collapsed technical-details view.
  | { kind: "error"; message: string; raw?: string };

export interface UseWithdrawResult {
  status: WithdrawStatus;
  busy: boolean;
  reset: () => void;
  /**
   * Whether the withdraw will be gaslessly sponsored, with an honest reason
   * otherwise - the same signal useUsdcDeposit surfaces, so a claim card can
   * say who pays gas.
   */
  gasless: GaslessStatus;
  /**
   * Pull everything the signed-in wallet is owed. Resolves with the amount that
   * actually moved (read from the Withdrawn event) and the tx hash; throws on
   * failure, including a mined transaction that emitted no Withdrawn event.
   */
  withdraw: () => Promise<{ amount: bigint; txHash: Hash }>;
}

/**
 * The USDC actually withdrawn by `owner` inside a set of logs, or null when no
 * Withdrawn event credited them. Reading the amount from the event is what makes
 * "money moved" an assertion rather than a hope: parseEventLogs is the same
 * primitive the agent's settle path uses to confirm AchieverPaid.
 */
function withdrawnAmount(logs: Log[], owner: Address): bigint | null {
  const events = parseEventLogs({
    abi: healthPoolsAbi,
    logs,
    eventName: "Withdrawn",
  });
  const hit = events.find(
    (e) =>
      e.args.account.toLowerCase() === owner.toLowerCase() && e.args.amount > 0n,
  );
  return hit === undefined ? null : hit.args.amount;
}

export function useWithdraw(): UseWithdrawResult {
  const { getArcWalletClient } = useEmbeddedWallet();
  const { address: connectedAddress } = useAccount();
  const { status: gasless, sendSponsored } = useGasSponsorship();
  const [status, setStatus] = useState<WithdrawStatus>({ kind: "idle" });

  const reset = useCallback(() => {
    setStatus({ kind: "idle" });
  }, []);

  const withdraw = useCallback(async (): Promise<{
    amount: bigint;
    txHash: Hash;
  }> => {
    const poolsAddress = getHealthPoolsAddress();
    if (poolsAddress === null) {
      const message =
        POOLS_NOT_CONFIGURED_COPY;
      setStatus({ kind: "error", message });
      throw new Error(message);
    }

    try {
      // ---- Sponsored (gasless) path --------------------------------------
      // A Base smart account with a configured CDP paymaster withdraws with no
      // network fee. sendSponsored returns only the bundle's tx hash, so the
      // receipt is fetched to read the Withdrawn event from its logs.
      if (gasless.willSponsor) {
        if (connectedAddress === undefined) {
          throw new Error("No Base Account connected. Sign in with Base first.");
        }
        const owner = connectedAddress;
        setStatus({ kind: "withdrawing" });
        const call: SponsoredCall = {
          to: poolsAddress,
          abi: healthPoolsAbi,
          functionName: "withdraw",
          args: [],
        };
        const { hash } = await sendSponsored([call]);
        const receipt = await getArcPublicClient().getTransactionReceipt({
          hash,
        });
        const moved = withdrawnAmount([...receipt.logs], owner);
        if (moved === null) {
          throw new Error(
            `The withdraw ${hash} mined but emitted no Withdrawn event, so nothing was claimed.`,
          );
        }
        setStatus({ kind: "done", txHash: hash, amount: moved });
        return { amount: moved, txHash: hash };
      }

      // ---- Normal (user-paid) path ---------------------------------------
      const walletClient = await getArcWalletClient();
      const publicClient = getArcPublicClient();
      const owner = walletClient.account.address;

      setStatus({ kind: "withdrawing" });
      const txHash = await walletClient.writeContract({
        address: poolsAddress,
        abi: healthPoolsAbi,
        functionName: "withdraw",
      });
      // waitForTransactionReceipt resolves once the tx is MINED and does not
      // throw on a revert, so success is checked on the receipt status and then
      // on the Withdrawn event - a link to a tx that moved nothing is exactly
      // the false payout this hook exists to prevent.
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      if (receipt.status !== "success") {
        throw new Error(
          `The withdraw transaction ${txHash} reverted on Base Sepolia.`,
        );
      }
      const moved = withdrawnAmount([...receipt.logs], owner);
      if (moved === null) {
        throw new Error(
          `The withdraw ${txHash} mined but emitted no Withdrawn event, so nothing was claimed.`,
        );
      }
      setStatus({ kind: "done", txHash, amount: moved });
      return { amount: moved, txHash };
    } catch (err) {
      const human = humanizeTxError(err);
      setStatus({ kind: "error", message: human.detail, raw: human.raw });
      throw err instanceof Error ? err : new Error(human.detail);
    }
  }, [getArcWalletClient, gasless.willSponsor, sendSponsored, connectedAddress]);

  const busy = status.kind === "withdrawing";

  return { status, busy, reset, gasless, withdraw };
}
