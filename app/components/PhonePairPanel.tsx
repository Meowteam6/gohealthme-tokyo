"use client";

// What a player sees after choosing a wearable that pairs from a phone app
// (Apple Health). Guidance, not an error: they did nothing wrong and there is
// no page for this browser to open. The code is the whole handoff: the phone
// app redeems it once and from then on syncs for this wallet.

import type { PhonePairing } from "@/lib/wearable-connect";

export interface PhoneSteps {
  instructions: string;
  pairing: PhonePairing | null;
  installUrl: string | null;
}

export default function PhonePairPanel({ steps }: { steps: PhoneSteps }) {
  const { instructions, pairing, installUrl } = steps;
  const expires =
    pairing === null
      ? null
      : new Date(pairing.expiresAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm"
    >
      <p>{instructions}</p>
      {pairing !== null ? (
        <>
          <p
            className="mt-3 select-all text-center font-mono text-3xl font-bold tracking-[0.2em]"
            aria-label={`Pairing code ${pairing.code.split("").join(" ")}`}
          >
            {pairing.code}
          </p>
          <p className="mt-1 text-center text-muted">
            Works once, until {expires}. Tap the button again for a new code.
          </p>
          {/* On the iPhone itself the code does not need typing. On a
              computer this link does nothing, so it is phrased for the phone. */}
          <a
            href={pairing.deepLink}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border-2 border-foreground px-5 py-2.5 font-semibold sm:hidden"
          >
            On this iPhone? Open the GoHealthMe app
          </a>
        </>
      ) : null}
      {installUrl !== null ? (
        <p className="mt-3">
          No app yet?{" "}
          <a href={installUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            Get GoHealthMe for iPhone
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
