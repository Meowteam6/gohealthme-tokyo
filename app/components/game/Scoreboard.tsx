// The scoreboard: the one bold element on a game screen (docs/DESIGN.md). A
// navy panel, bulb-gold figures for money, chalk for time and nights. Static
// figures only; a payout landing is PayoutMoment's job, not this panel's.

import type { CSSProperties, ReactNode } from "react";

export interface ScoreCell {
  label: string;
  value: ReactNode;
  /** Money figures glow bulb gold; everything else is chalk. */
  tone?: "money" | "chalk";
  /** Small line under the figure ("USDC", "left"). */
  unit?: string;
}

export default function Scoreboard({
  cells,
  caption,
}: {
  cells: ScoreCell[];
  /** Screen-reader summary of the board, e.g. the run name. */
  caption: string;
}) {
  // At phone width (390px) four cells in one row left ~64px per figure, and a
  // money value like 1,240.00 truncated. Below `sm` the board wraps to two
  // columns (a lone last cell spans both); from `sm` up every cell shares one
  // row. The hairlines come from the gap over the edge colour, so they stay
  // right however the cells wrap.
  const columns = {
    "--score-cols": `repeat(${cells.length}, minmax(0, 1fr))`,
  } as CSSProperties;
  return (
    <section
      aria-label={caption}
      className="overflow-hidden rounded-xl border-2 border-board bg-board-edge text-chalk"
    >
      <dl
        className="grid grid-cols-2 gap-px sm:[grid-template-columns:var(--score-cols)]"
        style={columns}
      >
        {cells.map((cell, index) => (
          <div
            key={cell.label}
            className={`min-w-0 bg-board px-3 py-3 sm:col-span-1 sm:px-5 sm:py-4 ${
              cells.length % 2 === 1 && index === cells.length - 1 ? "col-span-2" : ""
            }`}
          >
            <dt className="text-xs font-semibold text-chalk/70">{cell.label}</dt>
            <dd
              className={`mt-1 truncate font-display text-3xl font-extrabold leading-none tabular-nums sm:text-4xl ${
                cell.tone === "money" ? "text-gold" : "text-chalk"
              }`}
            >
              {cell.value}
            </dd>
            {cell.unit !== undefined ? (
              <dd className="mt-1 text-xs text-chalk/70">{cell.unit}</dd>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
