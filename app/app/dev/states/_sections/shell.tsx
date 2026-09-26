import { GallerySection, PendingStates, type SectionProps } from "../_kit";

// Shell states for the dev gallery. The shell agent replaces PendingStates with
// one <StateFrame name="..."> per state, rendering the real components with
// fixture props (numbers from lib/commitment.ts, never typed). Add "use client"
// here if a state needs local state or event handlers.

export default function ShellStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <PendingStates
        owner="shell agent"
        states={["header-signed-out", "header-signed-in", "header-outage", "footer", "dynamic-modal"]}
      />
    </GallerySection>
  );
}
