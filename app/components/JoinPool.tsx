"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  erc20Abi,
  formatUsdc,
  getArcPublicClient,
  getHealthPoolsAddress,
  healthPoolsAbi,
  USDC_ADDRESS,
} from "@/lib/contract";
import {
  canCoverJoinCosts,
  humanizeTxError,
  type HumanTxError,
} from "@/lib/tx-errors";
import {
  useGasSponsorship,
  type SponsoredCall,
} from "@/lib/useGasSponsorship";
import { useEnsureGas, withDripLine } from "@/lib/useEnsureGas";
import { ErrorNote } from "@/components/ui";
import FundingHelp from "@/components/FundingHelp";
import GaslessBadge from "@/components/GaslessBadge";
import JoinMoment from "@/components/JoinMoment";
import SignInGate from "@/components/SignInGate";

type JoinStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "joining" }
  | { kind: "joined"; txHash: string | null }
  | { kind: "needs-funds"; balance: bigint }
  | { kind: "error"; error: HumanTxError };

function JoinPoolInner({
  poolId,
  entryFee,
  alreadyJoined,
}: {
  poolId: bigint;
  entryFee: bigint;
  alreadyJoined: boolean;
}) {
  const { ready, authenticated, address, getArcWalletClient } =
    useEmbeddedWallet();
  const { status: sponsorship, sendSponsored } = useGasSponsorship();
  const { dripLine, ensureGas } = useEnsureGas();
  const gasless = withDripLine(sponsorship, dripLine);
  const queryClient = useQueryClient();
  const [rawStatus, setStatus] = useState<JoinStatus>({ kind: "idle" });

  // The on-chain participant read resolves async and after refresh. If it
  // confirms we are already a participant, show "You are in" instead of the
  // join button -- never clobber an in-flight join or a fresh success that
  // already carries its tx hash. Derived, not an effect: the prop is the
  // source of truth and any non-idle local status outranks it.
  const status: JoinStatus =
    rawStatus.kind === "idle" && alreadyJoined
      ? { kind: "joined", txHash: null }
      : rawStatus;

  // Re-entrancy guard. The main join button disables while busy, but the
  // funding card's check-again button renders in a non-busy state, so a
  // double-click could start two joins: the second would revert with
  // ALREADY_JOINED and clobber the first one's success UI. State updates are
  // async, so a ref is the reliable same-tick guard.
  const joinInFlight = useRef(false);

  const startJoin = async () => {
    if (address === null || joinInFlight.current) return;
    joinInFlight.current = true;
    setStatus({ kind: "checking" });
    try {
      const poolsAddress = getHealthPoolsAddress();
      if (poolsAddress === null) {
        throw new Error(
          "Runs are not switched on for this build yet.",
        );
      }
      const publicClient = getArcPublicClient();

      // ---- Sponsored (gasless) path --------------------------------------
      // A Base Account (Coinbase Smart Wallet) with a configured CDP paymaster
      // joins gas-free: approve (only for an entry-fee pool) and joinPool go
      // out as one atomic EIP-5792 bundle with the paymaster covering gas.
      // A free pool then costs the participant nothing at all. Every other
      // wallet falls through to the unchanged normal path below.
      if (gasless.willSponsor) {
        // Gas is sponsored, so only the entry fee needs covering. A free pool
        // needs no balance at all.
        if (entryFee > 0n) {
          let balance: bigint | null = null;
          try {
            balance = await publicClient.readContract({
              address: USDC_ADDRESS,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            });
          } catch {
            balance = null;
          }
          if (balance !== null && balance < entryFee) {
            setStatus({ kind: "needs-funds", balance });
            return;
          }
        }

        const calls: SponsoredCall[] = [];
        if (entryFee > 0n) {
          calls.push({
            to: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: "approve",
            args: [poolsAddress, entryFee],
          });
        }
        calls.push({
          to: poolsAddress,
          abi: healthPoolsAbi,
          functionName: "joinPool",
          args: [poolId],
        });

        setStatus({ kind: "joining" });
        const { hash } = await sendSponsored(calls);
        setStatus({ kind: "joined", txHash: hash });
        await queryClient.invalidateQueries({ queryKey: ["pool"] });
        await queryClient.invalidateQueries({ queryKey: ["participants"] });
        await queryClient.invalidateQueries({ queryKey: ["participant"] });
        return;
      }

      // Preflight: Arc pays gas in USDC, so a wallet with no USDC cannot send
      // ANY transaction - viem would dump a raw insufficient-funds stack. Read
      // the balance first and show a funding card instead of attempting the
      // approve or join. A failed read falls through: the preflight is
      // best-effort and the catch below humanizes whatever the wallet throws.
      let balance: bigint | null = null;
      try {
        balance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
      } catch {
        balance = null;
      }
      if (balance !== null && !canCoverJoinCosts(balance, entryFee)) {
        setStatus({ kind: "needs-funds", balance });
        return;
      }

      // One wallet, one entry is enforced on-chain: joinPool dedupes on
      // msg.sender (ALREADY_JOINED on reuse), so it takes only the poolId — no
      // caller-supplied nullifier. World ID was removed in the Base build.
      const walletClient = await getArcWalletClient();
      // An unsponsored wallet (the email EOA) pays its own gas. Make sure it
      // has some before the approve, or the first write fails with
      // "gas required exceeds allowance (0)" and no retry can help.
      await ensureGas(walletClient);
      setStatus({ kind: "joining" });

      // Entry-fee pools pull USDC on join; approve that amount first.
      if (entryFee > 0n) {
        const approveHash = await walletClient.writeContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [poolsAddress, entryFee],
        });
        // waitForTransactionReceipt resolves once the transaction is MINED and
        // does not throw on a revert, so "You are in" off a bare await could
        // link a transaction that joined nobody. Check the status instead.
        const approveReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveHash,
        });
        if (approveReceipt.status !== "success") {
          throw new Error(
            `The USDC approval ${approveHash} reverted on Base Sepolia.`,
          );
        }
      }

      const joinHash = await walletClient.writeContract({
        address: poolsAddress,
        abi: healthPoolsAbi,
        functionName: "joinPool",
        args: [poolId],
      });
      const joinReceipt = await publicClient.waitForTransactionReceipt({
        hash: joinHash,
      });
      if (joinReceipt.status !== "success") {
        throw new Error(
          `The joinPool transaction ${joinHash} reverted on Base Sepolia.`,
        );
      }

      setStatus({ kind: "joined", txHash: joinHash });
      await queryClient.invalidateQueries({ queryKey: ["pool"] });
      await queryClient.invalidateQueries({ queryKey: ["participants"] });
      // Also refetch the SINGULAR participant query (["participant", id, address]):
      // it drives hasJoined, which gates the document upload + private-claim
      // sections. Without this they only appear after a manual page reload.
      await queryClient.invalidateQueries({ queryKey: ["participant"] });
    } catch (err) {
      setStatus({ kind: "error", error: humanizeTxError(err) });
    } finally {
      joinInFlight.current = false;
    }
  };

  if (status.kind === "joined") {
    // Fresh join in this mount -> the celebratory takeover pops in. A returning
    // participant surfaced by the alreadyJoined prop leaves rawStatus at idle,
    // so it gets the calm receipt with no takeover. This reads local UI state
    // only; the join transaction logic above is untouched.
    return (
      <JoinMoment
        txHash={status.txHash}
        celebrate={rawStatus.kind === "joined"}
      />
    );
  }

  if (status.kind === "needs-funds") {
    return (
      <FundingHelp
        address={address}
        balance={status.balance}
        headline="You need a little practice money to join"
        note={
          entryFee > 0n
            ? `This pool also uses a ${formatUsdc(entryFee)} USDC entry fee when you join.`
            : undefined
        }
        onRecheck={() => void startJoin()}
      />
    );
  }

  const busy = status.kind === "checking" || status.kind === "joining";

  return (
    <div className="space-y-3">
      <SignInGate note="Sign in to join this pool.">
        {(openSignIn) => (
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => {
              if (!authenticated) {
                openSignIn();
                return;
              }
              void startJoin();
            }}
            className="w-full rounded-xl bg-accent-strong px-5 py-3.5 text-base font-semibold text-background hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status.kind === "checking"
              ? "Checking your balance..."
              : status.kind === "joining"
                ? "Joining..."
                : authenticated
                  ? "I'm in"
                  : "Sign in to join"}
          </button>
        )}
      </SignInGate>
      {authenticated ? <GaslessBadge status={gasless} /> : null}
      <p className="text-xs text-muted">
        One wallet, one entry. Sign in with an email - the wallet is created
        for you, no seed phrase and no app to install.
      </p>
      {status.kind === "error" ? (
        <div className="space-y-2">
          <ErrorNote
            title={status.error.title}
            detail={status.error.detail}
            onRetry={() => setStatus({ kind: "idle" })}
          />
          {status.error.raw !== "" &&
          status.error.raw !== status.error.detail ? (
            <details className="rounded-xl border border-edge bg-surface/50 px-4 py-3">
              <summary className="cursor-pointer text-xs font-medium text-muted">
                Technical details
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted">
                {status.error.raw}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function JoinPool({
  poolId,
  entryFee,
  alreadyJoined = false,
}: {
  poolId: bigint;
  entryFee: bigint;
  alreadyJoined?: boolean;
}) {
  if (!DYNAMIC_CONFIGURED) {
    // Fail closed, in plain language. A build without a wallet signer must
    // refuse to join rather than render a button that cannot sign — and that
    // refusal is a designed property of the build, not a runtime fault, so it
    // wears the neutral dashed-note treatment instead of an error card.
    return (
      <div
        role="note"
        className="rounded-xl border border-dashed border-edge bg-surface/50 p-4"
      >
        <p className="text-base font-semibold">
          Joining is unavailable in this build
        </p>
        <p className="mt-1 text-sm text-muted">
          This demo ships without a wallet signer, so it declines to join
          rather than fake a signature.
        </p>
      </div>
    );
  }
  return (
    <JoinPoolInner
      poolId={poolId}
      entryFee={entryFee}
      alreadyJoined={alreadyJoined}
    />
  );
}
