"use client";

// The quiet "Verify wallet" action, shown where private data is locked for a
// wallet that has not proven itself this session. Pages read that data
// cachedOnly and never open a wallet on load; this is the visible way in.
//
// The explanation comes first and says what the tap will ask for: the one
// session proof where it can run ("once per session"), and a plain free
// signature where it cannot (no promise about the session then). A no is a
// state with a way back, never a loop. On success every wallet-gated read is
// re-read (lib/session-proof.ts), so the data appears without a reload.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { proofLineFor, runVerifyWallet } from "@/lib/session-proof";

export default function VerifyWalletAction({
  lead,
  className = "",
}: {
  /** What is locked, in one short sentence ("Your nights are private to
   *  your wallet."). The proof line follows it. */
  lead: string;
  className?: string;
}) {
  const { address, sessionProofPossible } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const verify = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(
        await runVerifyWallet({
          address,
          requestAuth,
          invalidate: (root) => queryClient.invalidateQueries({ queryKey: [root] }),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`grid justify-items-start gap-3 ${className}`}>
      <p className="m-0 text-[0.9375rem] leading-[1.45] text-muted">
        {lead} {proofLineFor(sessionProofPossible)}
      </p>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy || address === null}
        aria-busy={busy}
        onClick={() => {
          void verify();
        }}
      >
        {busy ? "Waiting for your wallet" : "Verify wallet"}
      </Button>
      {outcome !== null ? (
        <p className="m-0 text-sm leading-[1.45] text-haze" role="status">
          {outcome}
        </p>
      ) : null}
    </div>
  );
}
