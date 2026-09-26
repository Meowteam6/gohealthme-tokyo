// Nights as pebbles (docs/DESIGN.md): one per night the goal needs. A banked
// night is a gold pebble, a night still to play is outlined, a night that can
// no longer count is grey. "1 of 2 nights banked" is always written beside
// them, so the count never lives in colour alone.

import { pebbleOf, type Pebble } from "@/lib/game/run-scene";
import { tallyWords, type NightTally as Tally } from "@/lib/game/tally";

const PEBBLE_SHAPE = { borderRadius: "50% 50% 46% 54% / 60% 60% 40% 40%" };

function fillClass(fill: Pebble["fill"], onDark: boolean): string {
  if (fill === "gold") {
    return "border-foreground bg-gold shadow-[inset_-6px_-4px_0_rgba(127,90,0,0.35)]";
  }
  if (fill === "outline") {
    return onDark ? "border-background bg-transparent" : "border-foreground bg-surface";
  }
  return onDark ? "border-background/40 bg-background/15" : "border-edge bg-surface-raised";
}

export default function NightTally({
  tally,
  onDark = false,
}: {
  tally: Tally;
  /** Drawn inside the river-ink night panel. */
  onDark?: boolean;
}) {
  const words = tallyWords(tally);
  return (
    <div>
      <ol className="flex flex-wrap gap-2.5" aria-label={words}>
        {tally.slots.map((slot, i) => {
          const pebble = pebbleOf(slot);
          return (
            <li
              key={i}
              aria-label={`Night ${i + 1}: ${pebble.label}`}
              className={`h-[30px] w-11 border-2 transition-colors duration-150 motion-reduce:transition-none ${fillClass(pebble.fill, onDark)}`}
              style={PEBBLE_SHAPE}
            />
          );
        })}
      </ol>
      <p className={`mt-2 text-base font-bold ${onDark ? "text-background" : "text-foreground"}`}>
        {words}.
      </p>
    </div>
  );
}
