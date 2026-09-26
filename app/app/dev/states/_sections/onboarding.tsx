import { GallerySection, PendingStates, type SectionProps } from "../_kit";

// Character creation states for the dev gallery. The onboarding agent replaces PendingStates with
// one <StateFrame name="..."> per state, rendering the real components with
// fixture props (numbers from lib/commitment.ts, never typed). Add "use client"
// here if a state needs local state or event handlers.

export default function OnboardingStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <PendingStates
        owner="onboarding agent"
        states={["character-sign-in", "character-world-id", "character-name", "character-wearable", "character-done"]}
      />
    </GallerySection>
  );
}
