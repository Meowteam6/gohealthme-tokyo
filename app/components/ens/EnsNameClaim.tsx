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
//
// "Use a name I already own": the player types an ENS name, signs the same
// ownership message, and POST /api/ens/link accepts it only when the name
// resolves to this wallet on Ethereum mainnet or Sepolia. Nothing is minted.

import { useEffect, useRef, useState } from "react";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  authHeadersOf,
  clientWalletAuthMessage,
  isUserRejection,
} from "@/lib/client-auth";
import {
  ENS_LABEL_MAX,
  NAME_CAP_REACHED,
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
  | { kind: "linking" }
  | { kind: "confirming"; name: string; tx: string | null; polls: number }
  | { kind: "done"; name: string; tx: string | null }
  | { kind: "error"; message: string };

type Mode = "claim" | "link";

/** Our own subnames get the ENS-app link; a linked name may live on mainnet. */
function isOwnSubname(name: string): boolean {
  return name.endsWith(".gohealthme.eth");
}

const POLL_MS = 3_000;
const MAX_POLLS = 40;

export default function EnsNameClaim({ address, currentName, onClaimed }: EnsNameClaimProps) {
  const { ready, authenticated, getArcWalletClient } = useEmbeddedWallet();
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [editing, setEditing] = useState(currentName === null);
  const [mode, setMode] = useState<Mode>("claim");
  const [ownName, setOwnName] = useState("");
  const checkSeq = useRef(0);
  // New gohealthme.eth names this human can still pick; null = no cap, or
  // not known yet (the server still refuses, this only warns early).
  const [picksLeft, setPicksLeft] = useState<number | null>(null);
  const [picksSeq, setPicksSeq] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/ens/claim?address=${encodeURIComponent(address)}`)
      .then((response) => response.json())
      .then((body: { namesLeft?: number | null }) => {
        if (live) setPicksLeft(typeof body.namesLeft === "number" ? body.namesLeft : null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [address, picksSeq]);
  const outOfPicks = picksLeft === 0;

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
          setPicksSeq((n) => n + 1);
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

  /** Sign the ownership message; null (with the error shown) on failure. */
  const signProof = async (): Promise<{
    signerAddress: string;
    headers: Record<string, string>;
  } | null> => {
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
          ? "Your name needs a signature to prove the wallet is yours. Nothing is charged and no transaction is sent from your wallet."
          : "Your wallet could not sign the proof of ownership. Reconnect it and try again.",
      });
      return null;
    }
    if (signerAddress.toLowerCase() !== address.toLowerCase()) {
      setStatus({
        kind: "error",
        message: "The connected wallet is not the one this character belongs to. Switch wallets and try again.",
      });
      return null;
    }
    return {
      signerAddress,
      headers: authHeadersOf({ address: signerAddress, timestamp, signature }),
    };
  };

  const submitLink = async () => {
    const typed = ownName.trim();
    if (typed === "" || !typed.includes(".")) return;
    const proof = await signProof();
    if (proof === null) return;
    setStatus({ kind: "linking" });
    try {
      const response = await fetch("/api/ens/link", {
        method: "POST",
        headers: { "content-type": "application/json", ...proof.headers },
        body: JSON.stringify({ address: proof.signerAddress, name: typed }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        name?: string;
        error?: string;
      };
      if (!response.ok || typeof body.name !== "string") {
        setStatus({ kind: "error", message: body.error ?? "Could not link that name." });
        return;
      }
      forgetName(address);
      rememberName(address, body.name);
      setStatus({ kind: "done", name: body.name, tx: null });
      onClaimed(body.name);
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server. Try again." });
    }
  };

  const submit = async () => {
    if (availability.kind !== "available") return;
    const check = checkEnsLabel(label);
    if (!check.ok) return;

    const proof = await signProof();
    if (proof === null) return;
    const { signerAddress } = proof;

    setStatus({ kind: "minting" });
    try {
      const response = await fetch("/api/ens/claim", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...proof.headers,
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
        className="space-y-3 rounded-3xl border-2 border-accent-deep/40 bg-surface p-5"
      >
        <p className="text-base font-semibold text-accent-deep">You are {name}</p>
        {isOwnSubname(name) ? (
          <p className="text-sm text-foreground/80">
            Resolves on ENSv2 Sepolia to this wallet. The name is yours: the
            token sits in your wallet and any ENS client can look it up.
          </p>
        ) : (
          <p className="text-sm text-foreground/80">
            Your own ENS name, checked against this wallet on Ethereum and
            Sepolia. If it stops pointing here, it stops showing.
          </p>
        )}
        <div className="flex flex-wrap gap-3 text-sm">
          {isOwnSubname(name) ? (
            <a
              href={ensAppUrl(name)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded-[18px] border-2 border-edge px-4 py-2 font-bold text-foreground hover:bg-surface-raised"
            >
              View on the ENS app
            </a>
          ) : null}
          {tx !== null ? (
            <a
              href={sepoliaTxUrl(tx)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded-[18px] border-2 border-edge px-4 py-2 font-bold text-muted hover:text-foreground"
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
              if (outOfPicks) setMode("link");
            }}
            className="inline-flex min-h-11 items-center rounded-[18px] border-2 border-edge px-4 py-2 font-bold text-muted hover:text-foreground"
          >
            {outOfPicks
              ? "Use a name I already own"
              : picksLeft !== null
                ? `Pick another (${picksLeft} left)`
                : "Pick another"}
          </button>
        </div>
        {outOfPicks ? <p className="text-xs text-muted">{NAME_CAP_REACHED}</p> : null}
      </div>
    );
  }

  const busy =
    status.kind === "signing" ||
    status.kind === "minting" ||
    status.kind === "linking" ||
    status.kind === "confirming";
  const canSubmit = availability.kind === "available" && !busy && ready && !outOfPicks;
  const ownNameReady = ownName.trim().includes(".") && !busy && ready;

  const modeSwitch = (
    <div role="tablist" className="flex flex-wrap gap-2 text-sm">
      {(
        [
          ["claim", "Pick a gohealthme.eth name"],
          ["link", "Use a name I already own"],
        ] as const
      ).map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mode === id}
          disabled={busy}
          onClick={() => {
            setMode(id);
            setStatus({ kind: "idle" });
          }}
          className={`min-h-11 rounded-full border-2 px-4 py-2 font-bold ${
            mode === id
              ? "border-foreground bg-foreground text-background"
              : "border-edge text-muted hover:text-foreground"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );

  const errorNote =
    status.kind === "error" ? (
      <ErrorNote
        title={mode === "link" ? "Could not link the name" : "Could not claim the name"}
        detail={status.message}
        onRetry={() => setStatus({ kind: "idle" })}
      />
    ) : null;

  if (mode === "link") {
    return (
      <div data-lane="ens" className="space-y-4">
        {modeSwitch}
        <label className="block text-sm font-medium">
          Your ENS name
          <input
            type="text"
            value={ownName}
            onChange={(e) => setOwnName(e.target.value)}
            placeholder="yourname.eth"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            className="mt-1 min-h-12 w-full rounded-2xl border-2 border-edge bg-surface px-4 py-3 text-base outline-none focus:border-foreground"
          />
          <span className="mt-1 block text-xs text-muted">
            It must resolve to this wallet ({address.slice(0, 6)}...{address.slice(-4)}) on
            Ethereum or Sepolia. Set that in the ENS app first if it does not.
          </span>
        </label>
        <SignInGate note="Sign in to use your name.">
          {(openSignIn) => (
            <button
              type="button"
              disabled={authenticated ? !ownNameReady : !ready}
              onClick={() => {
                if (!authenticated) {
                  openSignIn();
                  return;
                }
                void submitLink();
              }}
              className="min-h-12 w-full rounded-[18px] font-bold shadow-[var(--shadow-pop)] active:translate-y-1 active:shadow-none disabled:translate-y-0 disabled:shadow-none bg-accent px-5 py-3.5 text-base text-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status.kind === "signing"
                ? "Waiting for your signature..."
                : status.kind === "linking"
                  ? "Checking the name on Ethereum and Sepolia..."
                  : authenticated
                    ? "Use this name"
                    : "Sign in to use your name"}
            </button>
          )}
        </SignInGate>
        <p className="text-xs text-muted">
          Signing proves the wallet is yours. Nothing is minted and nothing is
          charged.
        </p>
        {errorNote}
      </div>
    );
  }

  return (
    <div data-lane="ens" className="space-y-4">
      {modeSwitch}
      <label className="block text-sm font-medium">
        Your name
        <div className="mt-1 flex min-h-12 items-center rounded-2xl border-2 border-edge bg-surface px-3 focus-within:border-foreground">
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
        {outOfPicks ? (
          <span className="text-muted">{NAME_CAP_REACHED}</span>
        ) : availability.kind === "checking" ? (
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
            className="min-h-12 w-full rounded-[18px] font-bold shadow-[var(--shadow-pop)] active:translate-y-1 active:shadow-none disabled:translate-y-0 disabled:shadow-none bg-accent px-5 py-3.5 text-base text-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
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

      {errorNote}
    </div>
  );
}
