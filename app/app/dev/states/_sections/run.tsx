import { GallerySection, PendingStates, type SectionProps } from "../_kit";

// Run page states for the dev gallery. The run-page agent replaces PendingStates with
// one <StateFrame name="..."> per state, rendering the real components with
// fixture props (numbers from lib/commitment.ts, never typed). Add "use client"
// here if a state needs local state or event handlers.

export default function RunStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <PendingStates
        owner="run-page agent"
        states={["run-guest", "run-sign-in-sheet", "run-code", "run-zero-balance", "run-locked-apple", "run-pending", "run-failed", "run-joined", "run-hold-bar"]}
      />
    </GallerySection>
  );
}
