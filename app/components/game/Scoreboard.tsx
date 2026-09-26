// A run's figures on the riverbank (docs/DESIGN.md): stake, pot, time left,
// on one cream row. Money figures are deep gold, everything else river ink.
// The navy scoreboard panel this replaced is cut; the cells and their data are
// the same. Static figures only; a payout landing is PayoutMoment's job.

import type { CSSProperties, ReactNode } from "react";

export interface ScoreCell {
  label: string;
  value: ReactNode;
  /** Money figures are gold (deep gold on cream); everything else is ink. */
  tone?: "money" | "chalk";
  /** Small line under the figure ("USDC", "left"). */
  unit?: string;
}

export default function Scoreboard({
  cells,
  caption,
}: {
  cells: ScoreCell[];
  /** Screen-reader summary of the row, e.g. the run name. */
  caption: string;
}) {
  // Below `sm` the cells wrap to two columns (a lone last cell spans both) so
  // a money figure like 1,240.00 never truncates at 360px; from `sm` up every
  // cell shares one row. Hairlines are the gap over the border colour, so
  // they stay right however the cells wrap.
  const columns = {
    "--score-cols": `repeat(${cells.length}, minmax(0, 1fr))`,
  } as CSSProperties;
  return (
    <section
      aria-label={caption}
      className="overflow-hidden rounded-3xl border border-edge bg-edge"
    >
      <dl
        className="grid grid-cols-2 gap-px sm:[grid-template-columns:var(--score-cols)]"
        style={columns}
      >
        {cells.map((cell, index) => (
          <div
            key={cell.label}
            className={`min-w-0 bg-surface px-4 py-3 sm:col-span-1 sm:px-5 sm:py-4 ${
              cells.length % 2 === 1 && index === cells.length - 1 ? "col-span-2" : ""
            }`}
          >
            <dt className="text-sm text-muted">{cell.label}</dt>
            <dd
              className={`mt-1 truncate font-display text-[1.75rem] font-extrabold leading-display tracking-display tabular-nums ${
                cell.tone === "money" ? "text-gold-deep" : "text-foreground"
              }`}
            >
              {cell.value}
            </dd>
            {cell.unit !== undefined ? (
              <dd className="mt-1 text-xs text-muted">{cell.unit}</dd>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
