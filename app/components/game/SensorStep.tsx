"use client";

// Character creation step 4: pair your sensor. This is where the join gate's
// capability probe now happens, once, instead of at every pool: the result
// says what this device can and cannot measure, from the same provider read
// lib/wearable-join-gate.ts uses. A WHOOP player learns "no step count" here,
// not after a stake on a steps run.

import { countsLine, pairedDeviceName, providerCardLabel } from "@/lib/game/sensor-copy";
import { COMING_LINE, LAUNCH_METRICS } from "@/lib/provider-capabilities";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, buttonClasses } from "@/components/ui";
import { Notice, QUIET_ACTION } from "@/components/night/kit";
import WhoopReturnNote from "@/components/WhoopReturnNote";
import { useWalletAuth } from "@/lib/useWalletAuth";
import {
  PhoneLinkRequiredError,
  PopupBlockedError,
  capabilityHoldOf,
  currentReturnPath,
  phonePairingOf,
  startWearableLink,
  type ProviderOption,
  type WearableProviderId,
} from "@/lib/wearable-connect";
import PhonePairPanel, { type PhoneSteps } from "@/components/PhonePairPanel";
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
  apple: "Apple Watch and iPhone. Sleep and workouts, read on your phone.",
};

const CTA: Record<WearableProviderId, string> = {
  junction: "Pair with Junction",
  whoop: "Pair my WHOOP",
  apple: "Pair my Apple Watch",
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
  onPhoneSteps: (steps: PhoneSteps) => void;
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
            else if (err instanceof PhoneLinkRequiredError)
              onPhoneSteps({ instructions: err.instructions, pairing: err.pairing, installUrl: err.installUrl });
            else onError();
          })
          .finally(() => setOpening(false));
      }}
      size="sm"
      block
      className="mt-3"
    >
      {opening
        ? "Opening the pairing page"
        : option.connected
          ? `Re-pair ${providerCardLabel(option.id, option.label)}`
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
    <div className="[&>*+*]:mt-3">
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
  // The code the link route minted, with whether Apple was already paired at
  // that moment: a code minted for a paired wallet replaces its phone, and
  // the card must stay on screen for it instead of claiming the old pairing.
  const [phoneSteps, setPhoneSteps] = useState<{ steps: PhoneSteps; repair: boolean } | null>(null);
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
    return <p className="m-0 text-[0.9375rem] text-haze" aria-live="polite">Looking at your wearable</p>;
  }

  if (sensor.kind === "unchecked") {
    return (
      <div className="[&>*+*]:mt-3">
        <p className="m-0 text-[0.9375rem] leading-[1.5] text-muted">
          Sign once so I can see which wearable you have paired and what it
          measures. Free, no transaction, and it covers every challenge.
        </p>
        <Button
          type="button"
          disabled={view.checkingSensor}
          onClick={() => {
            void view.checkSensor().then((ok) => setDeclined(!ok));
          }}
        >
          {view.checkingSensor ? "Waiting for your signature" : "Check my wearable"}
        </Button>
        {declined ? (
          <p className="m-0 text-[0.9375rem] text-muted" aria-live="polite">
            No signature, so I still cannot see it. Tap again when you are ready.
          </p>
        ) : null}
        {onSkip !== undefined ? (
          <button type="button" onClick={onSkip} className={QUIET_ACTION}>
            Skip for now
          </button>
        ) : null}
      </div>
    );
  }

  if (sensor.kind === "unavailable") {
    return (
      <div className="[&>*+*]:mt-3">
        <Notice tone="limit" title="The wearable check is not answering">
          I cannot pair anything this minute. Your challenges stay locked until
          it is back.
        </Notice>
        <Button type="button" variant="secondary" onClick={recheck}>
          Try the wearable check again
        </Button>
        {onSkip !== undefined ? (
          <button type="button" onClick={onSkip} className={QUIET_ACTION}>
            Skip for now
          </button>
        ) : null}
      </div>
    );
  }

  const allOptions = view.providers?.providers ?? [];
  const offered = allOptions.filter((p) => p.configured);
  const hold = capabilityHoldOf(view.providers);
  const selected = view.providers?.selected ?? null;
  const active = allOptions.find((p) => p.id === selected);
  const holdLabel =
    active !== undefined ? providerCardLabel(active.id, active.label) : "Your wearable";
  const paired = sensor.kind === "paired" ? sensor.device : null;
  const cannot =
    paired !== null
      ? WEARABLE_METRICS.filter((m) => !paired.metrics.includes(m)).map(metricLabel)
      : [];
  // Once the phone has stored its first sync the paired notice above says
  // so; keeping the code card under it would show a handoff already done.
  // A re-pair is the exception: the read says paired throughout, and the
  // code is the whole point.
  const applePaired = phonePairingOf(view.providers).kind !== "unpaired";
  const showPhoneSteps = phoneSteps !== null && (phoneSteps.repair || !applePaired);

  return (
    <div className="[&>*+*]:mt-4">
      {paired !== null ? (
        <Notice tone="ok" title={`${pairedDeviceName(paired.provider, paired.label, paired.metrics)} is paired`} live>
          <p className="m-0">
            Measures {paired.metrics.map((m) => metricLabel(m as WearableMetric)).join(", ")}.
          </p>
          {cannot.length > 0 ? (
            <p className="m-0 mt-1">
              It cannot measure {cannot.join(", ")}, so challenges scored on those
              show as locked for you, before you stake anything.
            </p>
          ) : null}
        </Notice>
      ) : hold === "awaiting-sync" ? (
        <Notice tone="limit" title={`${holdLabel} is linked. Waiting on its first sync`} live>
          Nothing has come through from your device yet, so I cannot tell what
          it measures.{" "}
          {selected === "apple"
            ? "Open the GoHealthMe app on your iPhone so it syncs, or wait for its next background sync, then check again."
            : "Open your wearable's own app so it syncs, then check again."}{" "}
          Wearable challenges stay locked until I can see it, so you never
          stake on one your device cannot prove.
        </Notice>
      ) : sensor.kind === "unreadable" ? (
        <Notice tone="limit" title={`${sensor.label} is linked and I cannot read it right now`}>
          Wearable challenges stay locked until I can see what it measures.
          Nothing to do on your side; check back shortly.
        </Notice>
      ) : (
        <p className="m-0 text-[0.9375rem] leading-[1.5] text-muted">
          Challenges pay on what your wearable reports, so pick the one you
          wear. Each option says what it can measure.
        </p>
      )}

      {offered.length === 0 ? (
        <Notice tone="limit" title="No wearable pairing on this build yet">
          Wearable challenges stay locked. You can still browse them.
        </Notice>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {offered.map((option) => (
            <li
              key={option.id}
              className="flex flex-col rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border-strong)]"
            >
              <p className="m-0 flex items-center justify-between gap-2 font-semibold text-foreground">
                {providerCardLabel(option.id, option.label)}
                {option.connected ? (
                  <span className="inline-flex h-[22px] items-center rounded-tag bg-moonlight/10 px-2 text-xs font-semibold text-moonlight">
                    Paired
                  </span>
                ) : null}
              </p>
              <p className="m-0 mt-1 text-sm text-haze">{BLURB[option.id]}</p>
              <p className="m-0 mt-2 flex-1 text-sm text-muted">{measuresLine(option)}</p>
              <PairButton
                address={address}
                option={option}
                onPhoneSteps={(steps) => setPhoneSteps({ steps, repair: applePaired })}
                onBlocked={setBlockedUrl}
                onError={() => setFailed(true)}
              />
            </li>
          ))}
        </ul>
      )}

      {allOptions
        .filter((p) => !p.configured && p.note)
        .map((p) => (
          <p key={`note-${p.id}`} className="m-0 text-[0.8125rem] text-haze">
            {p.note}
          </p>
        ))}
      <p className="m-0 text-[0.8125rem] text-haze">{COMING_LINE}</p>

      {showPhoneSteps ? (
        <PhonePairPanel steps={phoneSteps.steps} address={address} repair={phoneSteps.repair} />
      ) : null}
      {blockedUrl !== null ? (
        <a
          href={blockedUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setBlockedUrl(null)}
          className={buttonClasses({ variant: "secondary", size: "sm", block: true })}
        >
          Your browser blocked the pairing window. Open it here
        </a>
      ) : null}
      {failed ? (
        <Notice tone="error">
          The pairing page would not open. Nothing was linked and nothing was
          charged. Try again in a moment.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {offered.length > 0 ? (
          <Button type="button" variant="secondary" size="sm" onClick={recheck}>
            I paired it, check again
          </Button>
        ) : null}
        {onSkip !== undefined ? (
          <button type="button" onClick={onSkip} className={QUIET_ACTION}>
            {paired !== null ? "Done" : "Skip for now"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
