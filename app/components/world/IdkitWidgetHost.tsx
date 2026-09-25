"use client";

// The one file that imports @worldcoin/idkit. ProveHuman loads it through
// next/dynamic with ssr: false, because the SDK's core resolves its WASM via
// `new URL("idkit_wasm_bg.wasm", import.meta.url)` and has no business in a
// server render. Props are the subset of IDKitRequestWidgetProps this product
// uses, verified against @worldcoin/idkit 4.3.0's index.d.ts:
//
//   app_id, action, rp_context (server-signed), environment,
//   allow_legacy_proofs: true (the staging simulator may answer with a v3
//   proof; the server accepts both shapes), preset: proofOfHuman({ signal })
//   (World ID 4.0 proof-of-human with legacy Orb fallback), and the three
//   callbacks. The signal is the wallet address, lowercased, which is what
//   the server checks responses[0].signal_hash against.

import {
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitErrorCodes,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";

export interface IdkitWidgetHostProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: `app_${string}`;
  action: string;
  environment: "staging" | "production";
  rpContext: RpContext;
  /** The wallet address the proof is bound to (lowercased by the host). */
  signalAddress: string;
  /** Called with the payload; throw to make the widget show a failure. */
  handleVerify: (result: IDKitResult) => Promise<void>;
  onSuccess: (result: IDKitResult) => void;
  onError: (code: IDKitErrorCodes) => void;
}

export default function IdkitWidgetHost(props: IdkitWidgetHostProps) {
  return (
    <IDKitRequestWidget
      open={props.open}
      onOpenChange={props.onOpenChange}
      app_id={props.appId}
      action={props.action}
      action_description="Prove you're one human to play a GoHealthMe pool"
      rp_context={props.rpContext}
      environment={props.environment}
      allow_legacy_proofs={true}
      preset={proofOfHuman({ signal: props.signalAddress.toLowerCase() })}
      handleVerify={props.handleVerify}
      onSuccess={props.onSuccess}
      onError={(code) => props.onError(code)}
    />
  );
}
