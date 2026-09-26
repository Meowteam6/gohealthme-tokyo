import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState, FOCUS_RING } from "@/components/ui";
import { SpotterFigure } from "@/components/spotter/Spotter";
import type { SpotterPose, StageWidth } from "@/lib/spotter-poses";

// Night Shift pieces for the pages around the run (docs/DESIGN.md): the page
// header, form fields, option cards and the inline notice. The primitives in
// components/ui.tsx stay the source for buttons, cards, chips and stats; this
// file only holds what those pages repeat and ui.tsx does not carry yet.
// Server-safe: no hooks.

/** A single-column page (forms, lists, settings): centred, 736px at most. */
export const PAGE_COLUMN = "mx-auto w-full max-w-[46rem]";

/** The page title: Fraunces, 40px on a phone, 52px from 900px. */
export const PAGE_TITLE = "type-title m-0 break-words text-[2.5rem] min-[900px]:text-[3.25rem]";

/** The line under a page title. */
export const PAGE_LEAD =
  "m-0 mt-3 max-w-[60ch] text-[1.0625rem] leading-[1.5] text-muted text-pretty";

/** A section title outside a card: Fraunces, 26px, 30px from 900px. */
export const SECTION_TITLE = "type-heading m-0 text-[1.625rem] min-[900px]:text-[1.875rem]";

/** A card's own title: Figtree, like "Your night" on the run page. */
export const CARD_TITLE = "m-0 text-lg font-semibold leading-tight text-foreground";

/** A field: the deepest fill, a strong hairline, 52px, radius 14. */
export const FIELD = `block min-h-[52px] w-full rounded-control bg-surface-deep px-4 py-3 text-base text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] outline-none transition-shadow duration-[120ms] placeholder:text-haze focus-visible:shadow-[inset_0_0_0_1.5px_var(--foreground)] disabled:opacity-60 aria-[invalid=true]:shadow-[inset_0_0_0_1.5px_var(--danger)]`;

/** A field's label. */
export const FIELD_LABEL = "mb-2 block text-[0.9375rem] font-semibold text-foreground";

/** The hint under a field. */
export const FIELD_HINT = "m-0 mt-2 text-[0.8125rem] leading-[1.45] text-haze";

/**
 * A choice drawn as a card (radio or checkbox). Selected reads as a lit
 * hairline and a raised field, never a heavy outline.
 */
export function optionCard(selected: boolean, disabled = false): string {
  const base = `relative block w-full rounded-control p-4 text-left transition-[background-color,box-shadow] duration-[120ms] ${FOCUS_RING}`;
  if (disabled) {
    return `${base} cursor-not-allowed bg-fill-quiet text-haze shadow-[inset_0_0_0_1px_var(--border)]`;
  }
  return selected
    ? `${base} bg-surface-raised text-foreground shadow-[inset_0_0_0_1.5px_var(--foreground),0_10px_24px_-16px_color-mix(in_srgb,var(--moonlight)_35%,transparent)]`
    : `${base} bg-fill-quiet text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] hover:bg-fill-quiet-hover`;
}

/** The small round mark on an option card: filled when selected. */
export function OptionMark({ selected, shape = "radio" }: { selected: boolean; shape?: "radio" | "check" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-5 flex-none items-center justify-center ${
        shape === "radio" ? "rounded-full" : "rounded-md"
      } ${
        selected
          ? "bg-accent text-accent-foreground"
          : "shadow-[inset_0_0_0_1.5px_var(--border-strong)]"
      }`}
    >
      {selected ? (
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      ) : null}
    </span>
  );
}

/** A page header: title, lead, and whatever sits under them. */
export function PageHeader({
  title,
  lead,
  children,
  className = "",
}: {
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={className}>
      <h1 className={PAGE_TITLE}>{title}</h1>
      {lead !== undefined ? <p className={PAGE_LEAD}>{lead}</p> : null}
      {children}
    </header>
  );
}

/**
 * The page header with SPOTTER standing on the first card's top edge, the way
 * the run page stands him beside "7 hours" (docs/DESIGN.md: one pose per
 * viewport, on a card's edge, with a contact shadow). The title and lead sit
 * on the left, he stands at the right end of the row, and the card that
 * follows is the floor under his feet. Pass the card as `children`. Pick the
 * pose from the page's state, so an empty page gets its empty pose here and
 * nowhere else.
 */
export function PerchedHeader({
  title,
  lead,
  pose,
  width = [92, 148],
  above,
  below,
  children,
  className = "",
}: {
  title: ReactNode;
  lead?: ReactNode;
  pose: SpotterPose;
  /** SPOTTER's width, [phone, from 900px]. */
  width?: StageWidth;
  /** Anything over the title (a back link, a tag). */
  above?: ReactNode;
  /** Anything under the lead, inside the header (an action, a fine line). */
  below?: ReactNode;
  /** The card he stands on. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {/* The title keeps the full width; he stands beside the lead, so a long
          title never wraps around him. */}
      <header>
        {above !== undefined ? <div className="mb-4">{above}</div> : null}
        <h1 className={PAGE_TITLE}>{title}</h1>
        <div className="flex gap-3 min-[900px]:gap-8">
          <div className="min-w-0 flex-1 self-start pb-5 min-[900px]:pb-8">
            {lead !== undefined ? <p className={PAGE_LEAD}>{lead}</p> : null}
            {below}
          </div>
          <SpotterFigure
            pose={pose}
            width={width}
            decorative
            priority
            className="relative z-[3] -mb-1.5 mr-2 self-end min-[900px]:mr-8"
          />
        </div>
      </header>
      {children}
    </div>
  );
}

/** "< Open runs": the way back, a quiet link with a left chevron. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`-ml-1 inline-flex min-h-11 items-center gap-1.5 pr-2 text-[1.0625rem] font-medium text-muted no-underline hover:text-foreground ${FOCUS_RING}`}
    >
      <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" className="flex-none">
        <path
          d="M10 3.5 5.5 8 10 12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </Link>
  );
}

/**
 * An empty slot with no otter of its own: what goes here and the one action
 * that fills it. Use it under a PerchedHeader or inside a <Perch>, so the one
 * pose on screen stands on this card's edge instead of floating in it.
 */
export function EmptyCard({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return <EmptyState pose={null} title={title} detail={detail} action={action} />;
}

/** A row inside a card: label left, value right, hairline between rows. */
export function DefRow({
  label,
  children,
  className = "",
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-t border-edge py-3 first:border-t-0 first:pt-0 ${className}`}>
      <dt className="text-[0.9375rem] text-haze">{label}</dt>
      <dd className="num m-0 min-w-0 text-right text-[0.9375rem] font-semibold text-foreground">{children}</dd>
    </div>
  );
}

export type NoticeTone = "info" | "limit" | "ok" | "error";

const NOTICE_TONE: Record<NoticeTone, { box: string; icon: string; title: string }> = {
  info: {
    box: "bg-fill-quiet shadow-[inset_0_0_0_1px_var(--border)]",
    icon: "text-haze",
    title: "text-foreground",
  },
  // A limit or a wait: stated plainly, neutral, never alarmed.
  limit: {
    box: "bg-surface-raised shadow-[inset_0_0_0_1px_var(--border-strong)]",
    icon: "text-warning",
    title: "text-warning",
  },
  ok: {
    box: "bg-moonlight/[0.07] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--moonlight)_28%,transparent)]",
    icon: "text-moonlight",
    title: "text-moonlight",
  },
  error: {
    box: "bg-danger/[0.08] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_32%,transparent)]",
    icon: "text-danger",
    title: "text-danger",
  },
};

function NoticeIcon({ tone }: { tone: NoticeTone }) {
  const common = {
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "mt-px size-[18px] flex-none",
    "aria-hidden": true,
  };
  if (tone === "ok") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="7.5" />
        <path d="M6.5 10.2 8.8 12.5 13.5 7.6" />
      </svg>
    );
  }
  if (tone === "limit") {
    return (
      <svg {...common}>
        <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
        <path d="M7 8.5V6.5a3 3 0 0 1 6 0v2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4.5M10 6.4v.1" />
    </svg>
  );
}

/**
 * An inline notice inside a flow: a limit before a stake, a wait, a done
 * step, or an error. One icon, an optional title, the sentence, an optional
 * action. `live` announces it when it appears after an action.
 */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  live = false,
  role,
  className = "",
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  live?: boolean;
  role?: "alert" | "status";
  className?: string;
}) {
  const t = NOTICE_TONE[tone];
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : undefined)}
      aria-live={live ? "polite" : undefined}
      className={`flex gap-3 rounded-control p-3.5 text-[0.9375rem] leading-[1.45] ${t.box} ${className}`}
    >
      <span className={t.icon}>
        <NoticeIcon tone={tone} />
      </span>
      <div className="min-w-0 flex-1">
        {title !== undefined ? <p className={`m-0 font-semibold ${t.title}`}>{title}</p> : null}
        {children !== undefined ? (
          <div className={`${title !== undefined ? "mt-1" : ""} text-muted [&_b]:font-semibold [&_b]:text-foreground`}>
            {children}
          </div>
        ) : null}
        {action !== undefined ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

/** An underlined text action with a 44px target, flush with the text column. */
export const QUIET_ACTION = `inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-muted underline decoration-muted/35 underline-offset-4 hover:text-foreground disabled:text-haze disabled:no-underline ${FOCUS_RING}`;
