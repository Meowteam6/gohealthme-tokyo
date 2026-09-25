"use client";

// The live World ID request widget for SPOTTER's payout confirmation
// (WORLD_APPROVAL_MODE=world). Split from HumanApprovalCard so @worldcoin/idkit
// is loaded only when a world-mode request is open; event mode never ships it.
//
// Props come from POST /api/agent/approval/request: the app id, the static
// action (`settle`, registered in the Developer Portal), the signal that binds
// the proof to this one payout (`<goalId>:<attempt>`, checked server-side
// against responses[0].signal_hash), and a server-signed rp_context. The signing key never
// reaches this file. handleVerify hands the untouched IDKitResult to the
// complete route, which re-verifies it at World's endpoint; throwing here is
// what makes the widget show its own error screen and stay retryable.

import { IDKitRequestWidget, proofOfHuman, type IDKitResult } from "@worldcoin/idkit";
import type { OpenApprovalRequest } from "@/lib/world/approval-client";

export interface WorldApprovalWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: OpenApprovalRequest & { world: NonNullable<OpenApprovalRequest["world"]> };
  /** Must reject (throw) when the server refuses the proof. */
  onVerify: (result: IDKitResult) => Promise<void>;
  onSuccess: () => void;
  onError: (message: string) => void;
}

export default function WorldApprovalWidget(props: WorldApprovalWidgetProps) {
  const { world } = props.request;
  return (
    <IDKitRequestWidget
      open={props.open}
      onOpenChange={props.onOpenChange}
      app_id={world.appId}
      action={props.request.action}
      action_description="Confirm your GoHealthMe payout with SPOTTER"
      rp_context={world.rpContext}
      environment={world.environment}
      allow_legacy_proofs={world.allowLegacyProofs}
      preset={proofOfHuman({ signal: props.request.signal })}
      handleVerify={props.onVerify}
      onSuccess={props.onSuccess}
      onError={(code) => props.onError(`World ID could not complete the check (${String(code)}).`)}
    />
  );
}
