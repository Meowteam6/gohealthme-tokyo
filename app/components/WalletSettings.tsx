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

import { SignInLoadingCard } from "@/components/night/SlowSignInNotice";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEmbeddedReveal } from "@dynamic-labs/sdk-react-core";
import { useState } from "react";
import { arcAddressUrl } from "@/lib/chains";
import { formatUsdc } from "@/lib/contract";
import { fetchWalletUsdc } from "@/lib/faucet-funding";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useCharacter, type CharacterView } from "@/lib/game/useCharacter";
import {
  Badge,
  Button,
  Card,
  Fine,
  Money,
  Skeleton,
  TEXT_LINK,
  buttonClasses,
} from "@/components/ui";
import { CARD_TITLE, Notice } from "@/components/night/kit";
import { CopyAddressButton } from "@/components/FundingHelp";
import DisconnectDeviceButton from "@/components/DisconnectDeviceButton";
import SignInPanel from "@/components/SignInPanel";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-edge py-2.5">
      <dt className="text-[0.9375rem] text-haze">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-[0.9375rem] text-foreground">{children}</dd>
    </div>
  );
}

/** A quiet retry or fix inside a row: underlined, 44px tall. */
const ROW_ACTION = `${TEXT_LINK} text-[0.9375rem]`;

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
    <Card as="section" aria-labelledby="backup-heading">
      <h2 id="backup-heading" className={CARD_TITLE}>
        Back up this wallet
      </h2>
      <Notice tone="limit" className="mt-3">
        Optional. It shows a secret code for your account. Anyone who sees it can
        take your money, so never share it, not even with someone from
        GoHealthMe. Only open it somewhere private.
      </Notice>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {/* Both reveals are optional and sensitive, so neither wears the
            primary: a backup is never what this page pushes. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-busy={busy === "phrase"}
          disabled={busy !== null}
          onClick={() => {
            void runExport("phrase");
          }}
        >
          {busy === "phrase" ? "Opening" : "Show my backup code"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-busy={busy === "key"}
          disabled={busy !== null}
          onClick={() => {
            void runExport("key");
          }}
        >
          {busy === "key" ? "Opening" : "Show my secret key"}
        </Button>
      </div>
      {error !== null ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </Card>
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
    return <span className="text-haze">Reading</span>;
  }
  if (view.ensLane === "error") {
    return (
      <button type="button" onClick={view.refresh} className={ROW_ACTION}>
        Could not read your name. Retry
      </button>
    );
  }
  const name = view.character?.name ?? null;
  if (step.status === "done" && name !== null) {
    if (view.nameMode === "handle" && name.startsWith("@")) {
      return (
        <Link href={`/u/${name.slice(1)}`} className={`${ROW_ACTION} text-foreground`}>
          {name}
        </Link>
      );
    }
    return <span className="break-all font-semibold">{name}</span>;
  }
  if (step.status === "locked") {
    return (
      <Link href="/character?step=human" className={ROW_ACTION}>
        {step.note}
      </Link>
    );
  }
  return (
    <Link href="/character" className={ROW_ACTION}>
      Pick a name
    </Link>
  );
}

/**
 * The paired wearable and the one control that revokes it. The privacy notice
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
        <p className="text-[0.9375rem] text-muted">
          Sign once with your wallet to see which wearable is paired. It costs
          nothing and moves no money.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-busy={view.checkingSensor}
          disabled={view.checkingSensor}
          onClick={() => {
            void view.checkSensor();
          }}
          className="mt-3"
        >
          {view.checkingSensor ? "Waiting for your signature" : "Show my wearable"}
        </Button>
      </>
    );
  } else if (view.sensor.kind === "unavailable") {
    body = (
      <Notice tone="limit" role="status">
        Could not read your wearable right now. Nothing is wrong with the
        wearable; try again in a minute.
      </Notice>
    );
  } else if (connected === null) {
    body = (
      <>
        <p className="text-[0.9375rem] text-muted">
          No wearable paired. Challenges are checked against a paired wearable.
        </p>
        <Link href="/character?step=sensor" className={`${buttonClasses({ size: "sm" })} mt-3`}>
          Pair my wearable
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-[0.9375rem] text-foreground">
          <span className="font-semibold">{connected.label}</span>
          <span className="text-muted"> is paired to this wallet.</span>
        </p>
        <p className="mt-1 text-[0.9375rem] text-muted">
          Disconnecting stops SPOTTER reading it. A challenge you are in can only
          be checked while a wearable is paired.
        </p>
        <DisconnectDeviceButton address={address} />
      </>
    );
  }

  return (
    <Card as="section" aria-labelledby="sensor-heading">
      <h2 id="sensor-heading" className={CARD_TITLE}>
        Your wearable
      </h2>
      <div className="mt-2" aria-live="polite">
        {body}
      </div>
    </Card>
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
    <WalletDetailView
      address={address}
      isEmbedded={isEmbedded}
      connectorName={connectorName}
      view={view}
      balance={{
        isLoading: balanceQuery.isLoading,
        isError: balanceQuery.isError,
        data: balanceQuery.data,
        refetch: () => {
          void balanceQuery.refetch();
        },
      }}
      logout={() => {
        void logout();
      }}
    />
  );
}

/** What the balance row needs from its read. */
export interface BalanceRead {
  isLoading: boolean;
  isError: boolean;
  data: bigint | undefined;
  refetch: () => void;
}

/**
 * The signed-in settings, drawn from what the hooks read. Split from
 * WalletDetail so the dev gallery can render each state from fixtures; the
 * reads and the sign-out stay in WalletDetail.
 */
export function WalletDetailView({
  address,
  isEmbedded,
  connectorName,
  view,
  balance: balanceQuery,
  logout,
}: {
  address: `0x${string}`;
  isEmbedded: boolean | null;
  connectorName: string | null;
  view: CharacterView;
  balance: BalanceRead;
  logout: () => void;
}) {
  return (
    <div className="[&>*+*]:mt-6">
      <Card as="section" aria-labelledby="wallet-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="wallet-heading" className={CARD_TITLE}>
            Your wallet
          </h2>
          {isEmbedded === null ? (
            <Skeleton className="h-6 w-28" />
          ) : isEmbedded ? (
            <Badge tone="accent">Provisioned wallet</Badge>
          ) : (
            <Badge tone="muted">Connected wallet</Badge>
          )}
        </div>
        <p className="mt-2 text-[0.9375rem] leading-[1.5] text-muted">
          {isEmbedded === false
            ? `An external wallet you connected${
                connectorName !== null ? ` (${connectorName})` : ""
              }. Its keys live in that wallet, not here.`
            : "We made this wallet for you from your email. No seed phrase or extension needed to use it; back it up below when you want the keys."}
        </p>

        <div className="mt-4">
          <p className="mb-2 text-[0.8125rem] text-haze">Address</p>
          <CopyAddressButton address={address} />
        </div>

        <dl className="mt-4">
          <Row label="Name">
            <NameValue view={view} />
          </Row>
          <Row label="Money">
            Test USDC <span className="text-haze">on Base Sepolia</span>
          </Row>
          <Row label="Balance">
            {balanceQuery.isLoading ? (
              <span className="text-haze">Reading</span>
            ) : balanceQuery.isError ? (
              <button
                type="button"
                onClick={balanceQuery.refetch}
                className={ROW_ACTION}
              >
                Could not read it. Retry
              </button>
            ) : (
              <Money usd={formatUsdc(balanceQuery.data ?? 0n)} size="md" />
            )}
          </Row>
          <Row label="Public record">
            <a
              href={arcAddressUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              className={ROW_ACTION}
            >
              See the public receipt
            </a>
          </Row>
        </dl>
      </Card>

      <DeviceSection address={address} view={view} />

      {/* Self-serve top-up. The in-app faucet grants a small amount from a
          shared treasury; Circle's testnet faucet lets a user pull 20 USDC
          straight to their own wallet, which keeps the shared treasury for
          everyone else. Test USDC only - no real value, same as the rest of
          this page. */}
      <Card as="section" aria-labelledby="faucet-heading">
        <h2 id="faucet-heading" className={CARD_TITLE}>
          Want more test USDC?
        </h2>
        <p className="mt-2 text-[0.9375rem] leading-[1.5] text-muted">
          Grab 20 USDC free from Circle&apos;s testnet faucet: copy your address
          above, choose{" "}
          <span className="font-medium text-foreground">Base Sepolia</span> as
          the network, and send. One claim every 2 hours.
        </p>
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-3 ${buttonClasses({ variant: "secondary", size: "sm" })}`}
        >
          Open the Circle faucet
        </a>
        <Fine className="mt-2">Test USDC only. It has no real value.</Fine>
      </Card>

      {isEmbedded === true ? <BackupSection /> : null}

      {isEmbedded === false ? (
        // The one-step escape for a stuck external-wallet user. Signing out
        // drops the connected wallet and lands on WalletSettings' signed-out
        // branch, which renders the email-first SignInPanel - so the next
        // wallet is the provisioned embedded one, with no reconnect prompts.
        <Card as="section" aria-labelledby="switch-heading">
          <h2 id="switch-heading" className={CARD_TITLE}>
            Switch to your GoHealthMe email wallet
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-[1.5] text-muted">
            You are on an external wallet. If a transaction keeps asking you to
            reconnect, switch to the wallet we make from your email, with no
            extension and no reconnect prompts. This signs you out of the
            connected wallet, then you sign back in with an email code.
          </p>
          <Button
            type="button"
            block
            onClick={() => {
              void logout();
            }}
            className="mt-4"
          >
            Switch to my email wallet
          </Button>
        </Card>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        block
        onClick={() => {
          void logout();
        }}
      >
        Sign out
      </Button>
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
      <SignInLoadingCard label="Loading your wallet">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-4 h-[52px] w-full" />
        <Skeleton className="mt-4 h-4 w-2/3" />
      </SignInLoadingCard>
    );
  }

  if (!authenticated || address === null) {
    // The sign-in card is the floor SPOTTER stands on here.
    return (
      <div className="[&>*+*]:mt-3">
        <SignInPanel surface="card" />
        <Fine>Sign in to see your wallet address, balance and backup options.</Fine>
      </div>
    );
  }

  return <WalletDetail address={address} />;
}
