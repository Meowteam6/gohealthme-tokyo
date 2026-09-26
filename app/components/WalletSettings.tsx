"use client";

// The signed-in user's wallet home. It answers the questions an email user has
// no other place to ask: what is my address, which network am I on, how much
// spendable USDC do I hold, is this the wallet the app made for me or one I
// connected, and - for the provisioned wallet - how do I back it up.
//
// Everything here is a read except the export action, which hands off to
// Dynamic's own secure reveal UI (a sandboxed iframe rendered by the existing
// DynamicContextProvider). The private key and recovery phrase never pass
// through this component or the app; the SDK shows them in isolation.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEmbeddedReveal } from "@dynamic-labs/sdk-react-core";
import { useState } from "react";
import { arcAddressUrl } from "@/lib/chains";
import { formatUsdc } from "@/lib/contract";
import { fetchWalletUsdc } from "@/lib/faucet-funding";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useCharacter, type CharacterView } from "@/lib/game/useCharacter";
import { Badge, Skeleton } from "@/components/ui";
import { CopyAddressButton } from "@/components/FundingHelp";
import DisconnectDeviceButton from "@/components/DisconnectDeviceButton";
import SignInPanel from "@/components/SignInPanel";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge py-3 first:border-t-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

type ExportMode = "phrase" | "key";

function BackupSection() {
  const { initExportProcess } = useEmbeddedReveal();
  const [busy, setBusy] = useState<ExportMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runExport = async (mode: ExportMode) => {
    setBusy(mode);
    setError(null);
    try {
      // recoveryPhrase=true reveals the seed phrase (HD wallets only); false
      // reveals the raw private key. Dynamic renders the value in its own
      // sandboxed iframe and resolves when the reveal view closes.
      await initExportProcess(mode === "phrase");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The wallet export could not be started.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-edge bg-surface p-5">
      <h2 className="text-lg font-semibold">Back up this wallet</h2>
      <p className="mt-2 text-sm text-muted">
        This is optional. It shows a secret code for your account. Anyone who
        sees it can take your money - never share it, not even with someone from
        GoHealthMe. Only open this somewhere private.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void runExport("phrase");
          }}
          className="min-h-11 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "phrase"
            ? "Opening..."
            : "Show my backup code (keep private)"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void runExport("key");
          }}
          className="min-h-11 rounded-xl border border-edge px-5 py-3 text-sm font-semibold text-foreground hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "key"
            ? "Opening..."
            : "Show my secret key (keep private)"}
        </button>
      </div>
      {error !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground/80"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The player's name, the same way character creation sees it: the ENS name on
 * a build with ENS on, the @handle otherwise. The fix for "no name yet" is the
 * character name step (/character), which runs whichever claim this build
 * actually supports; the Supabase-only /handle page cannot mint an ENS name.
 */
function NameValue({ view }: { view: CharacterView }) {
  const step = view.steps.name;
  if (step.status === "loading") {
    return <span className="text-muted">Reading...</span>;
  }
  if (view.ensLane === "error") {
    return (
      <button
        type="button"
        onClick={view.refresh}
        className="inline-flex min-h-11 items-center text-accent-deep underline underline-offset-2"
      >
        Could not read your name - retry
      </button>
    );
  }
  const name = view.character?.name ?? null;
  if (step.status === "done" && name !== null) {
    if (view.nameMode === "handle" && name.startsWith("@")) {
      return (
        <Link
          href={`/u/${name.slice(1)}`}
          className="font-semibold text-foreground hover:text-accent-deep"
        >
          {name}
        </Link>
      );
    }
    return <span className="break-all font-semibold">{name}</span>;
  }
  if (step.status === "locked") {
    return (
      <Link
        href="/character?step=human"
        className="inline-flex min-h-11 items-center font-medium text-accent-deep underline underline-offset-2"
      >
        {step.note}
      </Link>
    );
  }
  return (
    <Link
      href="/character"
      className="inline-flex min-h-11 items-center font-medium text-accent-deep underline underline-offset-2"
    >
      Pick a name
    </Link>
  );
}

/**
 * The paired sensor and the one control that revokes it. The privacy notice
 * promises disconnect "from your account"; this is where that lives for every
 * paired player, whether or not they are in a run.
 */
function DeviceSection({
  address,
  view,
}: {
  address: `0x${string}`;
  view: CharacterView;
}) {
  const connected =
    view.providers?.providers.find((p) => p.connected) ?? null;

  let body: React.ReactNode;
  if (view.sensor.kind === "loading") {
    body = <Skeleton className="h-11 w-48" />;
  } else if (view.sensor.kind === "unchecked") {
    body = (
      <>
        <p className="text-sm text-muted">
          Sign once with your wallet to see which wearable is paired. It costs
          nothing and moves no money.
        </p>
        <button
          type="button"
          disabled={view.checkingSensor}
          onClick={() => {
            void view.checkSensor();
          }}
          className="mt-3 min-h-11 rounded-xl border border-edge px-5 py-3 text-sm font-semibold text-foreground hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {view.checkingSensor ? "Waiting for your signature" : "Show my wearable"}
        </button>
      </>
    );
  } else if (view.sensor.kind === "unavailable") {
    body = (
      <p role="status" className="text-sm text-muted">
        Could not read your wearable right now. Nothing is wrong with the
        device; try again in a minute.
      </p>
    );
  } else if (connected === null) {
    body = (
      <>
        <p className="text-sm text-muted">
          No wearable paired. Runs are checked against a paired wearable.
        </p>
        <Link
          href="/character"
          className="mt-3 inline-flex min-h-11 items-center font-medium text-accent-deep underline underline-offset-2"
        >
          Pair a wearable
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-sm text-foreground">
          <span className="font-semibold">{connected.label}</span>
          <span className="text-muted"> is paired to this wallet.</span>
        </p>
        <p className="mt-1 text-sm text-muted">
          Disconnecting stops SPOTTER reading it. A run you are in can only be
          checked while a wearable is paired.
        </p>
        <DisconnectDeviceButton address={address} />
      </>
    );
  }

  return (
    <section
      aria-labelledby="sensor-heading"
      className="rounded-2xl border border-edge bg-surface p-5"
    >
      <h2 id="sensor-heading" className="text-lg font-semibold">
        Your wearable
      </h2>
      <div className="mt-2" aria-live="polite">
        {body}
      </div>
    </section>
  );
}

function WalletDetail({ address }: { address: `0x${string}` }) {
  const { isEmbedded, connectorName, logout } = useEmbeddedWallet();
  const view = useCharacter();

  const balanceQuery = useQuery({
    queryKey: ["wallet-usdc", address],
    queryFn: () => fetchWalletUsdc(address),
    staleTime: 15_000,
    retry: false,
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-edge bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Your wallet</h2>
          {isEmbedded === null ? (
            <Skeleton className="h-6 w-28" />
          ) : isEmbedded ? (
            <Badge tone="accent">Provisioned wallet</Badge>
          ) : (
            <Badge tone="muted">Connected wallet</Badge>
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          {isEmbedded === false
            ? `An external wallet you connected${
                connectorName !== null ? ` (${connectorName})` : ""
              }. Its keys live in that wallet, not here.`
            : "We created this wallet for you from your email. No seed phrase or extension needed to use it - back it up below when you want the keys."}
        </p>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Address
          </p>
          <CopyAddressButton address={address} />
        </div>

        <div className="mt-2">
          <Row label="Name">
            <NameValue view={view} />
          </Row>
          <Row label="Mode">
            Practice
            <span className="ml-1 text-muted">(test network)</span>
          </Row>
          <Row label="Balance">
            {balanceQuery.isLoading ? (
              <span className="text-muted">Reading...</span>
            ) : balanceQuery.isError ? (
              <button
                type="button"
                onClick={() => {
                  void balanceQuery.refetch();
                }}
                className="text-accent-deep underline underline-offset-2"
              >
                Could not read - retry
              </button>
            ) : (
              <span className="font-mono tabular-nums">
                {formatUsdc(balanceQuery.data ?? 0n)} USDC
              </span>
            )}
          </Row>
          <Row label="Public record">
            <a
              href={arcAddressUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-deep underline underline-offset-2"
            >
              See the public receipt
            </a>
          </Row>
        </div>
      </section>

      <DeviceSection address={address} view={view} />

      {/* Self-serve top-up. The in-app faucet grants a small amount from a
          shared treasury; Circle's testnet faucet lets a user pull 20 USDC
          straight to their own wallet, which keeps the shared treasury for
          everyone else. Test USDC only - no real value, same as the rest of
          this page. */}
      <section className="rounded-2xl border border-dashed border-edge bg-surface-raised p-5">
        <h2 className="text-sm font-semibold">Want more test USDC?</h2>
        <p className="mt-1 text-sm text-muted">
          Grab 20 USDC free from Circle&apos;s testnet faucet: copy your address
          above, choose{" "}
          <span className="font-medium text-foreground">Base Sepolia</span> as
          the network, and send. One claim every 2 hours.
        </p>
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-deep underline underline-offset-2"
        >
          Open Circle faucet
          <span aria-hidden="true">-&gt;</span>
        </a>
      </section>

      {isEmbedded === true ? <BackupSection /> : null}

      {isEmbedded === false ? (
        // The one-step escape for a stuck external-wallet user. Signing out
        // drops the connected wallet and lands on WalletSettings' signed-out
        // branch, which renders the email-first SignInPanel - so the next
        // wallet is the provisioned embedded one, with no reconnect prompts.
        <section className="rounded-2xl border border-accent/40 bg-accent/20 p-5">
          <h2 className="text-lg font-semibold">
            Switch to your GoHealthMe email wallet
          </h2>
          <p className="mt-2 text-sm text-muted">
            You are on an external wallet. If a transaction keeps asking you to
            reconnect, switch to the wallet we make from your email - no
            extension and no reconnect prompts. This signs you out of the
            connected wallet, then you sign back in with an email code.
          </p>
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className="mt-4 min-h-11 w-full rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-foreground hover:bg-accent-hover"
          >
            Switch to my email wallet
          </button>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => {
          void logout();
        }}
        className="min-h-11 w-full rounded-xl border border-edge px-5 py-3 text-sm font-medium text-muted hover:text-foreground"
      >
        Sign out
      </button>
    </div>
  );
}

/**
 * Wallet settings. Mounted only under a configured DynamicContextProvider (the
 * settings page gates on DYNAMIC_CONFIGURED), so the Dynamic hooks here are
 * always safe.
 */
export default function WalletSettings() {
  const { ready, authenticated, address } = useEmbeddedWallet();

  if (!ready) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!authenticated || address === null) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Sign in to see your wallet address, balance, and backup options.
        </p>
        <SignInPanel />
      </div>
    );
  }

  return <WalletDetail address={address} />;
}
