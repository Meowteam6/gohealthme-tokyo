"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { getHealthPoolsAddress, parseUsdc } from "@/lib/contract";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useUsdcDeposit } from "@/lib/useUsdcDeposit";
import { ArcTxLink, Button, ErrorNote } from "@/components/ui";
import { FIELD, FIELD_HINT, FIELD_LABEL, Notice } from "@/components/night/kit";
import GaslessBadge from "@/components/GaslessBadge";
import SignInGate from "@/components/SignInGate";
import ChipInWarning, { type ChipInTerms } from "@/components/ChipInWarning";

interface FundPoolCopy {
  /** Section heading. Defaults to the sponsor top-up wording. */
  heading: string;
  /** One-line description under the heading. */
  description: string;
  /** The primary-button verb when signed in and idle. */
  ctaLabel: string;
}

function FundPoolInner({
  poolId,
  heading,
  description,
  ctaLabel,
  chipIn,
}: { poolId: bigint; chipIn?: ChipInTerms } & FundPoolCopy) {
  const queryClient = useQueryClient();
  const { ready, authenticated } = useEmbeddedWallet();
  const { status, busy, reset, runUsdcDeposit, gasless } = useUsdcDeposit();
  const [amount, setAmount] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const poolsAddress = getHealthPoolsAddress();
  if (poolsAddress === null) {
    return (
      <ErrorNote
        title="Challenges are off on this build"
        detail="This part is not switched on for this build yet. Nothing is wrong on your side."
      />
    );
  }

  const submit = async () => {
    setFormError(null);
    let amountUsdc: bigint;
    try {
      amountUsdc = parseUsdc(amount.trim());
      if (amountUsdc <= 0n) {
        throw new Error("Enter a USDC amount greater than zero.");
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Enter a valid USDC amount.",
      );
      return;
    }

    try {
      await runUsdcDeposit(amountUsdc, {
        functionName: "fundPool",
        args: [poolId, amountUsdc],
      });
      setAmount("");
      await queryClient.invalidateQueries({ queryKey: ["pool"] });
    } catch {
      // useUsdcDeposit captured the error into status.
    }
  };

  const primaryLabel =
    status.kind === "fueling"
      ? "One moment..."
      : status.kind === "approving"
      ? "Approving USDC..."
      : status.kind === "depositing"
        ? "Adding to the pot..."
        : authenticated
          ? ctaLabel
          : "Sign in to add to the pot";

  return (
    <div className="[&>*+*]:mt-3">
      <h3 className="m-0 text-lg font-semibold leading-tight text-foreground">{heading}</h3>
      <p className="m-0 text-[0.9375rem] leading-[1.45] text-muted">{description}</p>

      {/* Where the money goes, before the amount and the button. */}
      {chipIn !== undefined ? <ChipInWarning {...chipIn} /> : null}

      <div>
        <label htmlFor={`fund-amount-${poolId.toString()}`} className={FIELD_LABEL}>
          Amount
        </label>
        <div className="relative">
          <input
            id={`fund-amount-${poolId.toString()}`}
            type="text"
            inputMode="decimal"
            placeholder="25.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${FIELD} num pr-16`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[0.9375rem] text-haze">
            USDC
          </span>
        </div>
        <p className={FIELD_HINT}>Base Sepolia test USDC. Pulled from your wallet.</p>
      </div>

      <SignInGate note="Sign in to add to this challenge's pot.">
        {(openSignIn) => (
          <Button
            variant="secondary"
            block
            disabled={!ready || busy}
            onClick={() => {
              if (!authenticated) {
                openSignIn();
                return;
              }
              void submit();
            }}
          >
            {primaryLabel}
          </Button>
        )}
      </SignInGate>

      {authenticated ? <GaslessBadge status={gasless} /> : null}

      {status.kind === "approving" || status.kind === "depositing" ? (
        <p className="m-0 text-[0.8125rem] text-haze" role="status">
          Step {status.kind === "approving" ? "1" : "2"} of 2:{" "}
          {status.kind === "approving"
            ? "approving USDC"
            : "adding to the pot on Base"}
          ...
        </p>
      ) : null}

      {status.kind === "done" ? (
        <Notice tone="ok" title="Added to the pot." role="status" live>
          {status.approveHash ? (
            <>
              <ArcTxLink txHash={status.approveHash} label="View the approval" />
              <br />
            </>
          ) : null}
          <ArcTxLink txHash={status.depositHash} label="View the transaction" />
        </Notice>
      ) : null}

      {formError !== null ? (
        <ErrorNote
          title="Check the amount"
          detail={formError}
          onRetry={() => setFormError(null)}
        />
      ) : null}

      {status.kind === "error" ? (
        <ErrorNote
          title="Funding failed"
          detail={status.message}
          raw={status.raw}
          onRetry={reset}
        />
      ) : null}
    </div>
  );
}

export default function FundPool({
  poolId,
  heading = "Add to this challenge's pot",
  description = "Add test USDC to the pot so more of the players who hit can be paid.",
  ctaLabel = "Approve and add to the pot",
  chipIn,
}: {
  poolId: bigint;
  /** Anyone but the sponsor's own console: the chip-in warning, per model. */
  chipIn?: ChipInTerms;
} & Partial<FundPoolCopy>) {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <ErrorNote
        title="Sign-in is off on this build"
        detail="This part is not switched on for this build yet. Nothing is wrong on your side."
      />
    );
  }
  return (
    <FundPoolInner
      poolId={poolId}
      heading={heading}
      description={description}
      ctaLabel={ctaLabel}
      chipIn={chipIn}
    />
  );
}
