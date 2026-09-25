"use client";

// Lane contract (docs/LANES.md): World ID for Agents boss moment. SPOTTER asks the
// achiever to complete a fresh verification before the protected action (settle / payout).
// The world-agents lane replaces this file wholesale. The UX lane mounts it and never edits it.

export type ApprovalOutcome = "approved" | "declined" | "expired" | "cancelled";

export interface HumanApprovalCardProps {
  goalId: string;
  poolId: string;
  address: string;
  onResult: (outcome: ApprovalOutcome) => void;
}

export default function HumanApprovalCard(_props: HumanApprovalCardProps) {
  return (
    <div data-lane="world-agents" data-stub="true">
      Human approval step is not wired yet.
    </div>
  );
}
