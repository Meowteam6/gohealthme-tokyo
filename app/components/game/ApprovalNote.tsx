"use client";

// The one line at the join that says how this player's hit is released
// (docs/WORLD.md, "Who is worse off"). With the payout confirmation on, a
// World-verified player's verified result pays only after they confirm with
// World ID, and one who never confirms gets the stake back instead of the
// share. A list player or an admin is paid on the wearable verdict with no
// World ID step (Andre, 2026-10-02), so they are never told otherwise. Said
// before the stake, so both staking surfaces render this.
//
// The mode comes from the approval status route, which reports it on every
// answer; the zero goal id has no request, so the read is side-effect free.
// While the mode is loading, failed, or misconfigured, the join itself is held
// (runSlotOf's "checking", "check-failed" and "payouts-paused"), so this note
// only ever renders next to a stake button whose payout rule is known.

import { Glyph } from "@/components/run/glyphs";
import { parseApprovalMode } from "@/lib/game/lanes";
import { useLaneProbe } from "@/lib/game/useLaneProbe";
import type { HumanProof } from "@/lib/game/character";
import {
  approvalModeOf,
  payoutPathOf,
  type ApprovalModeView,
  type PayoutPath,
} from "@/lib/game/join-checks";
import { openBeta } from "@/lib/open-beta";

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

/** The note's words for this player, or null when there is nothing to say
 *  (the confirmation is off, or the mode is not known yet). In open beta a
 *  wallet that skipped World ID is paid on the verdict and reads that line
 *  (payoutPathOf). */
export function approvalNoteOf(i: {
  approvalMode: ApprovalModeView;
  humanProof: HumanProof | null;
  openBeta?: boolean;
}): { path: PayoutPath; text: string; mocked: boolean } | null {
  if (i.approvalMode !== "mock" && i.approvalMode !== "world") return null;
  const path = payoutPathOf(i);
  if (path === null) return null;
  if (path === "verdict") {
    return {
      path,
      text: "SPOTTER pays your hit on your wearable's verdict, with no extra step.",
      mocked: false,
    };
  }
  return {
    path,
    text: "Before it pays, SPOTTER asks you to confirm with World ID. No confirmation, no payout, and your stake comes back.",
    mocked: i.approvalMode === "mock",
  };
}

export default function ApprovalNote({ humanProof }: { humanProof: HumanProof | null }) {
  const approvalMode = useApprovalMode();
  const note = approvalNoteOf({ approvalMode, humanProof, openBeta: openBeta() });
  if (note === null) return null;
  return (
    <p className="m-0 mt-2 flex items-start gap-2.5 text-sm leading-[1.45] text-muted">
      <Glyph name="shield" size={18} className="mt-px text-muted" />
      <span>
        {note.text}
        {note.mocked ? (
          <span className="mt-0.5 block text-[0.8125rem] text-haze">
            This deployment uses a mocked World ID check, not a real one.
          </span>
        ) : null}
      </span>
    </p>
  );
}
