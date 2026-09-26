// Nights as pebbles (docs/DESIGN.md): one per night the goal needs. A banked
// night is a moonlight pebble (gold is money only), a night still to play is
// outlined, a night that can no longer count is dim. "1 of 2 nights banked" is always written beside
// them, so the count never lives in colour alone.

import { pebbleOf, type Pebble } from "@/lib/game/run-scene";
import { tallyWords, type NightTally as Tally } from "@/lib/game/tally";

const PEBBLE_SHAPE = { borderRadius: "50% 50% 46% 54% / 60% 60% 40% 40%" };

function fillClass(fill: Pebble["fill"]): string {
  if (fill === "gold") return "border-moonlight bg-moonlight";
  if (fill === "outline") return "border-muted/50 bg-transparent";
  return "border-edge bg-fill-quiet";
}

export default function NightTally({
  tally,
  onDark: _onDark,
}: {
  tally: Tally;
  /** Retired: every field is night now. */
  onDark?: boolean;
}) {
  void _onDark;
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
              className={`h-[30px] w-11 border-2 transition-colors duration-150 motion-reduce:transition-none ${fillClass(pebble.fill)}`}
              style={PEBBLE_SHAPE}
            />
          );
        })}
      </ol>
      <p className="mt-2 text-base font-semibold text-foreground">
        {words}.
      </p>
    </div>
  );
}
