"use client";

// Lane contract (docs/LANES.md): World IDKit prove-human step of character creation.
// The world-idkit lane replaces this file wholesale. The UX lane mounts it and never edits it.

export interface ProveHumanResult {
  nullifierHash: string;
}

export interface ProveHumanProps {
  address: string;
  onVerified: (result: ProveHumanResult) => void;
  onFailed?: (reason: string) => void;
}

export default function ProveHuman(_props: ProveHumanProps) {
  return (
    <div data-lane="world-idkit" data-stub="true">
      Prove-human step is not wired yet.
    </div>
  );
}
