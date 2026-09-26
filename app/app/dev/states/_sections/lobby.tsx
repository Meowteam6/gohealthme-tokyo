import { GallerySection, PendingStates, type SectionProps } from "../_kit";

// Lobby, My runs, History states for the dev gallery. The lobby agent replaces PendingStates with
// one <StateFrame name="..."> per state, rendering the real components with
// fixture props (numbers from lib/commitment.ts, never typed). Add "use client"
// here if a state needs local state or event handlers.

export default function LobbyStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <PendingStates
        owner="lobby agent"
        states={["lobby-default", "lobby-empty", "lobby-locked-row", "my-runs-empty", "history-empty"]}
      />
    </GallerySection>
  );
}
