"use client";

// The one file prove-human uses to import @worldcoin/idkit. ProveHuman loads
// it through next/dynamic with ssr: false, because the SDK's core resolves its
// WASM via `new URL("idkit_wasm_bg.wasm", import.meta.url)` and has no business
// in a server render. Props are the subset of IDKitRequestWidgetProps this
// product uses, verified against @worldcoin/idkit 4.3.0's index.d.ts:
//
//   app_id, action, rp_context (server-signed), environment, the credential
//   request from lib/world/credentials.ts (the same one SPOTTER's payout
//   confirmation uses: any World ID 4.0 credential, Orb not required, with a
//   3.0 fallback stage), and the three callbacks. The signal is the wallet
//   address, lowercased, which is what the server checks
//   responses[0].signal_hash against.

import {
  IDKitRequestWidget,
  type IDKitErrorCodes,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";
import {
  worldCredentialRequest,
  type WorldRequestStage,
} from "@/lib/world/credentials";

export interface IdkitWidgetHostProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: `app_${string}`;
  action: string;
  environment: "staging" | "production";
  rpContext: RpContext;
  /** The wallet address the proof is bound to (lowercased by the host). */
  signalAddress: string;
  /** "v4" first; "legacy" only after World App said 4.0 is not available. */
  stage: WorldRequestStage;
  /** Called with the payload; throw to make the widget show a failure. */
  handleVerify: (result: IDKitResult) => Promise<void>;
  onSuccess: (result: IDKitResult) => void;
  onError: (code: IDKitErrorCodes) => void;
}

export default function IdkitWidgetHost(props: IdkitWidgetHostProps) {
  const request = worldCredentialRequest(
    props.signalAddress.toLowerCase(),
    props.stage,
  );
  const common = {
    open: props.open,
    onOpenChange: props.onOpenChange,
    app_id: props.appId,
    action: props.action,
    action_description: "Prove you're one human to play a GoHealthMe pool",
    rp_context: props.rpContext,
    environment: props.environment,
    handleVerify: props.handleVerify,
    onSuccess: props.onSuccess,
    onError: (code: IDKitErrorCodes) => props.onError(code),
  };
  // A new stage is a new request (fresh rp_context); remount so the widget
  // starts clean.
  const key = `${request.stage}:${props.rpContext.nonce}`;
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
