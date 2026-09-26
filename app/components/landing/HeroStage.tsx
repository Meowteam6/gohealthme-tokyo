"use client";

// The night stage (docs/DESIGN.md, landing hero): the moon behind the run
// card, SPOTTER asleep on its top edge. Tap him once and he wakes, waves and
// says his one line; after that he stays awake for the visit. One pose on
// screen at a time: the sleeper hides when the waver shows.

import { useState, type CSSProperties, type ReactNode } from "react";
import Moon from "@/components/spotter/Moon";
import { SpotterFigure, stageVars } from "@/components/spotter/Spotter";
import { FOCUS_RING } from "@/components/ui";
import { poseFor, poseMeta } from "@/lib/spotter-poses";

const LINE = "I watch your wearable, not your wallet.";

export default function HeroStage({
  children,
  woke: initiallyWoke = false,
}: {
  /** The run card he sleeps on. */
  children: ReactNode;
  /** Start awake (the state gallery). */
  woke?: boolean;
}) {
  const [woke, setWoke] = useState(initiallyWoke);
  const sleep = poseFor("landing-hero");
  const wave = poseFor("landing-woke");
  const width = sleep.width ?? ([176, 280] as const);
  const ratio = poseMeta(sleep.pose).height / poseMeta(sleep.pose).width;

  const perch = {
    ...stageVars(width),
    "--perch-ratio": ratio.toFixed(4),
    "--perch-overlap": "6px",
    "--perch-reserve-sm": "initial",
    "--perch-reserve-lg": "initial",
  } as CSSProperties;

  return (
    <div className="relative mt-[18px] min-[900px]:mt-0">
      <Moon className="absolute left-[calc(50%-16px)] top-0.5 z-0 min-[900px]:left-auto min-[900px]:right-[-8px] min-[900px]:top-[-18px]" />
      <div className="night-perch" style={perch}>
        <button
          type="button"
          onClick={() => setWoke(true)}
          aria-label={woke ? "SPOTTER, awake" : "Wake SPOTTER"}
          aria-describedby="spotter-says"
          className={`night-figure left-1.5 cursor-pointer rounded-[20px] border-0 bg-transparent p-0 [-webkit-tap-highlight-color:transparent] min-[900px]:left-[18px] ${FOCUS_RING}`}
          style={stageVars(width)}
        >
          <span className={woke ? "invisible block" : "block"}>
            <SpotterFigure pose={sleep.pose} width={width} decorative priority />
          </span>
          {woke ? (
            <span className="absolute bottom-0 left-[34%] block -translate-x-1/2">
              <SpotterFigure pose={wave.pose} width={wave.width ?? [74, 118]} decorative />
            </span>
          ) : null}
        </button>
        <p
          id="spotter-says"
          role="status"
          aria-live="polite"
          className={`pointer-events-none absolute z-[4] m-0 max-w-[190px] rounded-control bg-surface-raised px-3 py-2.5 text-sm leading-[1.35] text-foreground shadow-[inset_0_0_0_1px_var(--border-strong),0_12px_24px_-12px_rgba(0,0,0,0.6)] transition-[opacity,transform] duration-[160ms] ease-out min-[900px]:max-w-[220px] min-[900px]:text-[0.9375rem] left-[calc(6px+var(--sw)*0.6)] top-[calc(var(--sw)*0.726-106px)] min-[900px]:left-[calc(18px+var(--sw)*0.6)] min-[900px]:top-[calc(var(--sw)*0.726-156px)] ${
            woke ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
          }`}
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
