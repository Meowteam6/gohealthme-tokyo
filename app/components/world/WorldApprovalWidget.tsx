"use client";

// The live World ID request widget for SPOTTER's payout confirmation
// (WORLD_APPROVAL_MODE=world). Split from HumanApprovalCard so @worldcoin/idkit
// is loaded only when a world-mode request is open; event mode never ships it.
//
// Props come from POST /api/agent/approval/request: the app id, the static
// action (`settle`, registered in the Developer Portal), the signal that binds
// the proof to this one payout (`<goalId>:<attempt>`, checked server-side
// against responses[0].signal_hash), and a server-signed rp_context. The
// signing key never reaches this file. The credential request is the same one
// prove-human uses (lib/world/credentials.ts): any World ID 4.0 credential,
// Orb not required, with a 3.0 fallback stage. handleVerify hands the
// untouched IDKitResult to the complete route, which re-verifies it at World's
// endpoint; throwing here is what makes the widget show its own error screen
// and stay retryable.

import { IDKitRequestWidget, type IDKitResult } from "@worldcoin/idkit";
import type { OpenApprovalRequest } from "@/lib/world/approval-client";
import {
  worldCredentialRequest,
  type WorldRequestStage,
} from "@/lib/world/credentials";

export interface WorldApprovalWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: OpenApprovalRequest & { world: NonNullable<OpenApprovalRequest["world"]> };
  /** "v4" first; "legacy" only after World App said 4.0 is not available. */
  stage: WorldRequestStage;
  /** Must reject (throw) when the server refuses the proof. */
  onVerify: (result: IDKitResult) => Promise<void>;
  onSuccess: () => void;
  /** The raw IDKit error code; the card decides what to show or retry. */
  onError: (code: string) => void;
}

export default function WorldApprovalWidget(props: WorldApprovalWidgetProps) {
  const { world } = props.request;
  const request = worldCredentialRequest(props.request.signal, props.stage);
  const common = {
    open: props.open,
    onOpenChange: props.onOpenChange,
    app_id: world.appId,
    action: props.request.action,
    action_description: "Confirm your GoHealthMe payout with SPOTTER",
    rp_context: world.rpContext,
    environment: world.environment,
    handleVerify: props.onVerify,
    onSuccess: props.onSuccess,
    onError: (code: unknown) => props.onError(String(code)),
  };
  // A new stage or a fresh rp_context is a new request; remount clean.
  const key = `${request.stage}:${world.rpContext.nonce}`;
  return request.stage === "v4" ? (
    <IDKitRequestWidget
      key={key}
      {...common}
      allow_legacy_proofs={request.allow_legacy_proofs}
      constraints={request.constraints}
    />
  ) : (
    <IDKitRequestWidget
      key={key}
      {...common}
      allow_legacy_proofs={request.allow_legacy_proofs}
      preset={request.preset}
    />
  );
}
