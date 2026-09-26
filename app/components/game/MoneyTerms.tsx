// The money flow on every surface that asks for money (docs/MONEY-FLOWS.md,
// section 3): the kind chip, the miss chip, the flow's line and its terms.
// The words come from lib/game/money-flow.ts; this only draws them, so the
// lobby, the run page, the challenge link and the create forms read the same.
// Server-safe: no hooks.
//
// Night Shift: chips are tags, not buttons (nothing to press). A miss that
// goes to the players who hit wears dusk, never red; a stake that comes back
// is quiet. Money figures inside a sentence are gold, as everywhere else.

import type { ReactNode } from "react";
import { Glyph, type GlyphName } from "@/components/run/glyphs";
import { Skeleton } from "@/components/ui";
import type { MissChip, MoneyCopy, MoneyTermKey } from "@/lib/game/money-flow";

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

/**
 * The two chips: what kind of run this is, and what a miss does. `miss` is
 * null while the player count has not read: a placeholder holds the space
 * rather than a guess.
 */
export function MoneyChips({
  kind,
  miss,
  inline = false,
  className = "",
}: {
  kind: string;
  miss: MissChip | null;
  /** Inside a <label> (a radio option): spans, since a list is not allowed there. */
  inline?: boolean;
  className?: string;
}) {
  if (inline) {
    return (
      <span className={`flex flex-wrap gap-1.5 ${className}`}>
        <span className={`${CHIP} bg-fill-quiet text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]`}>
          {kind}
        </span>
        {miss !== null ? <MissTag miss={miss} /> : null}
      </span>
    );
  }
  return (
    <ul aria-label="How the money works" className={`m-0 flex list-none flex-wrap gap-1.5 p-0 ${className}`}>
      <li>
        <span className={`${CHIP} bg-fill-quiet text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]`}>
          {kind}
        </span>
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

// Money figures inside a sentence ("1.00", "1,250.00") go gold. Dates and
// clock times ("16:30") never match: they carry no decimal point.
const FIGURE = /(\d[\d,]*\.\d{2})/;

function withMoney(text: string): ReactNode[] {
  return text.split(FIGURE).map((part, i) =>
    i % 2 === 1 ? (
      <b key={i} className="font-semibold text-gold">
        {part}
      </b>
    ) : (
      part
    ),
  );
}

const GLYPH: Record<MoneyTermKey, GlyphName> = {
  stake: "wallet",
  hit: "hit",
  miss: "miss",
  nobody: "back",
  confirm: "shield",
  match: "info",
  accepted: "info",
};

/** "Hit: 1.00 back ..." -> "Hit:" bold, the rest plain. Only a short lead. */
function splitLead(text: string): { lead: string; rest: string } {
  const cut = text.indexOf(": ");
  if (cut < 0 || cut > 14) return { lead: "", rest: text };
  return { lead: text.slice(0, cut + 1), rest: text.slice(cut + 2) };
}

/**
 * The flow's line and its terms, in the stake card's icon-list form. `line`
 * off renders the terms only (the line already shows above, as a heading).
 */
export function MoneyTermsList({
  copy,
  id,
  line = true,
  className = "",
}: {
  copy: MoneyCopy;
  id?: string;
  line?: boolean;
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
        {copy.terms.map((term) => {
          const { lead, rest } = splitLead(term.text);
          return (
            <li
              key={term.key}
              className="num grid grid-cols-[20px_1fr] gap-2.5 text-[0.9375rem] leading-[1.45] text-muted"
            >
              <span className="flex h-[1.45em] items-center justify-center text-muted" aria-hidden="true">
                <Glyph name={GLYPH[term.key]} size={term.key === "hit" || term.key === "miss" || term.key === "nobody" ? 20 : 16} />
              </span>
              <span>
                {lead !== "" ? <b className="font-semibold text-foreground">{lead}</b> : null}
                {lead !== "" ? " " : null}
                {withMoney(rest)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The flow's line alone, for a card that has no room for the terms. Plain:
 *  the card's own stake and pot figures above it already carry the gold. */
export function MoneyLine({ copy, className = "" }: { copy: MoneyCopy; className?: string }) {
  return <p className={`num m-0 text-sm leading-[1.45] text-muted ${className}`}>{copy.line}</p>;
}

/**
 * Right under the stake button: the miss chip and what a miss does, the last
 * thing read before the money moves.
 */
export function MissUnderStake({ miss, detail }: { miss: MissChip; detail: string | null }) {
  return (
    <p className="num m-0 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.8125rem] leading-[1.45] text-muted">
      <MissTag miss={miss} />
      {detail !== null ? <span>{withMoney(detail)}</span> : null}
    </p>
  );
}
