"use client";

// Character creation step 4: pair your sensor. This is where the join gate's
// capability probe now happens, once, instead of at every pool: the result
// says what this device can and cannot measure, from the same provider read
// lib/wearable-join-gate.ts uses. A WHOOP player learns "no step count" here,
// not after a stake on a steps run.

import { countsLine } from "@/lib/game/sensor-copy";
import { COMING_LINE, LAUNCH_METRICS } from "@/lib/provider-capabilities";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, TAP_TARGET } from "@/components/ui";
import WhoopReturnNote from "@/components/WhoopReturnNote";
import { useWalletAuth } from "@/lib/useWalletAuth";
import {
  PhoneLinkRequiredError,
  PopupBlockedError,
  capabilityHoldOf,
  currentReturnPath,
  startWearableLink,
  type ProviderOption,
  type WearableProviderId,
} from "@/lib/wearable-connect";
import {
  WEARABLE_METRICS,
  metricLabel,
  type WearableMetric,
} from "@/lib/wearable-goal";
import type { CharacterView } from "@/lib/game/useCharacter";

// What each provider is, in words, before anyone hands over health data.
const BLURB: Record<WearableProviderId, string> = {
  junction: "WHOOP, Oura, Fitbit or Garmin, through Junction.",
  whoop: "WHOOP only, connected directly. Sleep and workouts. No step count.",
  apple: "Apple Watch and iPhone, set up in the GoHealthMe app on your iPhone.",
};

const CTA: Record<WearableProviderId, string> = {
  junction: "Pair with Junction",
  whoop: "Pair my WHOOP",
  apple: "Set up on my iPhone",
};

/**
 * What an option can measure, worded for how much we actually know. Junction
 * fronts several brands, so until THIS device has synced its list is only
 * what some device through it could do. Saying "Measures step count" to a
 * WHOOP wearer here was the promise the steps-run trap was built on.
 */
function measuresLine(option: ProviderOption): string {
  // Worded in terms of the runs on offer (lib/provider-capabilities), so the
  // card never advertises a metric no run uses.
  if (option.capability === "observed" && option.observedMetrics !== null) {
    const seen = LAUNCH_METRICS.filter((m) => option.observedMetrics?.includes(m));
    return seen.length === 0
      ? "Your device has not reported sleep or workouts yet."
      : `Counts ${seen.map(metricLabel).join(", ")}.`;
  }
  if (option.id === "junction") {
    return option.connected
      ? `Linked. I confirm what your device counts after its first sync. ${countsLine("junction")}`
      : `${countsLine("junction")} Depends on your device.`;
  }
  return countsLine(option.id);
}

function PairButton({
  address,
  option,
  onPhoneSteps,
  onBlocked,
  onError,
}: {
  address: `0x${string}`;
  option: ProviderOption;
  onPhoneSteps: (steps: string) => void;
  onBlocked: (url: string) => void;
  onError: () => void;
}) {
  const requestAuth = useWalletAuth();
  const [opening, setOpening] = useState(false);
  return (
    <Button
      type="button"
      variant={option.connected ? "secondary" : "primary"}
      disabled={opening}
      onClick={() => {
        setOpening(true);
        // WHOOP's OAuth takes over this tab; the return path brings the
        // player back to this step, not a dashboard onboarding would cover.
        void startWearableLink(address, requestAuth, option.id, currentReturnPath())
          .catch((err: unknown) => {
            if (err instanceof PopupBlockedError) onBlocked(err.linkUrl);
            else if (err instanceof PhoneLinkRequiredError) onPhoneSteps(err.instructions);
            else onError();
          })
          .finally(() => setOpening(false));
      }}
      className="mt-3 w-full sm:w-auto"
    >
      {opening
        ? "Opening the pairing page"
        : option.connected
          ? `Re-pair ${option.label}`
          : CTA[option.id]}
    </Button>
  );
}

export default function SensorStep({
  view,
  onSkip,
}: {
  view: CharacterView;
  onSkip?: () => void;
}) {
  const whoopConnected =
    view.providers?.providers.some((p) => p.id === "whoop" && p.connected) ??
    false;
  return (
    <div className="space-y-3">
      <WhoopReturnNote whoopConnected={whoopConnected} />
      <SensorStepBody view={view} onSkip={onSkip} />
    </div>
  );
}

function SensorStepBody({
  view,
  onSkip,
}: {
  view: CharacterView;
  onSkip?: () => void;
}) {
  const queryClient = useQueryClient();
  const [phoneSteps, setPhoneSteps] = useState<string | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const address = view.address;
  if (address === null) return null;

  const recheck = () => {
    void queryClient.invalidateQueries({ queryKey: ["wearable-providers"] });
    void queryClient.invalidateQueries({ queryKey: ["wearable-progress"] });
  };

  const sensor = view.sensor;

  if (sensor.kind === "loading") {
    return <p className="text-sm text-muted" aria-live="polite">Looking at your wearable</p>;
  }

  if (sensor.kind === "unchecked") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground/80">
          Sign once so I can see which wearable you have paired and what it
          measures. Free, no transaction, and it covers every run.
        </p>
        <Button
          type="button"
          pop
          disabled={view.checkingSensor}
          onClick={() => {
            void view.checkSensor().then((ok) => setDeclined(!ok));
          }}
        >
          {view.checkingSensor ? "Waiting for your signature" : "Check my wearable"}
        </Button>
        {declined ? (
          <p className="text-sm text-muted" aria-live="polite">
            No signature, so I still cannot see it. Tap again when you are ready.
          </p>
        ) : null}
        {onSkip !== undefined ? (
          <button type="button" onClick={onSkip} className={`-ml-4 text-muted underline underline-offset-2 hover:text-foreground ${TAP_TARGET}`}>
            Skip for now
          </button>
        ) : null}
      </div>
    );
  }

  if (sensor.kind === "unavailable") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground/80">
          The wearable check is not answering right now, so I cannot pair
          anything this minute. Your runs stay locked until it is back.
        </p>
        <Button type="button" variant="secondary" onClick={recheck}>
          Try the wearable check again
        </Button>
        {onSkip !== undefined ? (
          <button type="button" onClick={onSkip} className={`-ml-4 text-muted underline underline-offset-2 hover:text-foreground ${TAP_TARGET}`}>
            Skip for now
          </button>
        ) : null}
      </div>
    );
  }

  const allOptions = view.providers?.providers ?? [];
  const offered = allOptions.filter((p) => p.configured);
  // Apple is listed by the server and switched off until the iPhone app
  // ships. Said plainly, so an Apple Watch wearer is not left wondering.
  const appleNotYet = allOptions.some((p) => p.id === "apple" && !p.configured);
  const hold = capabilityHoldOf(view.providers);
  const holdLabel =
    allOptions.find((p) => p.id === view.providers?.selected)?.label ??
    "Your wearable";
  const paired = sensor.kind === "paired" ? sensor.device : null;
  const cannot =
    paired !== null
      ? WEARABLE_METRICS.filter((m) => !paired.metrics.includes(m)).map(metricLabel)
      : [];

  return (
    <div className="space-y-4">
      {paired !== null ? (
        <div className="rounded-2xl border-2 border-accent-deep bg-surface p-4" aria-live="polite">
          <p className="font-semibold">{paired.label} is paired</p>
          <p className="mt-1 text-sm">
            Measures: {paired.metrics.map((m) => metricLabel(m as WearableMetric)).join(", ")}.
          </p>
          {cannot.length > 0 ? (
            <p className="mt-1 text-sm text-foreground/80">
              Cannot measure: {cannot.join(", ")}. Runs scored on those show as
              locked for you in the lobby, before you stake anything.
            </p>
          ) : null}
        </div>
      ) : hold === "awaiting-sync" ? (
        <div className="rounded-2xl border border-warning/50 bg-warning/5 p-4" aria-live="polite">
          <p className="font-semibold text-warning">
            {holdLabel} is linked. Waiting on its first sync
          </p>
          <p className="mt-1 text-sm text-foreground/80">
            Nothing has come through from your device yet, so I cannot tell
            what it measures. Open your wearable&apos;s own app so it syncs,
            then check again. Wearable runs stay locked until I can see it, so
            you never stake on one your device cannot prove.
          </p>
        </div>
      ) : sensor.kind === "unreadable" ? (
        <div className="rounded-2xl border border-warning/50 bg-warning/5 p-4">
          <p className="font-semibold text-warning">
            {sensor.label} is linked and I cannot read it right now
          </p>
          <p className="mt-1 text-sm text-foreground/80">
            Wearable runs stay locked until I can see what it measures. Nothing
            to do on your side; check back shortly.
          </p>
        </div>
      ) : (
        <p className="text-sm text-foreground/80">
          I pay on what your wearable reports, so pick the one you wear. Each
          option says what it can measure.
        </p>
      )}

      {offered.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-surface-raised p-4 text-sm text-foreground/80">
          No wearable pairing is switched on for this build yet, so wearable
          runs stay locked. You can still browse the lobby.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {offered.map((option) => (
            <li key={option.id} className="rounded-2xl border border-edge bg-surface p-4">
              <p className="font-semibold">
                {option.label}
                {option.connected ? (
                  <span className="ml-2 text-xs font-bold text-accent-deep">Paired</span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-muted">{BLURB[option.id]}</p>
              <p className="mt-2 text-sm">{measuresLine(option)}</p>
              <PairButton
                address={address}
                option={option}
                onPhoneSteps={setPhoneSteps}
                onBlocked={setBlockedUrl}
                onError={() => setFailed(true)}
              />
            </li>
          ))}
        </ul>
      )}

      {appleNotYet ? (
        <p className="text-sm text-muted">
          Apple Watch or iPhone only? The GoHealthMe iPhone app is not out yet
          in this beta, so Apple Health cannot pair here. If you also wear a
          WHOOP, Oura, Fitbit or Garmin, pair that instead.
        </p>
      ) : null}

      {allOptions
        .filter((p) => !p.configured && p.note)
        .map((p) => (
          <p key={`note-${p.id}`} className="text-sm text-muted">
            {p.note}
          </p>
        ))}
      <p className="text-sm text-muted">{COMING_LINE}</p>

      {phoneSteps !== null ? (
        <p role="status" className="rounded-2xl border border-accent-deep/40 bg-surface p-4 text-sm">
          {phoneSteps}
        </p>
      ) : null}
      {blockedUrl !== null ? (
        <a
          href={blockedUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setBlockedUrl(null)}
          className={`rounded-[18px] border-2 border-foreground font-bold ${TAP_TARGET}`}
        >
          Your browser blocked the pairing window. Open it here
        </a>
      ) : null}
      {failed ? (
        <p role="alert" className="rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm">
          The pairing page would not open. Nothing was linked and nothing was
          charged. Try again in a moment.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {offered.length > 0 ? (
          <Button type="button" variant="secondary" onClick={recheck}>
            I paired it, check again
          </Button>
        ) : null}
        {onSkip !== undefined ? (
          <button type="button" onClick={onSkip} className={`text-muted underline underline-offset-2 hover:text-foreground ${TAP_TARGET}`}>
            {paired !== null ? "Done" : "Skip for now"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
