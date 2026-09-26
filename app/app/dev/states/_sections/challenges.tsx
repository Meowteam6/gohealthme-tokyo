import { GallerySection, PendingStates, type SectionProps } from "../_kit";

// Challenges states for the dev gallery. The challenges agent replaces PendingStates with
// one <StateFrame name="..."> per state, rendering the real components with
// fixture props (numbers from lib/commitment.ts, never typed). Add "use client"
// here if a state needs local state or event handlers.

export default function ChallengeStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <PendingStates
        owner="challenges agent"
        states={["challenge-new", "challenge-invite", "challenge-accept", "challenges-empty"]}
      />
    </GallerySection>
  );
}
