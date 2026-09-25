"use client";

/**
 * Unlinking a device. One control, used by the dashboard's streak card and by
 * the Wallet page, so the privacy notice's disconnect promise points at a
 * place every paired player can reach, including players in an active run
 * (the dashboard only mounts the streak card when there is no wearable run).
 *
 * The route existed with no caller once: a WHOOP user had no way to revoke
 * from inside the product while the privacy page said they could. That is a
 * dead end AND a false claim in a compliance-facing document.
 *
 * Junction owns its own link, so the route answers 409 with the page to go to.
 * That is guidance rather than an error and renders as a calm note.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, ErrorNote } from "@/components/ui";
import { disconnectWearable } from "@/lib/wearable-connect";
import { useWalletAuth } from "@/lib/useWalletAuth";

export default function DisconnectDeviceButton({
  address,
  className = "mt-3",
}: {
  address: `0x${string}`;
  className?: string;
}) {
  const requestAuth = useWalletAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setNote(null);
          setError(null);
          setBusy(true);
          void disconnectWearable(address, requestAuth)
            .then(async (guidance) => {
              setNote(guidance);
              if (guidance === null) {
                await queryClient.invalidateQueries({
                  queryKey: ["wearable-progress"],
                });
                await queryClient.invalidateQueries({
                  queryKey: ["wearable-data"],
                });
                await queryClient.invalidateQueries({
                  queryKey: ["wearable-providers"],
                });
              }
            })
            .catch((err: unknown) => {
              setError(
                err instanceof Error
                  ? err.message
                  : "Could not disconnect the device.",
              );
            })
            .finally(() => setBusy(false));
        }}
        className={className}
      >
        {busy ? "Disconnecting" : "Disconnect this device"}
      </Button>
      {note !== null ? (
        <p
          role="status"
          className="mt-3 rounded-xl border border-edge bg-surface p-4 text-sm text-muted"
        >
          {note}
        </p>
      ) : null}
      {error !== null ? (
        <div className="mt-3">
          <ErrorNote
            title="Could not disconnect"
            detail={error}
            onRetry={() => setError(null)}
          />
        </div>
      ) : null}
    </>
  );
}
