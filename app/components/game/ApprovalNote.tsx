"use client";

// The one line at the join that the World ID for Agents step needs (docs/
// WORLD.md, "Who is worse off"): with the payout confirmation on, a verified
// result pays only after the player confirms with World ID, and an achiever
// who never confirms gets the stake back instead of the prize. That limit has
// to be said before the stake, so both staking surfaces render this.
//
// The mode comes from the approval status route, which reports it on every
// answer; the zero goal id has no request, so the read is side-effect free.
// While the mode is loading, failed, or misconfigured, the join itself is held
// (runSlotOf's "checking", "check-failed" and "payouts-paused"), so this note
// only ever renders next to a stake button whose payout rule is known.

import { parseApprovalMode } from "@/lib/game/lanes";
import { useLaneProbe } from "@/lib/game/useLaneProbe";
import { approvalModeOf, type ApprovalModeView } from "@/lib/game/join-checks";

const ZERO_GOAL = `0x${"0".repeat(64)}`;

export function useApprovalProbe(): { mode: ApprovalModeView; refetch: () => void } {
  const probe = useLaneProbe(
    ["approval-mode"],
    `/api/agent/approval/status?goalId=${ZERO_GOAL}`,
    parseApprovalMode,
  );
  return { mode: approvalModeOf(probe), refetch: probe.refetch };
}

export function useApprovalMode(): ApprovalModeView {
  return useApprovalProbe().mode;
}

export default function ApprovalNote() {
  const mode = useApprovalMode();
  if (mode !== "mock" && mode !== "world") return null;
  return (
    <p className="rounded-lg border-2 border-foreground/15 bg-surface-raised p-3 text-sm">
      SPOTTER will ask you to confirm with World ID before it pays. No
      confirmation, no payout, and your stake is refunded.
      {mode === "mock" ? (
        <span className="mt-1 block text-xs text-muted">
          This deployment uses a mocked World ID check, not a real one.
        </span>
      ) : null}
    </p>
  );
}
