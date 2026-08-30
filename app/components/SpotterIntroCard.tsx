import SpotterSays from "@/components/SpotterSays";
import { Card, Money } from "@/components/ui";

// SPOTTER's hero introduction: the otter greeting, a one-line "what it is", and
// the payout amount shown IN-FLOW (never a floating badge that overlaps the
// text). Extracted from the landing hero so it can sit in the right column on
// desktop AND high up - right under the headline - on a phone, from one source.
export default function SpotterIntroCard() {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-6 -z-10 rounded-full bg-accent/20 blur-3xl"
      />
      <Card pop className="otter-float flex flex-col gap-4">
        <SpotterSays surface="agent-header" state="idle" pose="greet" size="md" />
        <div>
          <p className="font-display text-lg font-bold">Meet SPOTTER</p>
          <p className="mt-1 text-sm text-muted">
            The agent that holds the money, checks your proof, and pays you - no
            human in the loop.
          </p>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-gold/40 bg-gold/5 px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            SPOTTER pays you
          </span>
          <Money usd="50.00" sign="+" size="lg" tone="gold" />
        </div>
      </Card>
    </div>
  );
}
