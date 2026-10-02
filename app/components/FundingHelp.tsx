"use client";

// The first-run wall. A brand new wallet holds no USDC to cover the amount an
// action pulls - a pool entry fee, a top-up. Every USDC-pulling surface needs the same
// explanation and the same escape hatch, so it lives here rather than inside
// JoinPool.
//
// The instructions matter: at faucet.circle.com you PASTE an address and pick
// a network from a long dropdown, you do not "send" anything, and Base Sepolia
// is easy to miss. A 42-character address is also impossible to select by
// hand on a phone, so copying is a button, never a long-press drag.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUsdc, shortAddress } from "@/lib/contract";
import { FAUCET_GRANT_UUSDC } from "@/lib/money-guards";
import { FAUCET_URL, FUNDING_STEPS } from "@/lib/tx-errors";
import { type FundingResult, useTestUsdcFunding } from "@/lib/faucet-funding";
import { buttonClasses } from "@/components/ui";

type CopyState = { kind: "idle" } | { kind: "copied" } | { kind: "failed" };

/**
 * Tap-to-copy wallet address. `compact` truncates for the header row; the
 * full address is always what lands on the clipboard.
 */
export function CopyAddressButton({
  address,
  compact = false,
}: {
  address: string;
  compact?: boolean;
}) {
  const [copy, setCopy] = useState<CopyState>({ kind: "idle" });

  useEffect(() => {
    if (copy.kind === "idle") return;
    const timer = setTimeout(() => setCopy({ kind: "idle" }), 2500);
    return () => clearTimeout(timer);
  }, [copy]);

  const run = useCallback(() => {
    const clipboard =
      typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined) {
      setCopy({ kind: "failed" });
      return;
    }
    clipboard.writeText(address).then(
      () => setCopy({ kind: "copied" }),
      () => setCopy({ kind: "failed" }),
    );
  }, [address]);

  // Compact lives in the fixed-height header row, so it carries its feedback
  // in the label - a status line underneath would shift the whole bar.
  if (compact) {
    return (
      <button
        type="button"
        onClick={run}
        title={`Tap to copy ${address}`}
        aria-label={`Copy wallet address ${address}`}
        className="num inline-flex min-h-11 items-center rounded-control bg-fill-quiet px-3 py-2 text-[0.8125rem] font-medium text-muted shadow-[inset_0_0_0_1px_var(--border)] hover:text-foreground"
      >
        <span aria-live="polite">
          {copy.kind === "copied"
            ? "Copied"
            : copy.kind === "failed"
              ? "Copy failed"
              : shortAddress(address)}
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={run}
        title={`Tap to copy ${address}`}
        aria-label={`Copy wallet address ${address}`}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control bg-surface-deep px-3 py-3 text-left font-mono text-xs text-muted shadow-[inset_0_0_0_1px_var(--border-strong)] hover:text-foreground"
      >
        <span className="break-all">{address}</span>
        <span className="shrink-0 font-sans text-xs font-semibold text-foreground">
          {copy.kind === "copied" ? "Copied" : "Tap to copy"}
        </span>
      </button>
      <p aria-live="polite" className="m-0 text-xs text-haze">
        {copy.kind === "failed"
          ? "Copying is blocked in this browser - select the address by hand."
          : copy.kind === "copied"
            ? "Address copied."
            : ""}
      </p>
    </div>
  );
}

// Auto-attempt bookkeeping, module-scoped so it survives the remount the join
// flow does on every needs-funds -> checking -> needs-funds cycle. A first
// block auto-funds once per address per session; every later block needs a
// deliberate tap, so an entry-fee pool a single grant cannot cover does not
// loop fund -> recheck -> fund.
const autoAttempted = new Set<string>();

export default function FundingHelp({
  address,
  balance,
  needed = 0n,
  headline = "You need a little test USDC first.",
  note,
  onRecheck,
  recheckLabel = "I added it, check again",
}: {
  /** The signed-in wallet, or null while it is still resolving. */
  address: string | null;
  /** Current USDC balance in 6-decimal base units, or null if unread. */
  balance: bigint | null;
  /** USDC the pending action pulls on top of gas, in base units. */
  needed?: bigint;
  headline?: string;
  /** Extra context for the specific action, for example an entry fee. */
  note?: string;
  onRecheck?: () => void;
  recheckLabel?: string;
}) {
  const { phase, funding, fund } = useTestUsdcFunding();
  const [outcome, setOutcome] = useState<FundingResult | null>(null);

  // onRecheck's closure identity changes on every parent render, so hold it in
  // a ref and keep the one-shot auto-attempt effect depending only on address.
  const onRecheckRef = useRef(onRecheck);
  useEffect(() => {
    onRecheckRef.current = onRecheck;
  }, [onRecheck]);

  // Manual path (the primary button). Event-handler context, so clearing the
  // prior outcome before funding is fine here.
  const runFunding = useCallback(async () => {
    if (address === null) return;
    setOutcome(null);
    const result = await fund(address);
    setOutcome(result);
    // Only continue the original action when real USDC actually landed on Base.
    if (result.kind === "funded") onRecheckRef.current?.();
  }, [address, fund]);

  // Auto-attempt ONCE per address per session on the first block. Safe by
  // construction: the faucet dedupes per address/day and the delivery is
  // bounded by the withdraw cap and treasury floor, so a single automatic
  // attempt cannot overspend. The work is deferred past an await so the effect
  // never sets state synchronously.
  useEffect(() => {
    if (address === null) return;
    const key = address.toLowerCase();
    if (autoAttempted.has(key)) return;
    autoAttempted.add(key);
    let cancelled = false;
    void (async () => {
      // auto: draws the lower faucet reserve so incidental first blocks cannot
      // exhaust the budget a deliberate tap (the manual button below, and the
      // demo) needs.
      const result = await fund(address, { auto: true });
      if (cancelled) return;
      setOutcome(result);
      if (result.kind === "funded") onRecheckRef.current?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [address, fund]);

  const primaryLabel = funding
    ? phase === "moving"
      ? "Delivering your test USDC"
      : "Adding test USDC"
    : "Add free test USDC";

  // Shown only when the in-app grant could not fund the wallet (budget spent,
  // nothing to move, an error). The manual faucet steps always live in the
  // collapsed advanced options below, so this is just the honest heads-up that
  // the automatic add did not land.
  const fallbackReason =
    outcome === null
      ? null
      : outcome.kind === "budget-exhausted" || outcome.kind === "error"
        ? outcome.message
        : outcome.kind === "empty"
          ? "The in-app faucet had nothing to grant right now."
          : null;

  const extra = [note, needed > 0n ? `This uses ${formatUsdc(needed)} USDC.` : undefined]
    .filter((line): line is string => line !== undefined && line !== "")
    .join(" ");

  return (
    <FundingHelpView
      address={address}
      balance={balance}
      headline={headline}
      extra={extra}
      funding={funding}
      primaryLabel={primaryLabel}
      onFund={() => {
        void runFunding();
      }}
      funded={outcome !== null && outcome.kind === "funded"}
      fundedNote={outcome !== null && outcome.kind === "funded" ? (outcome.note ?? null) : null}
      fallbackReason={fallbackReason}
      onRecheck={onRecheck}
      recheckLabel={recheckLabel}
    />
  );
}

/**
 * The zero-balance step, drawn from props only: the wallet line, the one-tap
 * add, and the by-hand faucet steps behind a disclosure. FundingHelp feeds it
 * live state; the state gallery feeds it fixtures without touching a faucet.
 */
export function FundingHelpView({
  address,
  balance,
  headline,
  extra,
  funding,
  primaryLabel,
  onFund,
  funded,
  fundedNote = null,
  fallbackReason,
  onRecheck,
  recheckLabel,
}: {
  address: string | null;
  balance: bigint | null;
  headline: string;
  extra: string;
  funding: boolean;
  primaryLabel: string;
  onFund: () => void;
  funded: boolean;
  /** What the player should know beside the delivery, e.g. new test USDC is
   *  paused while what was waiting still moved. Null for a plain delivery. */
  fundedNote?: string | null;
  fallbackReason: string | null;
  onRecheck?: () => void;
  recheckLabel: string;
}) {
  return (
    <div>
      {headline !== "" ? (
        <p className="m-0 flex items-start gap-2.5 text-sm leading-[1.45] text-muted [&_b]:font-semibold [&_b]:text-foreground">
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" className="mt-px flex-none">
            <rect x="2" y="4" width="12" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 8.5h1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M4 4 10.5 2.2V4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span className="num">
            {balance !== null ? (
              <>
                Your wallet has <b>{formatUsdc(balance)}</b> test USDC.{" "}
              </>
            ) : null}
            {headline}
            {extra !== "" ? ` ${extra}` : ""}
          </span>
        </p>
      ) : null}

      {address !== null ? (
        <div className="mt-4">
          <button
            type="button"
            disabled={funding}
            onClick={onFund}
            className={buttonClasses({ block: true })}
          >
            {primaryLabel}
          </button>
          <p className="num m-0 mt-2 text-[0.8125rem] leading-[1.45] text-haze">
            Free on Base Sepolia, never real money. One tap adds{" "}
            {formatUsdc(FAUCET_GRANT_UUSDC)} test USDC, then this carries on where it stopped.
          </p>
          {funded ? (
            <p className="m-0 mt-2 text-sm font-semibold text-moonlight" aria-live="polite">
              {fundedNote ?? "Test USDC added."} Checking your balance again.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="m-0 mt-4 text-sm text-muted">Sign in to add test USDC.</p>
      )}

      {fallbackReason !== null ? (
        <p className="m-0 mt-3 text-sm text-muted" role="status">
          {`It did not land automatically: ${fallbackReason} You can add it yourself below.`}
        </p>
      ) : null}

      {/* The raw faucet steps are the power-user path, tucked behind a
          disclosure so the one-tap add above is the default. Kept fully
          available for anyone who wants to fund by hand. */}
      <details className="mt-3 border-t border-edge pt-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-muted hover:text-foreground">
          Add it by hand instead
        </summary>
        <div className="mt-2">
          <p className="m-0 text-[0.8125rem] font-semibold text-haze">Your wallet address</p>
          {address === null ? (
            <p className="m-0 mt-1 text-sm text-muted">Sign in to see the address to fund.</p>
          ) : (
            <div className="mt-1">
              <CopyAddressButton address={address} />
            </div>
          )}

          <p className="m-0 mt-3 text-[0.8125rem] font-semibold text-haze">From the Circle faucet</p>
          <ol className="m-0 mt-1 list-decimal space-y-1 pl-5 text-sm text-muted">
            {FUNDING_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <a
            href={FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-3 ${buttonClasses({ variant: "secondary", block: true })}`}
          >
            Open the Circle faucet
          </a>

          <p className="m-0 mt-3 text-sm text-muted">
            Or top up in-app from the balance card on{" "}
            <Link href="/dashboard" className="text-foreground underline decoration-muted/35 underline-offset-4">
              your dashboard
            </Link>
            .
          </p>

          {onRecheck !== undefined ? (
            <button
              type="button"
              onClick={onRecheck}
              className={`mt-3 ${buttonClasses({ variant: "secondary", block: true })}`}
            >
              {recheckLabel}
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
