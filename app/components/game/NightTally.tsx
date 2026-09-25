// A row of boxes, one per night the goal needs: filled ink for banked,
// outlined for still to play, struck through for a night that can no longer
// count. The count is always written in words beside it, so it never lives in
// colour alone.

import { tallyWords, type NightTally as Tally } from "@/lib/game/tally";

const SLOT_LABEL = {
  banked: "banked",
  open: "still to play",
  dead: "can no longer count",
} as const;

export default function NightTally({ tally }: { tally: Tally }) {
  return (
    <div>
      <p className="font-display text-2xl font-extrabold leading-none">
        {tallyWords(tally)}
      </p>
      <ol className="mt-3 flex flex-wrap gap-1.5" aria-label={tallyWords(tally)}>
        {tally.slots.map((slot, i) => (
          <li
            key={i}
            aria-label={`Night ${i + 1}: ${SLOT_LABEL[slot]}`}
            className={`relative size-9 rounded-md border-2 sm:size-10 ${
              slot === "banked"
                ? "ghm-stamp border-foreground bg-foreground"
                : slot === "open"
                  ? "border-foreground bg-surface"
                  : "border-edge bg-surface-raised"
            }`}
          >
            {slot === "dead" ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 -rotate-45 bg-muted"
              />
            ) : null}
            {slot === "banked" ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="absolute inset-0 m-auto size-5 text-gold"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
