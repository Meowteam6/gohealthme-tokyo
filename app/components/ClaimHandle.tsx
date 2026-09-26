"use client";

// Claim (or change) the handle for the connected wallet. The write is proven
// by a wallet signature: the SAME wallet client both signs the EIP-191 proof
// and supplies the address that is submitted, so the address that signs is
// always the address claimed. The server recovers the signer and rejects a
// mismatch, so reading the address from one place (the resolved wallet) while
// signing with another (the connector's active account) is what made an
// external wallet's own claim fail. No transaction is sent and nothing is
// charged - the signature only proves the wallet is yours.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  authHeadersOf,
  clientWalletAuthMessage,
  isUserRejection,
} from "@/lib/client-auth";
import { checkEmoji, checkHandle, HANDLE_MAX, EMOJI_MAX } from "@/lib/social";
import { Button, ErrorNote, buttonClasses } from "@/components/ui";
import { FIELD, FIELD_HINT, FIELD_LABEL, Notice } from "@/components/night/kit";
import SignInGate from "@/components/SignInGate";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; handle: string }
  | { kind: "error"; message: string };

function ClaimHandleInner() {
  const { ready, authenticated, address, getArcWalletClient } =
    useEmbeddedWallet();
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState("");
  const [emoji, setEmoji] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const submit = async () => {
    setFormError(null);

    const handleCheck = checkHandle(handle);
    if (!handleCheck.ok) {
      setFormError(handleCheck.reason);
      return;
    }
    const emojiCheck = checkEmoji(emoji);
    if (!emojiCheck.ok) {
      setFormError(emojiCheck.reason);
      return;
    }
    if (address === null) {
      setFormError("Connect your wallet first.");
      return;
    }

    setStatus({ kind: "saving" });

    // Sign the ownership proof and read the claimed address from the SAME
    // wallet client. The signer address (client.account.address) is the one the
    // server recovers from the signature, so submitting exactly that address -
    // rather than a separately resolved wallet address - guarantees the server
    // sees the signature and the claim naming one identical wallet.
    let signerAddress: string;
    let signature: string;
    const timestamp = new Date().toISOString();
    try {
      const walletClient = await getArcWalletClient();
      signerAddress = walletClient.account.address;
      signature = await walletClient.signMessage({
        account: walletClient.account,
        message: clientWalletAuthMessage(signerAddress, timestamp),
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: isUserRejection(err)
          ? "Claiming needs a signature to prove the wallet is yours. Nothing is charged and no transaction is sent."
          : "Your wallet could not sign the proof of ownership. Reconnect it and try again.",
      });
      return;
    }

    try {
      const response = await fetch("/api/social/handle", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeadersOf({ address: signerAddress, timestamp, signature }),
        },
        body: JSON.stringify({
          address: signerAddress,
          handle: handleCheck.handle,
          emoji: emojiCheck.emoji,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setStatus({
          kind: "error",
          message: body.error ?? "Could not save the handle.",
        });
        return;
      }

      // Refresh the header's handle lookup so the wallet chip flips from
      // "Claim a name" to @handle immediately, without waiting for a navigation
      // to refetch the cached resolve.
      await queryClient.invalidateQueries({ queryKey: ["social-resolve"] });
      setStatus({ kind: "done", handle: handleCheck.handle });
    } catch {
      setStatus({
        kind: "error",
        message: "Could not reach the server. Try again.",
      });
    }
  };

  if (status.kind === "done") {
    return (
      <div role="status" className="space-y-3">
        <Notice tone="ok" title={<span className="break-all">Handle claimed as @{status.handle}</span>}>
          Your public page is up. It shows the runs you hit and what they paid,
          never the health goal behind them.
        </Notice>
          <div className="flex flex-wrap gap-2">
            <Link href={`/u/${status.handle}`} className={buttonClasses({ size: "sm" })}>
              View your page
            </Link>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setStatus({ kind: "idle" });
                setHandle("");
                setEmoji("");
              }}
            >
              Change it
            </Button>
          </div>
      </div>
    );
  }

  const saving = status.kind === "saving";

  return (
    <div className="space-y-4">
      <label className="block">
        <span className={FIELD_LABEL}>Handle</span>
        <div className="flex min-h-[52px] items-center rounded-control bg-surface-deep px-3 shadow-[inset_0_0_0_1px_var(--border-strong)] transition-shadow duration-[120ms] focus-within:shadow-[inset_0_0_0_1.5px_var(--foreground)]">
          <span className="text-haze">@</span>
          <input
            type="text"
            value={handle}
            maxLength={HANDLE_MAX}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="ironhabit"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full min-w-0 bg-transparent px-1 py-3 text-base text-foreground outline-none placeholder:text-haze"
          />
        </div>
        <span className={`${FIELD_HINT} block`}>
          Lowercase letters, numbers, and underscores. 3 to {HANDLE_MAX}{" "}
          characters.
        </span>
      </label>

      <label className="block">
        <span className={FIELD_LABEL}>
          Avatar letter <span className="font-normal text-haze">(optional)</span>
        </span>
        <input
          type="text"
          value={emoji}
          maxLength={EMOJI_MAX}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder="a single character"
          className={FIELD}
        />
      </label>

      <SignInGate note="Sign in to claim your handle.">
        {(openSignIn) => (
          <Button
            type="button"
            block
            disabled={!ready || saving}
            onClick={() => {
              if (!authenticated) {
                openSignIn();
                return;
              }
              void submit();
            }}
          >
            {saving
              ? "Signing and saving"
              : authenticated
                ? "Claim handle"
                : "Sign in to claim"}
          </Button>
        )}
      </SignInGate>

      <p className={FIELD_HINT}>
        Claiming signs a message to prove the wallet is yours. Nothing is
        charged and no transaction is sent.
      </p>

      {formError !== null ? (
        <ErrorNote
          title="Check the handle"
          detail={formError}
          onRetry={() => setFormError(null)}
        />
      ) : null}

      {status.kind === "error" ? (
        <ErrorNote
          title="Could not claim the handle"
          detail={status.message}
          onRetry={() => setStatus({ kind: "idle" })}
        />
      ) : null}
    </div>
  );
}

export default function ClaimHandle() {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <ErrorNote
        title="Sign-in is off on this build"
        detail="This part is not switched on for this build yet. Nothing is wrong on your side."
      />
    );
  }
  return <ClaimHandleInner />;
}
