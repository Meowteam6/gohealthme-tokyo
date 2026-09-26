// The money flow on every surface that asks for money (docs/MONEY-FLOWS.md,
// section 3): the kind chip, the miss chip, the flow's line and its terms.
// The words come from lib/game/money-flow.ts; this only draws them, so the
// lobby, the run page, the challenge link and the create forms read the same.
// Server-safe: no hooks.
//
// Night Shift: chips are tags, not buttons (nothing to press). A miss that
// goes to the players who hit wears dusk, never red; a stake that comes back
// is quiet. Money figures inside a sentence are bold foreground, as on the
// landing card and the lobby rows; gold is for the Pot stat and the one
// payout figure (what a hit pays, in the hit term).

import type { ReactNode } from "react";
import { Glyph, type GlyphName } from "@/components/run/glyphs";
import { Skeleton } from "@/components/ui";
import { StakeLineBox } from "@/components/run/StakeCard";
import type { MissChip } from "@/lib/commitment-copy";
import type { MoneyCopy, MoneyTermKey } from "@/lib/game/money-flow";

const CHIP =
  "inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-tag px-2.5 text-[0.8125rem] font-semibold";

/** "Miss: stake back" is quiet; "Miss: goes to who hits" is the one to see. */
export function MissTag({ miss }: { miss: MissChip }) {
  const atRisk = miss === "Miss: goes to who hits";
  return (
    <span
      className={`${CHIP} ${
        atRisk
          ? "bg-surface-raised text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--dusk)_70%,transparent)]"
          : "bg-fill-quiet text-muted shadow-[inset_0_0_0_1px_var(--border)]"
      }`}
    >
      <Glyph name={atRisk ? "miss" : "back"} size={14} />
      {miss}
    </span>
  );
}

const KIND_CHIP = `${CHIP} bg-fill-quiet text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]`;

/** The kind chip alone ("Challenge from @nikki", "Sponsored by ..."), beside
 *  the run page's tag; a placeholder holds its space while the flow reads. */
export function KindTag({ kind }: { kind: string | null }) {
  if (kind !== null) return <span className={KIND_CHIP}>{kind}</span>;
  return (
    <span aria-busy="true" className="inline-flex">
      <span className="sr-only">Reading what kind of challenge this is</span>
      <Skeleton className="h-[26px] w-[104px] rounded-tag" />
    </span>
  );
}

/**
 * The two chips: what kind of run this is, and what a miss does. Either is
 * null while its read is out (`kind` on a challenge until the seed and the
 * creator's stake read, `miss` until the player count does): a placeholder
 * holds the space rather than a guess.
 */
export function MoneyChips({
  kind,
  miss,
  inline = false,
  className = "",
}: {
  kind: string | null;
  miss: MissChip | null;
  /** Inside a <label> (a radio option): spans, since a list is not allowed there. */
  inline?: boolean;
  className?: string;
}) {
  if (inline) {
    return (
      <span className={`flex flex-wrap gap-1.5 ${className}`}>
        {kind !== null ? <span className={KIND_CHIP}>{kind}</span> : null}
        {miss !== null ? <MissTag miss={miss} /> : null}
      </span>
    );
  }
  return (
    <ul aria-label="How the money works" className={`m-0 flex list-none flex-wrap gap-1.5 p-0 ${className}`}>
      <li aria-busy={kind === null ? true : undefined}>
        {kind !== null ? (
          <span className={KIND_CHIP}>{kind}</span>
        ) : (
          <>
            <span className="sr-only">Reading what kind of challenge this is</span>
            <Skeleton className="h-[26px] w-[104px] rounded-tag" />
          </>
        )}
      </li>
      <li aria-busy={miss === null ? true : undefined}>
        {miss !== null ? (
          <MissTag miss={miss} />
        ) : (
          <>
            <span className="sr-only">Reading who is in</span>
            <Skeleton className="h-[26px] w-[132px] rounded-tag" />
          </>
        )}
      </li>
    </ul>
  );
}

// Money figures inside a sentence ("1.00", "1,250.00"). Dates and clock
// times ("16:30") never match: they carry no decimal point.
const FIGURE = /(\d[\d,]*\.\d{2})/;

/** Figures bold in the foreground. With `payout` "hit" (a hit term, whose
 *  first figure is always the stake), a later figure that is not the stake is
 *  what the hit pays, and only that goes gold: "1.00 back + a share, 3.00
 *  right now". "Can be under 1.00" stays foreground. With "total" (a row of
 *  the equal-stakes table, "... + the other 10.00, 20.00 in all"), only the
 *  last figure is paid out, and only when the row names parts before it. */
function withMoney(text: string, payout: "hit" | "total" | null = null): ReactNode[] {
  let stake: string | null = null;
  const parts = text.split(FIGURE);
  const figures = Math.floor(parts.length / 2);
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const paid =
      payout === "hit"
        ? stake !== null && part !== stake
        : payout === "total"
          ? figures > 1 && i === parts.length - 2
          : false;
    if (stake === null) stake = part;
    return (
      <b key={i} className={`font-semibold ${paid ? "text-gold" : "text-foreground"}`}>
        {part}
      </b>
    );
  });
}

const GLYPH: Record<MoneyTermKey, GlyphName> = {
  stake: "wallet",
  hit: "hit",
  split: "hit",
  both: "hit",
  miss: "miss",
  nobody: "back",
  confirm: "shield",
  match: "info",
  accepted: "info",
};

/** "Hit: 1.00 back ..." -> "Hit:" bold, the rest plain. Only a short lead,
 *  up to "One hits, one misses:". */
function splitLead(text: string): { lead: string; rest: string } {
  const cut = text.indexOf(": ");
  if (cut < 0 || cut > 20) return { lead: "", rest: text };
  return { lead: text.slice(0, cut + 1), rest: text.slice(cut + 2) };
}

/**
 * The flow's line and its terms, in the stake card's icon-list form. `line`
 * off renders the terms only (the stake card boxes the line above its action,
 * MoneyLineBox); `skip` leaves out terms the card already shows (the stake,
 * which the stat row carries).
 */
export function MoneyTermsList({
  copy,
  id,
  line = true,
  skip = [],
  className = "",
}: {
  copy: MoneyCopy;
  id?: string;
  line?: boolean;
  skip?: readonly MoneyTermKey[];
  className?: string;
}) {
  return (
    <div className={className}>
      {line ? (
        <p className="num m-0 text-[0.9375rem] font-semibold leading-[1.45] text-foreground">
          {withMoney(copy.line)}
        </p>
      ) : null}
      <ul id={id} className={`m-0 grid list-none gap-2.5 p-0 ${line ? "mt-3" : ""}`}>
        {copy.terms.filter((term) => !skip.includes(term.key)).map((term) => {
          const { lead, rest } = splitLead(term.text);
          return (
            <li
              key={term.key}
              className="num grid grid-cols-[20px_1fr] gap-2.5 text-[0.9375rem] leading-[1.45] text-muted"
            >
              <span className="flex h-[1.45em] items-center justify-center text-muted" aria-hidden="true">
                <Glyph
                  name={GLYPH[term.key]}
                  size={
                    term.key === "hit" ||
                    term.key === "split" ||
                    term.key === "both" ||
                    term.key === "miss" ||
                    term.key === "nobody"
                      ? 20
                      : 16
                  }
                />
              </span>
              <span>
                {lead !== "" ? <b className="font-semibold text-foreground">{lead}</b> : null}
                {lead !== "" ? " " : null}
                {withMoney(
                  rest,
                  term.key === "hit" ? "hit" : term.key === "split" || term.key === "both" ? "total" : null,
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The flow's line in the stake card's raised box, between the terms and the
 *  action, where the approved mock puts the worked line. */
export function MoneyLineBox({ copy }: { copy: MoneyCopy }) {
  return <StakeLineBox>{withMoney(copy.line)}</StakeLineBox>;
}

/** The flow's line alone, for a card that has no room for the terms. Plain:
 *  the card's own stake and pot figures above it already carry the gold. */
export function MoneyLine({ copy, className = "" }: { copy: MoneyCopy; className?: string }) {
  return <p className={`num m-0 text-sm leading-[1.45] text-muted ${className}`}>{copy.line}</p>;
}

/**
 * Right under the stake button: the miss chip, the last thing read before the
 * money moves. `detail` adds what a miss does, for a surface whose terms do
 * not already say it; the run page and the challenge link pass null, since
 * their Miss term is right above.
 */
export function MissUnderStake({ miss, detail }: { miss: MissChip; detail: string | null }) {
  return (
    <p className="num m-0 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.8125rem] leading-[1.45] text-muted">
      <MissTag miss={miss} />
      {detail !== null ? <span>{withMoney(detail)}</span> : null}
    </p>
  );
}
