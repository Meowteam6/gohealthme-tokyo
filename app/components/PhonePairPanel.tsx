"use client";

// The Apple Watch pairing card: what a player sees after tapping Pair my
// Apple Watch. The iPhone app reads Health on the phone and posts daily
// totals, so the browser's whole job is the handoff: a one-time code the app
// redeems, carried by a deep link when the site is open on the iPhone itself.
// The card then watches the provider list and flips to paired on its own the
// moment the phone stores its first sync. There is no "I paired it" button:
// the phone's answer is the only one that counts, and nobody should have to
// tell SPOTTER something he can see for himself.
//
// A RE-PAIR is the one case the card cannot watch. The wallet reads paired
// before the new phone redeems the code and paired after, so the card keeps
// the code on screen, says what the code does, and leaves the confirmation
// to the app on the phone. Hiding the code behind "already paired" was a dead
// end: a code minted that nobody could see.
//
// INSIDE THE IPHONE APP (lib/shell.ts) the page is already on the phone, so
// no code is shown at all: the card hands it to the shell once, the shell
// redeems it and asks iOS for Health, and each step comes back as one line
// here (lib/shell-pairing.ts). The shell's own "synced" is the confirmation,
// re-pair included, so the card flips there too. Nothing polls in the shell.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, TEXT_LINK, buttonClasses } from "@/components/ui";
import { Notice, QUIET_ACTION } from "@/components/night/kit";
import { cachedOnlyRequester } from "@/lib/client-auth";
import { isShell, onShellEvent, shellPost, useShellStatus, type ShellPairStatus } from "@/lib/shell";
import {
  SHELL_ALLOW_HEALTH,
  SHELL_NO_HEALTH,
  marksRedeemed,
  pairPostFor,
  shellPairView,
  syncedWithData,
  type ShellPairAction,
} from "@/lib/shell-pairing";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { useEmbeddedWallet } from "@/lib/wallet";
import { countsLineFor, pairedDeviceName, reportsSleep } from "@/lib/game/sensor-copy";
import {
  PAIR_POLL_INTERVAL_MS,
  fetchProviderOptions,
  isIphoneUserAgent,
  pairPanelPhase,
  pairPanelPolls,
  phonePairingOf,
  providerOptionsQueryKey,
  requestPhonePairing,
  type PhonePairState,
  type PhoneSteps,
  type ProviderOptions,
} from "@/lib/wearable-connect";

export type { PhoneSteps };

/** Which device the page is on, for which action leads. */
export type PairPlatform = "shell" | "iphone" | "other";

// Same shell as the option cards on the pairing step, so the handoff reads as
// the next card in the flow and not as a warning box.
const CARD =
  "rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border-strong)] [&>*+*]:mt-3";

const WHAT_HAPPENS =
  "The GoHealthMe app reads Health on your iPhone. Only daily totals leave the phone, never the raw samples.";

const REPLACES =
  "Already paired. The iPhone that uses this code replaces the one paired now. Your stored days stay.";

const OPEN_THE_APP = "Open the GoHealthMe app on your iPhone";

const SYNCS_ON_ITS_OWN = "It syncs on its own and whenever you open the GoHealthMe app.";

const NO_OPTIONS: ProviderOptions = { providers: [], selected: null, status: "unavailable" };
const UNPAIRED: PhonePairState = { kind: "unpaired" };

// The platform is read once from the user agent, through an external-store
// read so the server render (no navigator) and the first client render agree
// and nothing flashes from one layout to the other. The shell is checked
// first: it is an iPhone too, and its deep link would be a dead button.
const noSubscribe = () => () => {};
const clientPlatform = (): PairPlatform =>
  isShell() ? "shell" : isIphoneUserAgent(navigator.userAgent) ? "iphone" : "other";
const serverPlatform = (): PairPlatform => "other";

/** The shell's reports on one code, so a report never speaks for another code. */
interface ShellPair {
  code: string;
  status: ShellPairStatus | null;
  redeemed: boolean;
}

function expiryTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Code({ code, size }: { code: string; size: "sm" | "lg" }) {
  return (
    <p
      className={`m-0 select-all text-center font-mono font-semibold tracking-[0.2em] text-foreground ${
        size === "lg" ? "text-3xl" : "text-xl"
      }`}
      aria-label={`Pairing code ${code.split("").join(" ")}`}
    >
      {code}
    </p>
  );
}

export default function PhonePairPanel({
  steps,
  address,
  platform,
  poll = true,
  repair,
  shellPair,
  healthAvailable,
}: {
  steps: PhoneSteps;
  /** The wallet being paired. The signed-in wallet when omitted. */
  address?: `0x${string}` | null;
  /** Forces the layout (the state gallery). Read from the user agent otherwise. */
  platform?: PairPlatform;
  /** Off in the state gallery, so a frame renders with no network. */
  poll?: boolean;
  /**
   * True when the wallet already had a phone when this code was minted, so
   * the code replaces it. Read off the provider list at mount when omitted.
   */
  repair?: boolean;
  /** The shell's latest report on the code (the state gallery). Off the bridge otherwise. */
  shellPair?: ShellPairStatus;
  /** Whether this phone can read Apple Health (the state gallery). Off the shell otherwise. */
  healthAvailable?: boolean;
}) {
  const wallet = useEmbeddedWallet();
  const walletAddress: `0x${string}` | null =
    address === undefined ? wallet.address : address;
  const detected = useSyncExternalStore(noSubscribe, clientPlatform, serverPlatform);
  const on = platform ?? detected;
  const inShell = on === "shell";
  const shellInfo = useShellStatus();
  const noHealth = inShell && !(healthAvailable ?? shellInfo?.healthAvailable ?? true);

  // "Get a new code" replaces the steps the parent handed over. A new object
  // from the parent (a second tap on the card) wins again, with no effect to
  // keep the two in step.
  const [minted, setMinted] = useState<{ from: PhoneSteps; steps: PhoneSteps } | null>(null);
  const live = minted !== null && minted.from === steps ? minted.steps : steps;
  const [minting, setMinting] = useState(false);
  const [mintFailed, setMintFailed] = useState(false);
  const pairing = live.pairing;

  const requestAuth = useWalletAuth();
  const quietAuth = useMemo(() => cachedOnlyRequester(requestAuth), [requestAuth]);

  // Decided once, when the code arrives: a phone already paired at that moment
  // means this code replaces it, and the provider read will not change.
  const queryClient = useQueryClient();
  const [pairedAtMount] = useState(
    () =>
      phonePairingOf(
        queryClient.getQueryData<ProviderOptions>(providerOptionsQueryKey(walletAddress)),
      ).kind !== "unpaired",
  );
  const repairing = repair ?? pairedAtMount;

  // THE SHELL HANDOFF. The code goes to the shell exactly once (the redeem is
  // single-use; a StrictMode double effect must not spend it), and only the
  // reports that arrive after that post speak for it.
  const posted = useRef<string | null>(null);
  const [shell, setShell] = useState<ShellPair | null>(() =>
    shellPair !== undefined && pairing !== null
      ? { code: pairing.code, status: shellPair, redeemed: marksRedeemed(shellPair) }
      : null,
  );
  const shellForCode = shell !== null && pairing !== null && shell.code === pairing.code ? shell : null;
  const shellStatus = shellForCode?.status ?? null;
  const shellRedeemed = shellForCode?.redeemed ?? false;

  useEffect(() => {
    if (!inShell || noHealth) return;
    const message = pairPostFor(posted.current, pairing, Date.now());
    if (message === null || message.type !== "pair") return;
    posted.current = message.code;
    shellPost(message);
  }, [inShell, noHealth, pairing]);

  useEffect(() => {
    if (!inShell) return;
    return onShellEvent((event) => {
      if (event.type !== "pair-status") return;
      const code = posted.current;
      if (code === null) return;
      setShell((prev) => ({
        code,
        status: event.pair,
        redeemed: (prev !== null && prev.code === code && prev.redeemed) || marksRedeemed(event.pair),
      }));
      if (syncedWithData(event.pair)) {
        // The phone stored its first days: re-read what the lobby and the
        // character card read, so every surface flips on the same answer.
        void queryClient.invalidateQueries({ queryKey: providerOptionsQueryKey(walletAddress) });
        void queryClient.invalidateQueries({ queryKey: ["wearable-progress"] });
      }
    });
  }, [inShell, queryClient, walletAddress]);

  // The same read, under the same key, that character creation and the join
  // gate use, so this card and the lobby can never disagree about the phone.
  // The interval is evaluated on the query's own data after every fetch: it
  // runs every three seconds while a pairing can still land and stops by
  // itself on paired, on an expired code, and ten minutes after minting.
  const providers = useQuery({
    queryKey: providerOptionsQueryKey(walletAddress),
    queryFn: () =>
      walletAddress === null
        ? Promise.resolve(NO_OPTIONS)
        : fetchProviderOptions(walletAddress, quietAuth),
    enabled: poll && walletAddress !== null,
    retry: false,
    staleTime: 60_000,
    refetchInterval: (query) =>
      poll &&
      pairPanelPolls(
        pairPanelPhase(pairing, phonePairingOf(query.state.data), Date.now()),
        pairing,
        Date.now(),
        repairing,
        inShell,
      )
        ? PAIR_POLL_INTERVAL_MS
        : false,
  });

  // A re-pair reads paired throughout, so the read is ignored until the shell
  // confirms the sync. In a browser the app on the phone is the confirmation.
  const shellConfirmed = inShell && syncedWithData(shellStatus);
  const pair = repairing && !shellConfirmed ? UNPAIRED : phonePairingOf(providers.data);

  const [now, setNow] = useState(() => Date.now());
  const phase = pairPanelPhase(pairing, pair, now);

  // The clock behind the live-to-expired flip. Only ticks while a code is live.
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setNow(Date.now()), PAIR_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [phase]);

  const newCode = () => {
    if (walletAddress === null || minting) return;
    setMinting(true);
    setMintFailed(false);
    requestPhonePairing(walletAddress, requestAuth)
      .then((next) => {
        setMinted({ from: steps, steps: next });
        setNow(Date.now());
      })
      .catch(() => setMintFailed(true))
      .finally(() => setMinting(false));
  };

  /** A shell-card tap. The same code again is the one case the once-rule yields to. */
  const onShellAction = (action: ShellPairAction) => {
    switch (action.kind) {
      case "new-code":
        newCode();
        return;
      case "sync":
        // The shell reports syncing at once; saying so here spares a flash.
        if (shellForCode !== null) setShell({ ...shellForCode, status: { status: "syncing" } });
        shellPost({ type: "sync" });
        return;
      case "repost":
        if (pairing === null) return;
        posted.current = pairing.code;
        setShell({ code: pairing.code, status: null, redeemed: false });
        shellPost({ type: "pair", code: pairing.code });
        return;
      case "open-settings":
        shellPost({ type: "open-settings" });
        return;
    }
  };

  if (pair.kind === "paired") {
    const sleeps = reportsSleep(pair.metrics);
    return (
      <Notice tone="ok" title={`${pairedDeviceName("apple", pair.label, pair.metrics)} is paired`} live>
        {countsLineFor(pair.metrics)}{" "}
        {sleeps
          ? null
          : "No sleep has arrived yet, so sleep challenges stay locked. They need an Apple Watch worn to bed; the next sync after a night unlocks them. "}
        {SYNCS_ON_ITS_OWN}
      </Notice>
    );
  }

  if (noHealth) {
    // An iPad or a simulator: said before any code is handed over.
    return <Notice tone="limit">{SHELL_NO_HEALTH}</Notice>;
  }

  const newCodeLabel = minting ? "Getting a new code" : "Get a new code";
  const mintFailedNote = mintFailed ? (
    <Notice tone="error">
      I could not get a new code just now. Nothing changed. Try again in a moment.
    </Notice>
  ) : null;

  // Inside the shell the card is the shell's own line on the code. Its word
  // beats a stale provider read (a sync with nothing in it, or a failure,
  // keeps its taps on screen while the server still says awaiting-sync), and
  // once it has redeemed the code the ten minutes no longer matter: the
  // Health sheet may sit open for longer than that.
  if (inShell && pairing !== null) {
    const expired = phase === "expired" && !shellRedeemed;
    const heard = shellStatus !== null && !syncedWithData(shellStatus);
    if (heard || (!expired && pair.kind === "unpaired")) {
      const view = shellPairView(shellStatus, shellRedeemed);
      return (
        <div className={CARD} role="status" aria-live="polite">
          <p className="m-0 font-semibold text-foreground">
            {repairing ? "Pair your iPhone again" : "Pair your Apple Watch"}
          </p>
          <p className="m-0 text-sm leading-[1.45] text-haze">{repairing ? REPLACES : WHAT_HAPPENS}</p>
          <ShellLine view={view} minting={minting} newCodeLabel={newCodeLabel} onAction={onShellAction} />
          {mintFailedNote}
        </div>
      );
    }
  }

  if (pair.kind === "awaiting-sync") {
    return (
      <Notice tone="limit" title="Your iPhone is paired. Waiting on its first sync" live>
        {inShell ? SHELL_ALLOW_HEALTH : `${OPEN_THE_APP} and allow Health when it asks`}. This
        flips the moment the first day arrives.
      </Notice>
    );
  }

  if (pair.kind === "unreadable") {
    return (
      <Notice tone="limit" title="Apple Watch is paired and I cannot read what it counts right now">
        Nothing to do on your side. Check back shortly.
      </Notice>
    );
  }

  // Inside the shell the app is already here, so there is nothing to install.
  const install =
    !inShell && live.installUrl !== null ? (
      <a
        href={live.installUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClasses({ variant: "secondary", size: "sm", block: true })}
      >
        Get the app
      </a>
    ) : null;

  if (pairing === null) {
    // The route answered without a code. The server's own sentence talks
    // about a code the player cannot see, so the card says what happened and
    // offers the one tap that fixes it.
    return (
      <div className={CARD} role="status" aria-live="polite">
        <p className="m-0 font-semibold text-foreground">Pair your Apple Watch</p>
        <p className="m-0 text-sm leading-[1.45] text-haze">{WHAT_HAPPENS}</p>
        <p className="m-0 text-[0.9375rem] text-muted">
          I could not get a pairing code just now. Nothing changed.
        </p>
        <Button type="button" size="sm" block disabled={minting} onClick={newCode}>
          {newCodeLabel}
        </Button>
        {install}
        {mintFailedNote}
      </div>
    );
  }

  const expired = phase === "expired";
  const until = expiryTime(pairing.expiresAt);

  return (
    <div className={CARD}>
      <p className="m-0 font-semibold text-foreground">
        {expired ? "That code expired" : repairing ? "Pair your iPhone again" : "Pair your Apple Watch"}
      </p>
      <p className="m-0 text-sm leading-[1.45] text-haze">
        {repairing && !expired ? REPLACES : WHAT_HAPPENS}
      </p>

      {expired ? (
        <>
          <p className="m-0 text-[0.9375rem] text-muted">
            Codes work for ten minutes. Get a new one and the app pairs the same way.
          </p>
          <Button type="button" size="sm" block disabled={minting} onClick={newCode}>
            {newCodeLabel}
          </Button>
        </>
      ) : on === "iphone" ? (
        <>
          {/* The deep link carries the code, so on the iPhone nothing is typed.
              The install link is second: the site cannot tell whether the app
              is there, so both are offered and the one that applies works. */}
          <a href={pairing.deepLink} className={buttonClasses({ size: "sm", block: true })}>
            Open the GoHealthMe app
          </a>
          {install}
          <p className="m-0 text-sm text-muted">On a computer? Type this code in the app.</p>
          <Code code={pairing.code} size="sm" />
          <p className="m-0 text-center text-sm text-haze">Works once, until {until}.</p>
        </>
      ) : (
        <>
          <Code code={pairing.code} size="lg" />
          <p className="m-0 text-center text-[0.9375rem] leading-[1.45] text-muted">
            Type this code in the GoHealthMe app on your iPhone. Works once, until {until}.
          </p>
          {live.installUrl !== null ? (
            <p className="m-0 text-center">
              <a
                href={live.installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={TEXT_LINK}
              >
                Get the app for iPhone
              </a>
            </p>
          ) : null}
        </>
      )}

      {expired ? null : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="m-0 text-sm text-haze" aria-live="polite">
            {repairing
              ? "The app confirms it on your iPhone."
              : "Waiting for your iPhone. This flips on its own once the app syncs."}
          </p>
          <button type="button" className={QUIET_ACTION} disabled={minting} onClick={newCode}>
            {newCodeLabel}
          </button>
        </div>
      )}

      {mintFailedNote}
    </div>
  );
}

/**
 * The shell card's status line and its taps. A failure's first tap is the
 * one that fixes it, drawn as a button; anything after it is quiet. While the
 * shell works the only tap is the quiet new code, for the case it never
 * answers.
 */
function ShellLine({
  view,
  minting,
  newCodeLabel,
  onAction,
}: {
  view: ReturnType<typeof shellPairView>;
  minting: boolean;
  newCodeLabel: string;
  onAction: (action: ShellPairAction) => void;
}) {
  const label = (action: ShellPairAction) => (action.kind === "new-code" && action.label === "Get a new code" ? newCodeLabel : action.label);
  if (!view.failed) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="m-0 text-sm text-haze" aria-live="polite">
          {view.line}
        </p>
        {view.actions.map((action) => (
          <button
            key={action.kind}
            type="button"
            className={QUIET_ACTION}
            disabled={minting}
            onClick={() => onAction(action)}
          >
            {label(action)}
          </button>
        ))}
      </div>
    );
  }
  const [first, ...rest] = view.actions;
  return (
    <>
      <p className="m-0 text-[0.9375rem] text-foreground" aria-live="polite">
        {view.line}
      </p>
      {first !== undefined ? (
        <Button type="button" size="sm" block disabled={minting} onClick={() => onAction(first)}>
          {label(first)}
        </Button>
      ) : null}
      {rest.map((action) => (
        <button
          key={action.kind}
          type="button"
          className={QUIET_ACTION}
          disabled={minting}
          onClick={() => onAction(action)}
        >
          {label(action)}
        </button>
      ))}
    </>
  );
}
