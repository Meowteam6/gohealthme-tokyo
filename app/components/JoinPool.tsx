"use client";

import { useRef, useState, type ReactNode } from "react";
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
import { Button, Fine } from "@/components/ui";
import FundingHelp from "@/components/FundingHelp";
import GaslessBadge from "@/components/GaslessBadge";
import JoinMoment, { type JoinMomentProps } from "@/components/JoinMoment";
import SignInGate from "@/components/SignInGate";
import HoldCoin from "@/components/spotter/HoldCoin";
import HoldBar from "@/components/run/HoldBar";
import {
  StakeAction,
  StakeFailed,
  StakePending,
  StakeVault,
} from "@/components/run/StakeCard";
import { joinCoinCopy, type JoinCoinPhase } from "@/components/join-coin";

type JoinStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "joining" }
  | { kind: "joined"; txHash: string | null }
  | { kind: "needs-funds"; balance: bigint }
  | { kind: "error"; error: HumanTxError };

/** What the stake card shows around the join, from the run page. */
export interface JoinPoolView {
  /** Stats, terms, the solo line and the checks: shown above the hold. */
  preamble: ReactNode;
  /** The run's name, for the tap-to-confirm question. */
  goalTitle: string;
  /** The joined card's words and numbers (JoinMoment), minus the receipt. */
  joined: Omit<JoinMomentProps, "txHash" | "fresh">;
  /** "Challenge a friend", for the phone bar once in; null on a private run. */
  barAction?: ReactNode;
}

/** Small print under the money action (docs/DESIGN.md, Voice). */
const BETA_FINE = "Beta: test USDC on Base Sepolia, no real money. Refunded if nobody hits.";

function JoinPoolInner({
  poolId,
  entryFee,
  alreadyJoined,
  view,
}: {
  poolId: bigint;
  entryFee: bigint;
  alreadyJoined: boolean;
  view: JoinPoolView;
}) {
  const { ready, authenticated, address, getArcWalletClient } =
    useEmbeddedWallet();
  const { status: sponsorship, sendSponsored } = useGasSponsorship();
  const { dripLine, ensureGas } = useEnsureGas();
  const gasless = withDripLine(sponsorship, dripLine);
  const queryClient = useQueryClient();
  const [rawStatus, setStatus] = useState<JoinStatus>({ kind: "idle" });
  const [coinKey, setCoinKey] = useState(0);

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

  const amount = formatUsdc(entryFee);

  if (status.kind === "joined") {
    // Fresh join in this mount -> the card announces itself. A returning
    // participant surfaced by the alreadyJoined prop leaves rawStatus at idle,
    // so it gets the same card, silently. This reads local UI state only; the
    // join transaction logic above is untouched.
    const inBar =
      view.barAction !== undefined && view.barAction !== null ? (
        <HoldBar mode="in" actionIds={["stake-done-action"]} watchKey="in">
          <p className="num m-0 mb-2 text-[0.9375rem] font-semibold">
            You&apos;re in. <span className="font-medium text-muted">Your {amount} is in the pot.</span>
          </p>
          {view.barAction}
        </HoldBar>
      ) : null;
    return (
      <>
        <JoinMoment
          {...view.joined}
          txHash={status.txHash}
          fresh={rawStatus.kind === "joined"}
        />
        {inBar}
      </>
    );
  }

  if (status.kind === "checking" || status.kind === "joining") {
    return (
      <div className="space-y-3">
        <StakePending
          title={
            status.kind === "checking"
              ? "Checking your wallet can cover the stake"
              : `Putting ${amount} USDC in the pot`
          }
          detail={
            status.kind === "checking"
              ? "A quick read on Base Sepolia. Nothing has moved yet."
              : "This takes a few seconds on Base Sepolia. Approve it in your wallet if it asks, and keep this page open."
          }
        />
        <GaslessBadge status={gasless} />
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <StakeFailed
        title={status.error.title}
        detail={status.error.detail}
        raw={status.error.raw}
        onRetry={() => void startJoin()}
        retryLabel="Try the stake again"
      >
        <Button variant="tertiary" size="sm" onClick={() => setStatus({ kind: "idle" })} className="mt-1">
          Back to the run&apos;s terms
        </Button>
      </StakeFailed>
    );
  }

  if (status.kind === "needs-funds") {
    return (
      <>
        {view.preamble}
        <StakeAction>
          <FundingHelp
            address={address}
            balance={status.balance}
            headline={`You need ${amount} to stake.`}
            onRecheck={() => void startJoin()}
          />
        </StakeAction>
        <StakeVault />
      </>
    );
  }

  const coinPhase: JoinCoinPhase =
    !ready || (authenticated && address === null) ? "wallet-loading" : "idle";
  const coin = joinCoinCopy(entryFee, coinPhase);

  // The hold and its tap fallback both land here, on the same startJoin the
  // old button called. HoldCoin commits once per mount, so every finished
  // attempt remounts it: a failed or refused join can be held again, and the
  // disabled reason covers the moments a join is already running.
  const commit = () => {
    void startJoin().finally(() => setCoinKey((k) => k + 1));
  };

  const hold = (bar: boolean) => (
    <HoldCoin
      key={`${coinKey}-${bar ? "bar" : "card"}`}
      onCommit={commit}
      label={coin.label}
      hint={coin.hint}
      tapLabel={bar ? "Tap instead" : undefined}
      confirmPrompt={`Stake ${amount} USDC on ${view.goalTitle}?`}
      confirmLabel={coin.confirmLabel}
      committedHint={coin.committedHint}
      disabled={coin.disabledReason !== null}
      disabledReason={coin.disabledReason ?? undefined}
    />
  );

  return (
    <>
      {view.preamble}
      <SignInGate note="Sign in to join this run.">
        {(openSignIn) =>
          authenticated ? (
            <>
              <StakeAction id="stake-action" fine={BETA_FINE}>
                {hold(false)}
              </StakeAction>
              <HoldBar mode="hold" actionIds={["stake-action"]} watchKey={`hold-${coinKey}`}>
                {hold(true)}
                <Fine className="-mt-1">Beta. Refunded if nobody hits.</Fine>
              </HoldBar>
            </>
          ) : (
            <StakeAction id="stake-action" fine={BETA_FINE}>
              <Button block disabled={!ready} onClick={openSignIn}>
                {ready ? `Sign in to stake ${amount} USDC` : "Getting sign-in ready"}
              </Button>
            </StakeAction>
          )
        }
      </SignInGate>
      {authenticated ? (
        <div className="mt-3">
          <GaslessBadge status={gasless} />
        </div>
      ) : null}
      <StakeVault />
    </>
  );
}

export default function JoinPool({
  poolId,
  entryFee,
  alreadyJoined = false,
  view,
}: {
  poolId: bigint;
  entryFee: bigint;
  alreadyJoined?: boolean;
  view: JoinPoolView;
}) {
  if (!DYNAMIC_CONFIGURED) {
    // Fail closed, in plain language. A build without a wallet signer must
    // refuse to join rather than render a button that cannot sign, and that
    // refusal is a designed property of the build, not a runtime fault, so it
    // reads as a quiet note instead of an error.
    return (
      <>
        {view.preamble}
        <div role="note" className="mt-4 rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
          <p className="m-0 text-base font-semibold">Joining is unavailable in this build</p>
          <p className="m-0 mt-1 text-sm text-muted">
            Sign-in is not switched on for this build, so it declines to join
            rather than fake a signature.
          </p>
        </div>
      </>
    );
  }
  return (
    <JoinPoolInner
      poolId={poolId}
      entryFee={entryFee}
      alreadyJoined={alreadyJoined}
      view={view}
    />
  );
}
