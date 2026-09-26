"use client";

// The CREATOR's inline share for their own challenge run. A challenge's
// shareable link is its private /c/<token> invite, which the server only hands
// back to the wallet that created the pool (POST /api/challenges/invite-token,
// gated by signature + on-chain creator check). So this is a one-tap reveal:
// the creator clicks, signs once to prove the wallet is theirs, and the real
// Share / Text / Email / Copy rows appear - no bounce to another page, and the
// token never renders for anyone who is not the creator.
//
// One token, two kinds of link (lib/game/money-sharing inviteShareOf):
//   - stake on yourself: "Match my stake" (the accept link, the friend stakes
//     the same amount) and "Back me" (?as=backer, the friend only adds to the
//     pot and is never staked in);
//   - reward challenge: "Send the challenge" (the accept link).
// A stake-on-yourself run whose creator has not locked in yet offers no link,
// and says why.

import { useState } from "react";
import { fetchWithWalletAuth } from "@/lib/client-auth";
import { useWalletAuth } from "@/lib/useWalletAuth";
import ShareChallenge from "@/components/ShareChallenge";
import { FIELD_HINT, Notice } from "@/components/night/kit";
import { buttonClasses } from "@/components/ui";
import { inviteShareOf, type ChallengeRunKind, type ShareLink } from "@/lib/game/money-sharing";

type Reveal =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; token: string }
  | { kind: "error"; message: string };

export default function ChallengeInviteShare({
  poolId,
  address,
  kind,
}: {
  poolId: bigint;
  address: string;
  /** Which flow this run is (lib/game/money-sharing challengeRunKindOf). */
  kind: ChallengeRunKind;
}) {
  const requestAuth = useWalletAuth();
  const [state, setState] = useState<Reveal>({ kind: "idle" });
  const share = inviteShareOf(kind);

  if (share.kind === "blocked") {
    return <p className="m-0 text-[0.9375rem] leading-[1.5] text-muted">{share.reason}</p>;
  }

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

  if (state.kind === "ready") return <InviteLinks links={share.links} token={state.token} />;

  return (
    <div className="[&>*+*]:mt-2">
      <button
        type="button"
        onClick={() => void reveal()}
        disabled={state.kind === "loading"}
        aria-busy={state.kind === "loading"}
        className={`${buttonClasses({ size: "sm" })}`}
      >
        {state.kind === "loading" ? "Getting your links" : share.revealLabel}
      </button>
      {state.kind === "error" ? (
        <Notice tone="error" live>
          {state.message}
        </Notice>
      ) : (
        <p className={FIELD_HINT}>{share.revealHint}</p>
      )}
    </div>
  );
}

/** The revealed links, one row per kind, each named when there are two. */
export function InviteLinks({ links, token }: { links: ShareLink[]; token: string }) {
  const many = links.length > 1;
  return (
    <div className="[&>*+*]:mt-4 [&>*+*]:border-t [&>*+*]:border-edge [&>*+*]:pt-4">
      {links.map((link) => (
        <LinkRow key={link.kind} link={link} token={token} labelled={many} />
      ))}
    </div>
  );
}

/** One kind of link: its name and what the friend lands on, then the row. */
function LinkRow({ link, token, labelled }: { link: ShareLink; token: string; labelled: boolean }) {
  const id = `share-${link.kind}`;
  return (
    <section aria-labelledby={labelled ? id : undefined} className="[&>*+*]:mt-2.5">
      {labelled ? (
        <div>
          <h3 id={id} className="m-0 text-[0.9375rem] font-semibold text-foreground">
            {link.label}
          </h3>
          <p className="m-0 mt-0.5 text-[0.875rem] leading-[1.45] text-muted">{link.detail}</p>
        </div>
      ) : (
        <p className="m-0 text-[0.875rem] leading-[1.45] text-muted">{link.detail}</p>
      )}
      <ShareChallenge
        token={token}
        backer={link.backer}
        title={link.title}
        message={link.message}
        emailSubject={link.emailSubject}
        shareLabel="Share"
      />
    </section>
  );
}
