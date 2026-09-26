import { GallerySection, PendingStates, type SectionProps } from "../_kit";

// Verdict states for the dev gallery. The verdict agent replaces PendingStates with
// one <StateFrame name="..."> per state, rendering the real components with
// fixture props (numbers from lib/commitment.ts, never typed). Add "use client"
// here if a state needs local state or event handlers.

export default function VerdictStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <PendingStates
        owner="verdict agent"
        states={["verdict-confirm", "verdict-paid", "verdict-denied", "verdict-expired", "verdict-lost", "verdict-refund"]}
      />
    </GallerySection>
  );
}
