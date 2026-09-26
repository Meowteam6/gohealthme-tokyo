// A run's figures in one row (docs/DESIGN.md, "Stat"): stake, pot, time left,
// with hairline dividers. Money figures are gold, everything else moon. Static
// figures only; a payout landing is PayoutMoment's job.

import type { ReactNode } from "react";
import { Card, Stat, StatRow } from "@/components/ui";

export interface ScoreCell {
  label: string;
  value: ReactNode;
  /** Money figures are gold; everything else is the foreground. */
  tone?: "money" | "chalk";
  /** Small trailing unit ("USDC"). */
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
  return (
    <Card as="section" aria-label={caption} padding="sm">
      <StatRow>
        {cells.map((cell) => (
          <Stat
            key={cell.label}
            label={cell.label}
            value={cell.value}
            unit={cell.unit}
            tone={cell.tone === "money" ? "money" : "default"}
          />
        ))}
      </StatRow>
    </Card>
  );
}
