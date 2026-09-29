// Whether the World ID payout confirmation can run on this deployment, as one
// answer for the status route and for server-rendered pages. A mode that is
// switched on but cannot run (a bad value, mock refused on production, live
// credentials missing) is "misconfigured": approvalGate would throw at record
// time, so no win could pay. The cause goes to the log, never to a player.
// While KILL_WORLD_ID is thrown the mode is "off" (approval-provider.ts), never
// "misconfigured": a deliberate pause turns the confirmation off, it does not
// hold payouts.

import {
  approvalMode,
  approvalProviderFor,
  type ApprovalMode,
} from "@/lib/server/agent/approval-provider";
import { errorMessage } from "@/lib/server/http";

export type ApprovalModeStatus = ApprovalMode | "misconfigured";

export function approvalModeStatus(logPrefix = "approval-mode"): ApprovalModeStatus {
  try {
    const mode = approvalMode();
    // Build the provider too: world mode with its credentials missing parses
    // fine and only throws the moment SPOTTER needs it.
    if (mode !== "off") approvalProviderFor(mode);
    return mode;
  } catch (err) {
    console.error(`[${logPrefix}] human confirmation misconfigured: ${errorMessage(err)}`);
    return "misconfigured";
  }
}
