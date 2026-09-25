"use client";

// Lane contract (docs/LANES.md): pick-your-name step of character creation.
// Claims <label>.gohealthme.eth on ENSv2 Sepolia behind the same
// signature-gated write as the handle claim. The UX lane mounts it and never
// edits it.
//
// Flow: type a label -> availability is checked live (pure rule first, then
// the registry on Sepolia) -> sign the ownership message with the connected
// wallet (no transaction, nothing charged) -> POST /api/ens/claim mints the
// subname from GoHealthMe's owner key -> the Sepolia tx link shows -> the
// component polls GET /api/ens/resolve until the name resolves back to the
// wallet, and only then calls onClaimed. A name that cannot be minted is
// refused at the input, before any wallet prompt.

import { useEffect, useRef, useState } from "react";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  authHeadersOf,
  clientWalletAuthMessage,
  isUserRejection,
} from "@/lib/client-auth";
import {
  ENS_LABEL_MAX,
  checkEnsLabel,
  ensAppUrl,
  sepoliaTxUrl,
} from "@/lib/ens/names";
import { forgetName, rememberName } from "@/lib/ens/client-cache";
import { ErrorNote } from "@/components/ui";
import SignInGate from "@/components/SignInGate";

export interface EnsNameClaimProps {
  address: string;
  currentName: string | null;
  onClaimed: (name: string) => void;
}

type Availability =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; name: string }
  | { kind: "unavailable"; reason: string };

type Status =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "minting" }
  | { kind: "confirming"; name: string; tx: string | null; polls: number }
  | { kind: "done"; name: string; tx: string | null }
  | { kind: "error"; message: string };

const POLL_MS = 3_000;
const MAX_POLLS = 40;

export default function EnsNameClaim({ address, currentName, onClaimed }: EnsNameClaimProps) {
  const { ready, authenticated, getArcWalletClient } = useEmbeddedWallet();
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [editing, setEditing] = useState(currentName === null);
  const checkSeq = useRef(0);

  // Live availability: the pure rule answers during render and stops the
  // request for anything that could never be minted; the registry answers the
  // rest, keyed by the label it was asked about so a stale answer never shows.
  const localCheck = checkEnsLabel(label);
  const [remote, setRemote] = useState<{ label: string; result: Availability } | null>(null);

  useEffect(() => {
    const seq = ++checkSeq.current;
    const check = checkEnsLabel(label);
    if (!check.ok) return;
    const timer = setTimeout(async () => {
      let result: Availability;
      try {
        const response = await fetch(
          `/api/ens/available?label=${encodeURIComponent(check.label)}`,
        );
        const body = (await response.json()) as {
          available?: boolean;
          reason?: string;
          name?: string;
        };
        result =
          body.available === true && typeof body.name === "string"
            ? { kind: "available", name: body.name }
            : {
                kind: "unavailable",
                reason: body.reason ?? "That name cannot be claimed right now.",
              };
      } catch {
        result = {
          kind: "unavailable",
          reason: "Could not reach the server to check the name.",
        };
      }
      if (seq === checkSeq.current) setRemote({ label, result });
    }, 350);
    return () => clearTimeout(timer);
  }, [label]);

  const availability: Availability =
    label.trim() === ""
      ? { kind: "idle" }
      : !localCheck.ok
        ? { kind: "unavailable", reason: localCheck.reason }
        : remote !== null && remote.label === label
          ? remote.result
          : { kind: "checking" };

  // After the mint: poll real resolution until the name points at the wallet.
  useEffect(() => {
    if (status.kind !== "confirming") return;
    const { name, tx, polls } = status;
    const timer = setTimeout(async () => {
      if (polls >= MAX_POLLS) {
        setStatus({
          kind: "error",
          message:
            "The name was minted but has not resolved yet. Sepolia can be slow; reload in a minute.",
        });
        return;
      }
      try {
        const response = await fetch(
          `/api/ens/resolve?address=${encodeURIComponent(address)}`,
        );
        const body = (await response.json()) as { name?: string | null };
        if (body.name === name) {
          rememberName(address, name);
          setStatus({ kind: "done", name, tx });
          onClaimed(name);
          return;
        }
      } catch {
        // Poll again.
      }
      setStatus({ kind: "confirming", name, tx, polls: polls + 1 });
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [status, address, onClaimed]);

  const submit = async () => {
    if (availability.kind !== "available") return;
    const check = checkEnsLabel(label);
    if (!check.ok) return;

    setStatus({ kind: "signing" });
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
          ? "Claiming needs a signature to prove the wallet is yours. Nothing is charged and no transaction is sent from your wallet."
          : "Your wallet could not sign the proof of ownership. Reconnect it and try again.",
      });
      return;
    }
    if (signerAddress.toLowerCase() !== address.toLowerCase()) {
      setStatus({
        kind: "error",
        message: "The connected wallet is not the one this character belongs to. Switch wallets and try again.",
      });
      return;
    }

    setStatus({ kind: "minting" });
    try {
      const response = await fetch("/api/ens/claim", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeadersOf({ address: signerAddress, timestamp, signature }),
        },
        body: JSON.stringify({ address: signerAddress, label: check.label }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        name?: string;
        tx?: string | null;
        error?: string;
      };
      if (!response.ok || typeof body.name !== "string") {
        setStatus({
          kind: "error",
          message: body.error ?? "Could not mint the name.",
        });
        return;
      }
      forgetName(address);
      setStatus({ kind: "confirming", name: body.name, tx: body.tx ?? null, polls: 0 });
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server. Try again." });
    }
  };

  if (status.kind === "done" || (!editing && currentName !== null)) {
    const name = status.kind === "done" ? status.name : (currentName as string);
    const tx = status.kind === "done" ? status.tx : null;
    return (
      <div
        data-lane="ens"
        className="space-y-3 rounded-2xl border border-accent/40 bg-accent/20 p-5"
      >
        <p className="text-base font-semibold text-accent-deep">You are {name}</p>
        <p className="text-sm text-foreground/80">
          Resolves on ENSv2 Sepolia to this wallet. The name is yours: the
          token sits in your wallet and any ENS client can look it up.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <a
            href={ensAppUrl(name)}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-edge px-4 py-2 font-medium text-foreground hover:bg-surface-raised"
          >
            View on the ENS app
          </a>
          {tx !== null ? (
            <a
              href={sepoliaTxUrl(tx)}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-edge px-4 py-2 font-medium text-muted hover:text-foreground"
            >
              Sepolia transaction
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setStatus({ kind: "idle" });
              setLabel("");
            }}
            className="rounded-xl border border-edge px-4 py-2 font-medium text-muted hover:text-foreground"
          >
            Pick another
          </button>
        </div>
      </div>
    );
  }

  const busy =
    status.kind === "signing" || status.kind === "minting" || status.kind === "confirming";
  const canSubmit = availability.kind === "available" && !busy && ready;

  return (
    <div data-lane="ens" className="space-y-4">
      <label className="block text-sm font-medium">
        Your name
        <div className="mt-1 flex items-center rounded-xl border border-edge bg-surface-raised px-3">
          <input
            type="text"
            value={label}
            maxLength={ENS_LABEL_MAX}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ironhabit"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            className="w-full bg-transparent px-1 py-3 text-base outline-none"
          />
          <span className="whitespace-nowrap text-sm text-muted">.gohealthme.eth</span>
        </div>
        <span className="mt-1 block text-xs text-muted">
          Lowercase letters and numbers, 3 to {ENS_LABEL_MAX} characters. Minted
          on ENSv2 Sepolia, owned by your wallet.
        </span>
      </label>

      <p className="min-h-5 text-sm" aria-live="polite">
        {availability.kind === "checking" ? (
          <span className="text-muted">Checking the registry...</span>
        ) : availability.kind === "available" ? (
          <span className="text-accent-deep">{availability.name} is available.</span>
        ) : availability.kind === "unavailable" ? (
          <span className="text-danger">{availability.reason}</span>
        ) : null}
      </p>

      <SignInGate note="Sign in to claim your name.">
        {(openSignIn) => (
          <button
            type="button"
            disabled={authenticated ? !canSubmit : !ready}
            onClick={() => {
              if (!authenticated) {
                openSignIn();
                return;
              }
              void submit();
            }}
            className="w-full rounded-xl bg-accent-strong px-5 py-3.5 text-base font-semibold text-background hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status.kind === "signing"
              ? "Waiting for your signature..."
              : status.kind === "minting"
                ? "Minting on Sepolia..."
                : status.kind === "confirming"
                  ? "Waiting for the name to resolve..."
                  : authenticated
                    ? "Claim this name"
                    : "Sign in to claim"}
          </button>
        )}
      </SignInGate>

      {status.kind === "confirming" ? (
        <p className="text-xs text-muted">
          Minted as {status.name}.{" "}
          {status.tx !== null ? (
            <a
              href={sepoliaTxUrl(status.tx)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Sepolia transaction
            </a>
          ) : (
            "Address record confirmed."
          )}{" "}
          Waiting for resolution ({status.polls + 1}/{MAX_POLLS}).
        </p>
      ) : (
        <p className="text-xs text-muted">
          Claiming signs a message to prove the wallet is yours. GoHealthMe pays
          the Sepolia gas; nothing is charged to you.
        </p>
      )}

      {status.kind === "error" ? (
        <ErrorNote
          title="Could not claim the name"
          detail={status.message}
          onRetry={() => setStatus({ kind: "idle" })}
        />
      ) : null}
    </div>
  );
}
