import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { baseTxUrl } from "@/lib/chains";
import type { ProofPolicy } from "@/lib/contract";
import type { SpotterPose } from "@/lib/spotter-poses";
import Spotter from "@/components/spotter/Spotter";

/**
 * The minimum a thumb can reliably hit: 44px tall with room either side. Small
 * controls (a retry, a tab, a chip) kept drifting to ~33-37px because the
 * padding alone decided the height, so the height is stated here and shared
 * rather than re-derived per component. Sizing only - it carries no colour,
 * border, or radius, so the visual language of each control is untouched.
 */
export const TAP_TARGET =
  "inline-flex min-h-11 items-center justify-center px-4 py-2 text-sm font-medium";

export function ArcTxLink({
  txHash,
  label = "View transaction on Basescan",
}: {
  txHash: string;
  label?: string;
}) {
  return (
    <a
      href={baseTxUrl(txHash)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block break-all text-sm text-accent-deep underline"
    >
      {label}
    </a>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-surface-raised ${className}`}
    />
  );
}

export function PoolCardSkeleton() {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-5">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-4 h-7 w-3/4" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    </div>
  );
}

export function ErrorNote({
  title,
  detail,
  raw,
  onRetry,
}: {
  title: string;
  detail?: string;
  /**
   * Untouched wallet/contract error text, rendered collapsed behind a
   * "Technical details" summary. Money-path surfaces pass DepositStatus.raw
   * here so a failure that humanizes to a generic line still shows its real
   * cause on screen - without it, an unrecognized wallet error is invisible
   * to both the user and whoever they screenshot it to.
   */
  raw?: string;
  onRetry?: () => void;
}) {
  const showRaw = raw !== undefined && raw !== "" && raw !== detail;
  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/40 bg-danger/10 p-4"
    >
      <p className="text-base font-semibold text-danger">{title}</p>
      {detail !== undefined && detail !== "" ? (
        <p className="mt-1 break-words text-sm text-foreground/80">{detail}</p>
      ) : null}
      {showRaw ? (
        <details className="mt-2 rounded-lg border border-edge bg-surface/50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted">
            Technical details
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted">
            {raw}
          </pre>
        </details>
      ) : null}
      {onRetry !== undefined ? (
        <button
          type="button"
          onClick={onRetry}
          className={`mt-3 rounded-lg border border-danger/50 text-danger hover:bg-danger/20 ${TAP_TARGET}`}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/**
 * An empty slot: SPOTTER reacting, what goes here, and the one action that
 * fills it. DESIGN.md: empty states get `lounging` and a line, never an icon.
 */
export function EmptyState({
  title,
  detail,
  action,
  pose = "lounging",
  line,
}: {
  title: string;
  detail: string;
  /** The one action that fills this slot. */
  action?: ReactNode;
  /** SPOTTER pose shown above the title. Pass null to render no otter. */
  pose?: SpotterPose | null;
  /** SPOTTER's deadpan line, in his speech bubble. */
  line?: string;
}) {
  return (
    <div className="rounded-3xl border border-edge bg-surface px-6 py-10 text-center">
      {pose !== null ? (
        <Spotter
          pose={pose}
          size="lg"
          line={line}
          decorative={line === undefined}
          className="mx-auto mb-4 justify-center"
        />
      ) : null}
      <p className="font-display text-2xl font-bold leading-display tracking-display">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-md text-base text-muted">{detail}</p>
      {action !== undefined ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "muted" | "warning";
}) {
  const tones: Record<string, string> = {
    accent: "bg-accent/15 text-accent-deep border-accent/40",
    muted: "bg-surface-raised text-foreground border-edge",
    warning: "bg-warning/10 text-warning border-warning/30",
  };
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The trust-tier badge(s) for a pool's proof policy. Renders the floor tier and,
 * when a verified-floor pool also opts into self-reported proof, a distinct
 * warning-tone "Self-reported OK" chip. A self-reported FLOOR shows a single
 * warning-tone "Self-reported" badge — it is never dressed up as verified. One
 * source of truth so the pool card and the pool detail always agree.
 */
export function ProofTierBadges({ policy }: { policy: ProofPolicy }) {
  const acceptsSelf = policy.accepted.includes("self-reported");
  if (policy.floor === "self-reported") {
    return <Badge tone="warning">Self-reported</Badge>;
  }
  return (
    <>
      <Badge tone={policy.floor === "document" ? "accent" : "muted"}>
        {policy.floor === "document" ? "Document" : "Wearable"}
      </Badge>
      {acceptsSelf ? <Badge tone="warning">Self-reported OK</Badge> : null}
    </>
  );
}

// Honest-core primitives. Amounts, verdicts, and stamps render through these
// three components with no slot for an adjective: the brand voice is loud
// around the numbers, never inside them. Anything on screen that claims money
// moved or a goal was verified must come through here.

export function Money({
  usd,
  sign,
  size = "md",
  tone = "default",
}: {
  /** Whole-USD string with two decimals, exactly as the ledger recorded it. */
  usd: string;
  sign?: "+" | "-";
  size?: "sm" | "md" | "lg" | "xl";
  /** Money is always gold (DESIGN.md): deep gold on cream and surface.
   *  "gold" is kept for older call sites and renders the same. "on-dark" is
   *  bright gold for the river-ink night panel, where deep gold is unreadable.
   *  No adjective ever lives here; only the tone changes. */
  tone?: "default" | "gold" | "on-dark";
}) {
  const sizes: Record<string, string> = {
    sm: "text-sm font-bold",
    md: "text-base font-bold",
    lg: "text-[1.75rem] font-extrabold leading-display tracking-display",
    xl: "text-[2.5rem] font-extrabold leading-display tracking-display",
  };
  const color = tone === "on-dark" ? "text-gold" : "text-gold-deep";
  return (
    <span className={`font-display tabular-nums ${color} ${sizes[size]}`}>
      {sign !== undefined ? sign : ""}
      {usd} USDC
    </span>
  );
}

export function Verdict({
  verified,
  confidence,
  selfReported = false,
}: {
  verified: boolean;
  confidence?: "low" | "medium" | "high";
  /** The low-trust tier. When true, the badge NEVER reads "Verified": a
   *  self-reported photo/screenshot cannot be confirmed real, recent, or the
   *  participant's, and must be visually and semantically distinct from the
   *  verified (wearable/document) tier. */
  selfReported?: boolean;
}) {
  if (selfReported) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-bold text-warning">
          Self-reported
        </span>
        <span className="text-xs text-muted">unverified · low-trust</span>
        {confidence !== undefined ? (
          <span className="text-xs text-muted">{confidence} confidence</span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${
          verified
            ? "border-accent-deep/40 bg-accent-deep/10 text-accent-deep"
            : "border-danger/40 bg-danger/10 text-danger"
        }`}
      >
        {verified ? "✓ Verified" : "Not verified"}
      </span>
      {confidence !== undefined ? (
        <span className="text-xs text-muted">{confidence} confidence</span>
      ) : null}
    </span>
  );
}

/** The verdict stamp. The one place all-caps is allowed (DESIGN.md). */
export function Stamp({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  /** "gold" marks money in motion (a landed payout); "accent" is the trust
   *  stamp; "danger" a rejection. */
  tone?: "accent" | "danger" | "gold";
}) {
  const tones: Record<string, string> = {
    accent: "border-foreground bg-surface text-foreground",
    danger: "border-danger bg-surface text-danger",
    gold: "border-foreground bg-gold text-foreground",
  };
  return (
    <span
      className={`animate-stamp-in inline-block rounded-[10px] border-[3px] px-2.5 py-0.5 font-display text-sm font-extrabold uppercase tracking-[0.06em] ${tones[tone]}`}
      style={{ transform: "rotate(-4deg)" }}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold leading-snug">{value}</p>
    </div>
  );
}

// ------------------------------------------------------- Riverbank controls
// Buttons are Atkinson (it is UI copy, not display type). Coral is the one
// action colour and always carries ink text. Money and verdicts still render
// only through Money/Verdict above; a button or chip never states a number.

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The shared button. `primary` is the pressable toy: coral, ink text, a 4px
 * deeper-coral bottom shadow that compresses on press (a transform, so it
 * respects reduced-motion). `ghost` is the ink-outlined second action.
 * `secondary` is a quiet filled well. `coral` is an alias of `primary`.
 * `pop` is accepted for older call sites; primary always presses now.
 */
export function Button({
  variant = "primary",
  pop: _pop = false,
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "coral" | "ghost";
  pop?: boolean;
}) {
  const base = `inline-flex min-h-12 items-center justify-center gap-2 rounded-[18px] px-5 py-3 text-base font-bold transition-transform motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
  const pressable =
    "bg-accent text-foreground shadow-[var(--shadow-pop)] hover:bg-accent-hover active:translate-y-1 active:shadow-none disabled:translate-y-0 disabled:shadow-none disabled:hover:bg-accent";
  const variants: Record<string, string> = {
    primary: pressable,
    coral: pressable,
    secondary:
      "border border-edge bg-surface-raised text-foreground hover:border-foreground/40",
    ghost:
      "border-2 border-foreground bg-transparent text-foreground hover:bg-surface-raised",
  };
  void _pop;
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

/**
 * A selectable pill for amount pickers, duration pills and suggestion chips.
 * Selected is an ink fill (coral stays reserved for the primary action);
 * aria-pressed plus the fill keep selection from being colour-only.
 */
export function Chip({
  selected = false,
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex min-h-11 items-center justify-center rounded-full border-2 px-5 py-2.5 text-sm font-bold transition-colors motion-reduce:transition-none ${FOCUS} ${
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-edge bg-surface text-foreground hover:border-foreground/40"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * A card or row on the cream: surface fill, hairline border, 20px radius, no
 * offset shadow. `pop` is accepted for older call sites and adds nothing.
 */
export function Card({
  pop: _pop = false,
  className = "",
  children,
}: {
  pop?: boolean;
  className?: string;
  children: ReactNode;
}) {
  void _pop;
  return (
    <div
      className={`rounded-3xl border border-edge bg-surface p-5 sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}
