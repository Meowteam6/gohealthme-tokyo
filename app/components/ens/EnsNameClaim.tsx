"use client";

// Lane contract (docs/LANES.md): pick-your-name step of character creation. Claims
// <label>.gohealthme.eth on ENSv2 Sepolia behind the existing signature-gated handle claim.
// The ens lane replaces this file wholesale. The UX lane mounts it and never edits it.

export interface EnsNameClaimProps {
  address: string;
  currentName: string | null;
  onClaimed: (name: string) => void;
}

export default function EnsNameClaim(_props: EnsNameClaimProps) {
  return (
    <div data-lane="ens" data-stub="true">
      Name claim is not wired yet.
    </div>
  );
}
