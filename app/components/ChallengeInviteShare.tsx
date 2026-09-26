"use client";

// The CREATOR's inline share for their own challenge pool. A challenge's
// shareable link is its private /c/<token> invite, which the server only hands
// back to the wallet that created the pool (POST /api/challenges/invite-token,
// gated by signature + on-chain creator check). So this is a one-tap reveal:
// the creator clicks, signs once to prove the wallet is theirs, and the real
// Share / Text / Email / Copy row appears - no bounce to another page, and the
// token never renders for anyone who is not the creator.

import { useState } from "react";
import { fetchWithWalletAuth } from "@/lib/client-auth";
import { useWalletAuth } from "@/lib/useWalletAuth";
import ShareChallenge from "@/components/ShareChallenge";
import { FIELD_HINT, Notice } from "@/components/night/kit";
import { buttonClasses } from "@/components/ui";

type Reveal =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; token: string }
  | { kind: "error"; message: string };

export default function ChallengeInviteShare({
  poolId,
  address,
}: {
  poolId: bigint;
  address: string;
}) {
  const requestAuth = useWalletAuth();
  const [state, setState] = useState<Reveal>({ kind: "idle" });

  const reveal = async () => {
    setState({ kind: "loading" });
    try {
      const sent = await fetchWithWalletAuth(
        "/api/challenges/invite-token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, poolId: poolId.toString() }),
        },
        requestAuth,
      );
      const body = (await sent.response.json().catch(() => ({}))) as {
        inviteToken?: string;
        error?: string;
      };
      if (!sent.response.ok) {
        setState({
          kind: "error",
          message:
            body.error ?? `Could not get the link (${sent.response.status}).`,
        });
        return;
      }
      if (typeof body.inviteToken !== "string") {
        setState({ kind: "error", message: "No invite link for this challenge." });
        return;
      }
      setState({ kind: "ready", token: body.inviteToken });
    } catch {
      setState({ kind: "error", message: "Could not reach the server." });
    }
  };

  if (state.kind === "ready") {
    return (
      <ShareChallenge
        token={state.token}
        title="Back me on GoHealthMe"
        message="Back me on this - I've got USDC riding on hitting my goal. Chip in and help me get there:"
        emailSubject="Back me on this"
        shareLabel="Share"
      />
    );
  }

  return (
    <div className="[&>*+*]:mt-2">
      <button
        type="button"
        onClick={() => void reveal()}
        disabled={state.kind === "loading"}
        aria-busy={state.kind === "loading"}
        className={`${buttonClasses({ size: "sm" })}`}
      >
        {state.kind === "loading" ? "Getting your link" : "Get your invite link"}
      </button>
      {state.kind === "error" ? (
        <Notice tone="error" live>
          {state.message}
        </Notice>
      ) : (
        <p className={FIELD_HINT}>
          Shows your private invite link to share by text, email or copy. You sign
          once to prove the wallet is yours. Nothing is charged.
        </p>
      )}
    </div>
  );
}
