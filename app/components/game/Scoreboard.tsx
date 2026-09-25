// The scoreboard: the one bold element on a game screen (docs/DESIGN.md). A
// navy panel, bulb-gold figures for money, chalk for time and nights. Static
// figures only; a payout landing is PayoutMoment's job, not this panel's.

import type { ReactNode } from "react";

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
  return (
    <section
      aria-label={caption}
      className="overflow-hidden rounded-xl border-2 border-board bg-board text-chalk"
    >
      <dl
        className="grid divide-x divide-board-edge"
        style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
      >
        {cells.map((cell) => (
          <div key={cell.label} className="min-w-0 px-3 py-3 sm:px-5 sm:py-4">
            <dt className="text-xs font-semibold text-chalk/70">{cell.label}</dt>
            <dd
              className={`mt-1 truncate font-display text-3xl font-extrabold leading-none tabular-nums sm:text-5xl ${
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
