"use client";

// The night stage (docs/DESIGN.md, landing hero): the moon behind the run
// card and SPOTTER on its top edge, staged for the run the card features. On a
// sleep run he sleeps in front of the moon; tap him once and he wakes, waves
// and says his one line. On a workout or steps run he is already up, pointing
// at his wearable, and the moon dims behind him: a sleeping otter on a workout
// card says the wrong thing. A tap there brings up the same line. One pose on
// screen at a time: the sleeper hides when the waver shows.

import { useState, type CSSProperties, type ReactNode } from "react";
import Moon from "@/components/spotter/Moon";
import { SpotterFigure, stageVars } from "@/components/spotter/Spotter";
import { FOCUS_RING } from "@/components/ui";
import type { RunKind } from "@/lib/game/landing";
import { poseFor, poseMeta } from "@/lib/spotter-poses";

const LINE = "I watch your wearable, not your wallet.";

/** The awake pose's width: the run page's "wearable" staging on a phone, and
 *  a desktop width whose height matches the sleeper's, so the hero keeps its
 *  shape whichever run it features. */
const AWAKE_WIDTH = [96, 150] as const;

const CAPTION =
  "pointer-events-none absolute z-[4] m-0 max-w-[190px] rounded-control bg-surface-raised px-3 py-2.5 text-sm leading-[1.35] text-foreground shadow-[inset_0_0_0_1px_var(--border-strong),0_12px_24px_-12px_rgba(0,0,0,0.6)] transition-[opacity,transform] duration-[160ms] ease-out min-[900px]:max-w-[220px] min-[900px]:text-[0.9375rem]";

export default function HeroStage({
  children,
  kind = null,
  woke: initiallyWoke = false,
}: {
  /** The run card he stands on. */
  children: ReactNode;
  /** What the featured run is scored on; null while it reads (the sleeper,
   *  the same tie-break the featured pick uses). */
  kind?: RunKind | null;
  /** Start awake (the state gallery). */
  woke?: boolean;
}) {
  const [woke, setWoke] = useState(initiallyWoke);
  const night = kind === null || kind === "sleep" || kind === "other";
  const sleep = poseFor("landing-hero");
  const wave = poseFor("landing-woke");
  const awake = poseFor("run-open");
  const pose = night ? sleep.pose : awake.pose;
  const width = night ? (sleep.width ?? ([176, 280] as const)) : AWAKE_WIDTH;
  const ratio = poseMeta(pose).height / poseMeta(pose).width;

  const perch = {
    ...stageVars(width),
    "--perch-ratio": ratio.toFixed(4),
    "--perch-overlap": "6px",
    "--perch-reserve-sm": "initial",
    "--perch-reserve-lg": "initial",
  } as CSSProperties;

  return (
    <div className="relative mt-[18px] min-[900px]:mt-0">
      {/* Dimmed behind an awake SPOTTER: the one warm light stays, and the
          run on the card is a day run. */}
      <div className={night ? undefined : "opacity-40"}>
        <Moon className="absolute left-[calc(50%-16px)] top-0.5 z-0 min-[900px]:left-auto min-[900px]:right-[-8px] min-[900px]:top-[-18px]" />
      </div>
      <div className="night-perch" style={perch}>
        <button
          type="button"
          onClick={() => setWoke(true)}
          aria-label={night ? (woke ? "SPOTTER, awake" : "Wake SPOTTER") : "SPOTTER"}
          aria-describedby="spotter-says"
          className={`night-figure cursor-pointer rounded-[20px] border-0 bg-transparent p-0 [-webkit-tap-highlight-color:transparent] ${
            night ? "left-1.5 min-[900px]:left-[18px]" : "left-4 min-[900px]:left-7"
          } ${FOCUS_RING}`}
          style={stageVars(width)}
        >
          {night ? (
            <>
              <span className={woke ? "invisible block" : "block"}>
                <SpotterFigure pose={sleep.pose} width={width} decorative priority />
              </span>
              {woke ? (
                <span className="absolute bottom-0 left-[34%] block -translate-x-1/2">
                  <SpotterFigure pose={wave.pose} width={wave.width ?? [74, 118]} decorative />
                </span>
              ) : null}
            </>
          ) : (
            <SpotterFigure pose={awake.pose} width={width} decorative priority />
          )}
        </button>
        <p
          id="spotter-says"
          role="status"
          aria-live="polite"
          className={`${CAPTION} ${
            night
              ? "left-[calc(6px+var(--sw)*0.6)] top-[calc(var(--sw)*0.726-106px)] min-[900px]:left-[calc(18px+var(--sw)*0.6)] min-[900px]:top-[calc(var(--sw)*0.726-156px)]"
              : "left-[calc(16px+var(--sw)+10px)] top-[calc(var(--perch-pad)-96px)] min-[900px]:left-[calc(28px+var(--sw)+14px)] min-[900px]:top-[calc(var(--perch-pad)-112px)]"
          } ${woke ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
        >
          {woke ? (
            <>
              <span className="mb-0.5 block text-xs font-semibold text-haze">
                SPOTTER<span className="sr-only"> says:</span>
              </span>
              {LINE}
            </>
          ) : null}
        </p>
        {children}
      </div>
    </div>
  );
}
