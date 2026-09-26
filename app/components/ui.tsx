import {
  Children,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from "react";
import Link from "next/link";
import { baseTxUrl } from "@/lib/chains";
import type { ProofPolicy } from "@/lib/contract";
import type { SpotterPose } from "@/lib/spotter-poses";
import Spotter from "@/components/spotter/Spotter";
import SpotterCaption from "@/components/spotter/SpotterCaption";

// Night Shift primitives (docs/DESIGN.md). One Button, one Card, one Chip, one
// Tag, one Stat, one RunCard shell. Every colour is a token from globals.css;
// nothing here hard-codes a hex. Server-safe: no hooks, no client state.
//
// Money and verdicts render through Money, Verdict and Stamp, with no slot for
// an adjective: the voice lives around the numbers, never inside them.

/** 44px minimum tap target, sizing only. */
export const TAP_TARGET =
  "inline-flex min-h-11 items-center justify-center px-4 py-2 text-sm font-medium";

/** The focus ring for anything custom: the moon, 2px, offset from the field. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-foreground";

// ---------------------------------------------------------------- Buttons

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  /** Retired Riverbank names: ghost renders secondary, coral renders primary. */
  | "ghost"
  | "coral";

export type ButtonSize = "md" | "sm";

export interface ButtonLook {
  variant?: ButtonVariant;
  /** md is 52px tall, sm is 44px. */
  size?: ButtonSize;
  /** Full width of its container. */
  block?: boolean;
}

const BUTTON_BASE = `relative inline-flex items-center justify-center gap-2.5 text-center font-semibold tracking-[-0.005em] no-underline transition-[transform,filter,box-shadow,background-color,color] duration-[90ms] ease-out active:scale-[0.98] disabled:pointer-events-none aria-disabled:pointer-events-none [-webkit-tap-highlight-color:transparent] ${FOCUS_RING}`;

const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: "min-h-[52px] rounded-control px-[22px] py-2 text-[1.0625rem] leading-tight",
  sm: "min-h-11 rounded-control px-4 py-1.5 text-[0.9375rem] leading-tight",
};

// Disabled never greys the moon out (a dimmed cream reads as broken): it
// drops to the quiet fill with haze text, so "not now" reads as a state.
const QUIET_DISABLED =
  "disabled:bg-none disabled:bg-fill-quiet disabled:text-haze disabled:shadow-[inset_0_0_0_1px_var(--border)] aria-disabled:bg-none aria-disabled:bg-fill-quiet aria-disabled:text-haze aria-disabled:shadow-[inset_0_0_0_1px_var(--border)]";

const BUTTON_VARIANT: Record<"primary" | "secondary" | "tertiary", string> = {
  // The moon: cream gradient, a lit top edge, a shaded bottom, a soft glow.
  primary: `bg-[linear-gradient(180deg,var(--accent-top)_0%,var(--accent)_55%,var(--accent-bottom)_100%)] text-accent-foreground shadow-moon hover:brightness-[1.04] active:shadow-moon-pressed ${QUIET_DISABLED}`,
  // A faint fill with an inset hairline.
  secondary: `bg-fill-quiet text-foreground shadow-secondary hover:bg-fill-quiet-hover ${QUIET_DISABLED}`,
  // A text link with an underline, still a 44px target.
  tertiary:
    "!min-h-11 !px-0 bg-transparent text-muted underline decoration-muted/35 underline-offset-4 hover:text-foreground disabled:text-haze disabled:no-underline aria-disabled:text-haze",
};

/** The class string for a button look, for anything that is not a <button>. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  block = false,
}: ButtonLook = {}): string {
  const v = variant === "ghost" ? "secondary" : variant === "coral" ? "primary" : variant;
  return `${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[v]} ${block ? "w-full" : ""}`;
}

/**
 * The one button. Primary is the moon face with ink text; secondary is a faint
 * fill with a hairline; tertiary is an underlined text action. Press is a 0.98
 * scale over 90ms, never an offset slab. `pop` is accepted from older call
 * sites and does nothing.
 */
export function Button({
  variant = "primary",
  size = "md",
  block = false,
  pop: _pop,
  className = "",
  type = "button",
  children,
  ...props
}: ComponentPropsWithoutRef<"button"> & ButtonLook & { pop?: boolean }) {
  void _pop;
  return (
    <button
      type={type}
      className={`${buttonClasses({ variant, size, block })} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** A link that looks like a Button. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Link> & ButtonLook) {
  return (
    <Link className={`${buttonClasses({ variant, size, block })} ${className}`} {...props}>
      {children}
    </Link>
  );
}

/** An inline text link: underlined, muted until hovered, 44px tall. */
export const TEXT_LINK = `inline-flex min-h-11 items-center gap-1.5 font-semibold text-muted underline decoration-muted/35 underline-offset-4 hover:text-foreground ${FOCUS_RING}`;

/** A quiet "See all" style link with a chevron: no underline, the chevron says link. */
export function ChevronLink({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link
      className={`group inline-flex min-h-11 items-center gap-1.5 font-semibold text-muted no-underline hover:text-foreground ${FOCUS_RING} ${className}`}
      {...props}
    >
      {children}
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="transition-transform duration-[120ms] group-hover:translate-x-0.5"
      >
        <path
          d="M6 3.5 10.5 8 6 12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

// ------------------------------------------------------------------ Chips

/**
 * A selectable chip: 44px, a quiet fill with a hairline, the moon face when
 * selected. It reports selection as aria-pressed, or as aria-checked when the
 * caller makes it a radio (role="radio" inside a role="radiogroup").
 */
export function Chip({
  selected = false,
  className = "",
  role,
  children,
  ...props
}: ComponentPropsWithoutRef<"button"> & { selected?: boolean }) {
  const state = role === "radio" ? { "aria-checked": selected } : { "aria-pressed": selected };
  return (
    <button
      type="button"
      role={role}
      {...state}
      className={`inline-flex min-h-11 flex-none items-center justify-center rounded-control px-[15px] text-[0.9375rem] font-semibold leading-none transition-[background-color,color,box-shadow] duration-[120ms] [-webkit-tap-highlight-color:transparent] disabled:opacity-55 ${FOCUS_RING} ${
        selected
          ? "bg-accent text-accent-foreground shadow-selected"
          : "bg-fill-quiet text-muted shadow-[inset_0_0_0_1px_var(--border-strong)] hover:text-foreground"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------- Tags

export type TagTone = "live" | "ended" | "muted";

/** A small status tag, e.g. "Open tonight". `live` is moonlight with a dot. */
export function Tag({
  tone = "live",
  dot = true,
  className = "",
  children,
}: {
  tone?: TagTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const tones: Record<TagTone, { box: string; dot: string }> = {
    live: {
      box: "bg-moonlight/10 text-moonlight",
      dot: "bg-moonlight shadow-[0_0_0_3px_color-mix(in_srgb,var(--moonlight)_18%,transparent)]",
    },
    ended: { box: "bg-fill-quiet-hover text-muted", dot: "bg-muted" },
    muted: { box: "bg-fill-quiet text-haze", dot: "bg-haze" },
  };
  const t = tones[tone];
  return (
    <span
      className={`inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-tag px-2.5 text-[0.8125rem] font-semibold ${t.box} ${className}`}
    >
      {dot ? <span aria-hidden="true" className={`size-1.5 rounded-full ${t.dot}`} /> : null}
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ Cards

export type CardVariant = "default" | "hero" | "flat" | "raised" | "paper";

const CARD_VARIANT: Record<CardVariant, string> = {
  // A lit top edge fading into the card field.
  default:
    "rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] text-foreground shadow-card",
  // The run card: stronger lit edge and a moonlight hairline across the top.
  hero:
    "rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_40%)] text-foreground shadow-card-hero before:pointer-events-none before:absolute before:left-[18%] before:right-[8%] before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--moonlight)_70%,transparent),transparent)] before:content-['']",
  // A row or list item: plain card field and a hairline.
  flat: "rounded-2xl bg-surface text-foreground shadow-[inset_0_0_0_1px_var(--border)]",
  // A well inside a card.
  raised: "rounded-control bg-surface-raised text-foreground shadow-[inset_0_0_0_1px_var(--border)]",
  // The receipt: paper, ink.
  paper:
    "rounded-2xl bg-[linear-gradient(180deg,var(--paper-top),var(--paper))] text-ink shadow-paper",
};

const CARD_PAD = {
  none: "",
  md: "px-4 py-[18px] min-[960px]:p-6",
  sm: "px-3.5 py-3",
} as const;

/**
 * A card on the night field. `default` is the lit card, `hero` the run card,
 * `flat` a row, `raised` a well inside a card, `paper` the receipt. `pop` is
 * accepted from older call sites and does nothing.
 */
export function Card({
  as: As = "div",
  variant = "default",
  padding = "md",
  pop: _pop,
  className = "",
  children,
  ...props
}: {
  as?: ElementType;
  variant?: CardVariant;
  padding?: keyof typeof CARD_PAD;
  pop?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "className" | "children">) {
  void _pop;
  return (
    <As className={`relative ${CARD_VARIANT[variant]} ${CARD_PAD[padding]} ${className}`} {...props}>
      {children}
    </As>
  );
}

// ------------------------------------------------------------------ Stats

/**
 * A row of stats with hairline dividers, e.g. Stake / Pot / Players in. A <dl>:
 * put Stat children inside. Three stats get the 1.1 / 1.1 / 0.8 split so the
 * money columns have room.
 */
export function StatRow({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const count = Children.count(children);
  const cols =
    count === 3
      ? "grid-cols-[1.1fr_1.1fr_0.8fr]"
      : count === 2
        ? "grid-cols-2"
        : count === 4
          ? "grid-cols-4"
          : "grid-cols-1";
  return (
    <dl className={`num m-0 grid ${cols} [&>*+*]:border-l [&>*+*]:border-edge [&>*+*]:pl-3 ${className}`}>
      {children}
    </dl>
  );
}

export type StatTone = "default" | "money" | "dusk";

/**
 * One stat: a label and a figure in Figtree, lining and tabular. `money` is
 * gold (stakes, pots, payouts only); `dusk` is a miss or a 0.00. Goes inside a
 * StatRow.
 */
export function Stat({
  label,
  value,
  unit,
  tone = "default",
  size = "md",
}: {
  label: ReactNode;
  value: ReactNode;
  /** Small trailing unit, e.g. "USDC". */
  unit?: string;
  tone?: StatTone;
  size?: "md" | "lg";
}) {
  const tones: Record<StatTone, string> = {
    default: "text-foreground",
    money: "text-gold",
    dusk: "text-dusk",
  };
  const sizes = {
    md: "text-[1.25rem] min-[381px]:text-[1.375rem]",
    lg: "text-[1.375rem] min-[900px]:text-[1.625rem]",
  };
  return (
    <div className="min-w-0">
      <dt className="text-[0.8125rem] leading-tight text-haze">{label}</dt>
      <dd
        className={`num m-0 mt-1 font-semibold leading-[1.1] tracking-[-0.01em] ${sizes[size]} ${tones[tone]}`}
      >
        {value}
        {unit !== undefined ? (
          <small className="text-xs font-medium tracking-normal text-haze"> {unit}</small>
        ) : null}
      </dd>
    </div>
  );
}

// --------------------------------------------------------------- Run card

/**
 * The run card shell (docs/DESIGN.md, "RunCard"): tag and live end time, the
 * run's name, a StatRow, a note, the one action, and small print. Slots only;
 * the caller brings live numbers from lib/commitment.ts and chain reads.
 */
export function RunCard({
  id,
  tag,
  ends,
  title,
  titleAs: Title = "h2",
  stats,
  note,
  action,
  fine,
  children,
  className = "",
}: {
  id?: string;
  /** Usually a <Tag>. */
  tag?: ReactNode;
  /** The live end time, e.g. <>Ends <b>Sun 08:30</b>, in 16h 44m</>. */
  ends?: ReactNode;
  title: ReactNode;
  titleAs?: "h1" | "h2" | "h3";
  /** Usually a <StatRow>. */
  stats?: ReactNode;
  /** A sentence under the stats; <b> inside it reads in the foreground. */
  note?: ReactNode;
  /** The one action, usually a block primary Button or ButtonLink. */
  action?: ReactNode;
  /** Small print under the action. */
  fine?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const titleId = id !== undefined ? `${id}-title` : undefined;
  return (
    <Card
      as="article"
      variant="hero"
      padding="none"
      aria-labelledby={titleId}
      id={id}
      className={`z-[2] px-4 pb-3.5 pt-4 min-[900px]:px-6 min-[900px]:pb-[18px] min-[900px]:pt-[22px] ${className}`}
    >
      {tag !== undefined || ends !== undefined ? (
        <div className="flex items-center justify-between gap-3">
          {tag}
          {ends !== undefined ? (
            <span className="num text-right text-[0.8125rem] text-haze [&_b]:font-semibold [&_b]:text-muted">
              {ends}
            </span>
          ) : null}
        </div>
      ) : null}
      <Title
        id={titleId}
        className="m-0 mt-2.5 text-[1.25rem] font-semibold leading-tight tracking-[-0.01em] min-[900px]:text-[1.375rem]"
      >
        {title}
      </Title>
      {stats !== undefined ? <div className="mt-3 border-t border-edge pt-3">{stats}</div> : null}
      {note !== undefined ? (
        <p className="num m-0 mt-3 text-sm leading-[1.45] text-muted text-pretty [&_b]:font-semibold [&_b]:text-foreground">
          {note}
        </p>
      ) : null}
      {children}
      {action !== undefined ? <div className="mt-3.5">{action}</div> : null}
      {fine !== undefined ? <Fine className="mt-2 text-center">{fine}</Fine> : null}
    </Card>
  );
}

/** Small print: 13px, haze. Test money and beta always go here. */
export function Fine({ className = "", children }: { className?: string; children: ReactNode }) {
  return <p className={`m-0 text-[0.8125rem] leading-[1.45] text-haze ${className}`}>{children}</p>;
}

// ------------------------------------------------------------------ Brand

/** The mark and the wordmark, linking home. */
export function BrandLockup({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label="GoHealthMe home"
      className={`inline-flex min-h-11 flex-none items-center gap-2.5 rounded-control no-underline ${FOCUS_RING} ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mark.svg" width={32} height={32} alt="" className="size-8 flex-none" />
      <span className="type-wordmark text-xl">GoHealthMe</span>
    </Link>
  );
}

// ------------------------------------------------------ Status and errors

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
      className={`inline-flex min-h-10 items-center gap-1.5 break-all text-sm font-semibold text-muted underline decoration-muted/35 underline-offset-4 hover:text-foreground ${FOCUS_RING}`}
    >
      {label}
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none">
        <path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </a>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-surface-raised motion-reduce:animate-none ${className}`}
    />
  );
}

export function PoolCardSkeleton() {
  return (
    <Card variant="flat">
      <Skeleton className="h-6 w-28" />
      <Skeleton className="mt-4 h-6 w-3/4" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    </Card>
  );
}

export function ErrorNote({
  title,
  detail,
  raw,
  onRetry,
  retryLabel = "Try again",
}: {
  title: string;
  detail?: string;
  /**
   * Untouched wallet/contract error text, rendered collapsed behind a
   * "Technical details" summary. Money-path surfaces pass DepositStatus.raw
   * here so a failure that humanizes to a generic line still shows its real
   * cause on screen.
   */
  raw?: string;
  onRetry?: () => void;
  /** Says what the retry does, e.g. "Try the stake again". */
  retryLabel?: string;
}) {
  const showRaw = raw !== undefined && raw !== "" && raw !== detail;
  return (
    <div
      role="alert"
      className="rounded-control bg-danger/[0.08] p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_32%,transparent)]"
    >
      <p className="m-0 text-base font-semibold text-danger">{title}</p>
      {detail !== undefined && detail !== "" ? (
        <p className="m-0 mt-1 break-words text-[0.9375rem] text-muted">{detail}</p>
      ) : null}
      {showRaw ? (
        <details className="mt-2 rounded-lg bg-surface-deep px-3 py-2 shadow-[inset_0_0_0_1px_var(--border)]">
          <summary className="cursor-pointer text-xs font-medium text-haze">Technical details</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-haze">
            {raw}
          </pre>
        </details>
      ) : null}
      {onRetry !== undefined ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * An empty slot: what goes here, and the one action that fills it. SPOTTER
 * sits calmly above it by default (meditate); pass pose={null} for none.
 */
export function EmptyState({
  title,
  detail,
  action,
  pose = "meditate",
  line,
}: {
  title: string;
  detail: string;
  /** The one action that fills this slot. */
  action?: ReactNode;
  /** SPOTTER pose shown above the title. Pass null to render no otter. */
  pose?: SpotterPose | null;
  /** SPOTTER's one line, in his caption box. */
  line?: string;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-10 text-center min-[960px]:py-12">
      {pose !== null ? (
        <Spotter pose={pose} width={96} decorative={line === undefined} className="mb-4" />
      ) : null}
      {line !== undefined ? <SpotterCaption line={line} className="mb-4 max-w-xs text-left" /> : null}
      <p className="type-heading m-0 text-[1.625rem]">{title}</p>
      <p className="m-0 mx-auto mt-2 max-w-md text-base text-muted">{detail}</p>
      {action !== undefined ? <div className="mt-6">{action}</div> : null}
    </Card>
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
    accent: "bg-moonlight/10 text-moonlight",
    muted: "bg-fill-quiet-hover text-muted",
    warning: "bg-fill-quiet text-warning shadow-[inset_0_0_0_1px_var(--border-strong)]",
  };
  return (
    <span
      className={`inline-flex h-[26px] items-center whitespace-nowrap rounded-tag px-2.5 text-[0.8125rem] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The trust-tier badge(s) for a pool's proof policy. A self-reported floor
 * shows a single warning-tone "Self-reported" badge; it is never dressed up as
 * verified. One source of truth so the pool card and the pool detail agree.
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

// --------------------------------------------------------- Honest core

/** A USDC amount, gold, in Figtree with lining tabular figures. */
export function Money({
  usd,
  sign,
  size = "md",
  tone: _tone,
}: {
  /** Whole-USD string with two decimals, exactly as the ledger recorded it. */
  usd: string;
  sign?: "+" | "-";
  size?: "sm" | "md" | "lg" | "xl";
  /** Retired: money is gold on every field now. */
  tone?: "default" | "gold" | "on-dark";
}) {
  void _tone;
  const sizes: Record<string, string> = {
    sm: "text-sm font-semibold",
    md: "text-base font-semibold",
    lg: "text-[1.75rem] font-bold leading-none tracking-[-0.02em]",
    xl: "text-[2.5rem] font-bold leading-none tracking-[-0.02em]",
  };
  return (
    <span className={`num whitespace-nowrap font-sans text-gold ${sizes[size]}`}>
      {sign !== undefined ? sign : ""}
      {usd} <span className="text-[0.8em] font-medium tracking-normal text-haze">USDC</span>
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
  /** The low-trust tier. When true, the badge NEVER reads "Verified". */
  selfReported?: boolean;
}) {
  if (selfReported) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Badge tone="warning">Self-reported</Badge>
        <span className="text-xs text-haze">Unverified, low trust</span>
        {confidence !== undefined ? (
          <span className="text-xs text-haze">{confidence} confidence</span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex h-[26px] items-center gap-1.5 rounded-tag px-2.5 text-[0.8125rem] font-semibold ${
          verified ? "bg-moonlight/10 text-moonlight" : "bg-danger/10 text-danger"
        }`}
      >
        {verified ? "Verified" : "Not verified"}
      </span>
      {confidence !== undefined ? (
        <span className="text-xs text-haze">{confidence} confidence</span>
      ) : null}
    </span>
  );
}

/**
 * A status stamp, e.g. "Paid" on the receipt or "Joined" on the stake card.
 * Sentence case, flat, no rotation. `ink` is for paper; the others sit on the
 * night field. The older `gold` and `accent` tones read as moonlight.
 */
export function Stamp({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "danger" | "gold" | "ink";
}) {
  const tones: Record<string, string> = {
    accent: "bg-moonlight/10 text-moonlight",
    gold: "bg-moonlight/10 text-moonlight",
    danger: "bg-danger/10 text-danger",
    ink: "bg-ink text-paper",
  };
  return (
    <span
      className={`inline-flex h-[26px] items-center rounded-tag px-2.5 text-[0.8125rem] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
