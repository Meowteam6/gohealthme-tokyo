import { GallerySection, PendingStates, type SectionProps } from "../_kit";

// Landing states for the dev gallery. The landing agent replaces PendingStates with
// one <StateFrame name="..."> per state, rendering the real components with
// fixture props (numbers from lib/commitment.ts, never typed). Add "use client"
// here if a state needs local state or event handlers.

export default function LandingStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <PendingStates
        owner="landing agent"
        states={["landing-default", "landing-wearable-whoop", "landing-wearable-apple", "landing-outcome-miss", "landing-woke", "landing-no-open-runs"]}
      />
    </GallerySection>
  );
}
