import type { ReactNode } from "react";
import { Button, Card, Fine, Stat, StatRow } from "@/components/ui";
import { Glyph, type GlyphName } from "@/components/run/glyphs";
import type { SoloLine, StakeTermsCopy } from "@/lib/game/run-page";

// The stake card (docs/DESIGN.md, "Stake card states"): the run's numbers, the
// three outcomes, what a hit pays you, the checks that stand between you and
// the stake, and exactly one action. Every limit shows here, before the stake,
// never after it. Pending, failed and joined replace the body in place.
// Presentational and server-safe; JoinPool and PoolDetail feed it live state,
// the state gallery feeds it fixtures.

/** The card itself: the right column on desktop, sticky under the header. */
export function StakeCard({
  children,
  label = "Stake on this challenge",
  id = "stake",
  className = "",
}: {
  children: ReactNode;
  /** Screen-reader name for the card. */
  label?: string;
  id?: string;
  className?: string;
}) {
  return (
    <Card as="section" aria-labelledby={`${id}-h`} id={id} className={className}>
      <h2 id={`${id}-h`} className="sr-only">
        {label}
      </h2>
      {children}
    </Card>
  );
}

/** Stake / Pot / Players in. "Stake" before joining, "You put in" after. */
export function StakeStats({
  joined = false,
  stake,
  pot,
  players,
  stakeLabel,
  potLabel = "Pot",
  className = "",
}: {
  joined?: boolean;
  stake: string;
  pot: string;
  /** Null while the count has not read. */
  players: number | null;
  /** A prize run says "Entry" instead of "Stake". */
  stakeLabel?: string;
  /** A prize run says "Prize pool"; a finished run "Left in pool". */
  potLabel?: string;
  className?: string;
}) {
  return (
    <StatRow className={className}>
      <Stat label={stakeLabel ?? (joined ? "You put in" : "Stake")} value={stake} unit="USDC" />
      <Stat label={potLabel} value={pot} unit="USDC" tone="money" />
      <Stat label="Players in" value={players === null ? "--" : players} />
    </StatRow>
  );
}

/** Hit, miss, nobody hits: the three outcomes, in the run's own numbers. */
export function StakeTerms({ terms, id = "stake-terms" }: { terms: StakeTermsCopy; id?: string }) {
  const rows: { glyph: GlyphName; label: string; body: string }[] = [
    { glyph: "hit", label: terms.hitLabel, body: terms.hit },
    { glyph: "miss", label: "Miss it:", body: terms.miss },
    { glyph: "back", label: "Nobody hits:", body: terms.nobody },
  ];
  return (
    <ul id={id} className="m-0 mt-3.5 grid list-none gap-2.5 border-t border-edge p-0 pt-3.5">
      {rows.map((row) => (
        <li
          key={row.label}
          className="num grid grid-cols-[20px_1fr] gap-2.5 text-[0.9375rem] leading-[1.45] text-muted"
        >
          <Glyph name={row.glyph} className="mt-0.5" />
          <span>
            <b className="font-semibold text-foreground">{row.label}</b> {row.body}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The terms as one line, when the fee did not read and no number can stand. */
export function StakeTermsPlain({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mt-3.5 border-t border-edge pt-3.5 text-[0.9375rem] leading-[1.45] text-muted">
      {children}
    </p>
  );
}

/** The raised line between the terms and the action (the mock's solo box).
 *  Its bold figures keep their own colour; SoloNote makes its payout gold. */
export function StakeLineBox({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`num m-0 mt-3.5 rounded-control bg-gold/[0.08] px-3.5 py-3 text-[0.9375rem] leading-[1.4] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--gold)_18%,transparent)] ${className}`}
    >
      {children}
    </p>
  );
}

/** What a hit pays the player about to join, in gold where it is money. */
export function SoloNote({ line }: { line: SoloLine }) {
  return (
    <StakeLineBox className="[&_b]:font-bold [&_b]:text-gold">
      {line.kind === "first" ? (
        <>
          Nobody&apos;s in yet. Hit it alone and <b>{line.total}</b> comes back: your {line.stake}
          {line.pot !== null ? ` plus the ${line.pot} extra in the pot.` : "."}
        </>
      ) : line.kind === "flat" ? (
        <>
          {line.players} {line.players === 1 ? "player is" : "players are"} in. Hit it and{" "}
          <b>{line.total}</b> comes back, however many hit.
        </>
      ) : (
        <>
          {line.players} {line.players === 1 ? "player is" : "players are"} in. Hit it and{" "}
          <b>{line.low}</b> comes back if everyone hits, up to <b>{line.high}</b> if only you do.
        </>
      )}
    </StakeLineBox>
  );
}

export interface StakeCheck {
  key: string;
  /** ok: cleared. lock: stands between you and the stake. wallet, info: a fact. */
  glyph: "ok" | "lock" | "wallet" | "info";
  children: ReactNode;
}

/** The checks between the player and the stake, each with its glyph. */
export function StakeChecks({ items }: { items: StakeCheck[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-0 mt-3.5 grid list-none gap-2 p-0">
      {items.map((item) => (
        <li
          key={item.key}
          className={`flex items-start gap-2.5 text-sm leading-[1.45] [&_b]:font-semibold [&_b]:text-foreground ${
            item.glyph === "lock" ? "text-foreground" : "text-muted"
          }`}
        >
          <Glyph
            name={item.glyph}
            size={18}
            className={`mt-px ${item.glyph === "ok" ? "" : "text-muted"}`}
          />
          <span className="min-w-0">{item.children}</span>
        </li>
      ))}
    </ul>
  );
}

/** The one action, and the small print under it. */
export function StakeAction({
  id,
  children,
  fine,
}: {
  id?: string;
  children: ReactNode;
  fine?: ReactNode;
}) {
  return (
    <div id={id} className="mt-4">
      {children}
      {fine !== undefined ? <Fine className="mt-2">{fine}</Fine> : null}
    </div>
  );
}

/** Where the money sits. On every stake card, joined or not. */
export function StakeVault() {
  return (
    <p className="m-0 mt-3 flex items-start gap-2.5 text-[0.8125rem] leading-[1.45] text-haze">
      <Glyph name="vault" size={16} className="mt-px text-muted" />
      <span>Your stake sits in the challenge&apos;s contract, not with SPOTTER. He reads the result; the contract pays.</span>
    </p>
  );
}

/** The stake is on its way. Nothing to press. */
export function StakePending({ title, detail }: { title: string; detail: string }) {
  return (
    <div role="status" className="flex items-start gap-3.5">
      <span
        aria-hidden="true"
        className="animate-night-spin mt-0.5 size-[22px] flex-none rounded-full border-[2.5px] border-gold/25 border-t-gold"
      />
      <div className="min-w-0">
        <p className="num m-0 text-[1.0625rem] font-semibold">{title}</p>
        <p className="m-0 mt-1 text-[0.9375rem] text-muted">{detail}</p>
      </div>
    </div>
  );
}

/** The stake did not land. Says what happened, then the one retry. */
export function StakeFailed({
  title,
  detail,
  raw,
  onRetry,
  retryLabel = "Try the stake again",
  children,
}: {
  title: string;
  detail?: string;
  /** The untouched wallet or contract error, behind "Technical details". */
  raw?: string;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}) {
  const showRaw = raw !== undefined && raw !== "" && raw !== detail;
  return (
    <div role="alert">
      <p className="m-0 text-[1.0625rem] font-semibold">{title}</p>
      {detail !== undefined && detail !== "" ? (
        <p className="m-0 mt-1 break-words text-[0.9375rem] text-muted">{detail}</p>
      ) : null}
      {showRaw ? (
        <details className="mt-3 rounded-lg bg-surface-deep px-3 py-2 shadow-[inset_0_0_0_1px_var(--border)]">
          <summary className="min-h-8 cursor-pointer text-xs font-medium text-haze">Technical details</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-haze">
            {raw}
          </pre>
        </details>
      ) : null}
      {onRetry !== undefined ? (
        <Button block onClick={onRetry} className="mt-3.5">
          {retryLabel}
        </Button>
      ) : null}
      {children}
    </div>
  );
}
