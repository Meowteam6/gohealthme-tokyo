"use client";

// One run as a night card (docs/DESIGN.md, "Open runs"): the name and what it
// is scored on, when it ends and who is in, stake and pot, and one last line
// that says whether you can play it. The landing and the lobby both render
// runs through this, so a run reads the same wherever a visitor meets it.
// The head links to the run page; anything actionable (a lock's fix) goes in
// `footer`, outside that link, so the two are never nested.

import Link from "next/link";
import type { ReactNode } from "react";
import { formatUsdc } from "@/lib/contract";
import { endsAtWords, playersWords, type RunKind } from "@/lib/game/landing";
import { useNowSeconds } from "@/lib/game/useNowSeconds";
import { FOCUS_RING } from "@/components/ui";

export function KindIcon({ kind, className = "" }: { kind: RunKind; className?: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: `flex-none ${className}`,
  };
  switch (kind) {
    case "sleep":
      return (
        <svg {...common}>
          <path d="M10.8 2.2A6 6 0 1 0 13.8 11 5 5 0 0 1 10.8 2.2Z" />
        </svg>
      );
    case "workout":
      return (
        <svg {...common}>
          <path d="M2 8h2M12 8h2M4 5v6M12 5v6M5.5 6.5v3M10.5 6.5v3M5.5 8h5" />
        </svg>
      );
    case "move":
      return (
        <svg {...common}>
          <path d="M5 2.5c1.4 0 2 1.3 2 3s-.7 3-2 3-2-1.2-2-3 .6-3 2-3ZM3.3 10.5h3.4M11 6.5c1.4 0 2 1.3 2 3s-.7 3-2 3-2-1.2-2-3 .6-3 2-3ZM9.3 14h3.4" />
        </svg>
      );
    case "other":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.5" />
        </svg>
      );
  }
}

export function FitIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="flex-none">
      <circle cx="8" cy="8" r="7" className="fill-moonlight/15" />
      <path
        d="M5 8.2 7 10l4-4.2"
        fill="none"
        className="stroke-moonlight"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="flex-none">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The row's last line: whether you can play it, with a check or a lock. */
export function FitLine({
  ok,
  children,
  tone,
}: {
  ok: boolean;
  children: ReactNode;
  /** `in` is the moonlight "You're in"; defaults follow `ok`. */
  tone?: "in";
}) {
  return (
    <p
      className={`m-0 mt-2.5 flex items-center gap-2 border-t border-edge pt-2.5 text-sm ${
        tone === "in" ? "font-semibold text-moonlight" : ok ? "text-foreground" : "text-muted"
      }`}
    >
      <FitIcon ok={ok} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export interface RunRowProps {
  /** The run page. Null renders the head without a link. */
  href: string | null;
  name: string;
  kind: RunKind;
  periodEnd: bigint;
  /** participantCount, or null when not read. */
  players: number | null;
  entryFee: bigint;
  /** pool.balance: every stake plus any sponsor money. */
  balance: bigint;
  /** "Stake" on a commitment run, "Entry" on an older sponsor-funded one. */
  stakeLabel?: string;
  /** A line above the name, e.g. "You were challenged into this run". */
  eyebrow?: ReactNode;
  /** The last line inside the link (a FitLine). */
  fit?: ReactNode;
  /** Below the link: a lock's fix, an entry control. */
  footer?: ReactNode;
  /** Locked rows read quieter; the highlighted row gets a strong hairline. */
  tone?: "default" | "locked" | "highlight";
  /** Replaces the end time, e.g. "Settled" for a closed run. */
  status?: string;
  headingLevel?: "h2" | "h3";
}

export default function RunRow({
  href,
  name,
  kind,
  periodEnd,
  players,
  entryFee,
  balance,
  stakeLabel = "Stake",
  eyebrow,
  fit,
  footer,
  tone = "default",
  status,
  headingLevel: Heading = "h3",
}: RunRowProps) {
  // The end time is the viewer's own clock and zone, so it renders after
  // mount: the server's zone is not the player's.
  const now = useNowSeconds();
  const ends = status ?? (now === null ? null : `Ends ${endsAtWords(periodEnd)}`);
  const who = playersWords(players);

  const head = (
    <>
      {eyebrow !== undefined ? (
        <p className="m-0 mb-1.5 text-[0.8125rem] font-semibold text-moonlight">{eyebrow}</p>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <Heading
          className={`m-0 min-w-0 break-words text-[1.0625rem] font-semibold leading-[1.3] ${
            tone === "locked" ? "text-muted" : "text-foreground"
          }`}
        >
          {name}
        </Heading>
        <KindIcon kind={kind} className="mt-0.5 text-haze" />
      </div>
      <p className="num m-0 mt-1 flex min-h-[1.3rem] flex-wrap gap-x-3.5 gap-y-0.5 text-sm text-haze">
        {ends !== null ? <span>{ends}</span> : null}
        {who !== null ? <span>{who}</span> : null}
      </p>
      <p className="num m-0 mt-2.5 flex gap-5 text-[0.9375rem] text-haze">
        <span>
          {stakeLabel} <b className="font-semibold text-foreground">{formatUsdc(entryFee)}</b>
        </span>
        <span>
          Pot <b className="font-semibold text-gold">{formatUsdc(balance)}</b>
        </span>
        <span className="sr-only">test USDC</span>
      </p>
      {fit}
    </>
  );

  return (
    <article
      className={`group relative h-full rounded-2xl bg-surface transition-[background-color,box-shadow] duration-[120ms] hover:bg-surface-hover ${
        tone === "highlight"
          ? "shadow-[inset_0_0_0_1.5px_var(--moonlight)]"
          : "shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1px_var(--border-strong)]"
      }`}
    >
      {href !== null ? (
        <Link href={href} className={`block rounded-2xl px-4 py-3.5 no-underline ${FOCUS_RING}`}>
          {head}
        </Link>
      ) : (
        <div className="px-4 py-3.5">{head}</div>
      )}
      {footer !== undefined && footer !== null ? <div className="px-4 pb-4">{footer}</div> : null}
    </article>
  );
}
