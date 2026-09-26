import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import SpotterCaption from "@/components/spotter/SpotterCaption";

// Your night (docs/DESIGN.md, "Your night card"): SPOTTER's one line keyed to
// the paired wearable, then a proportional rail from now to the run's close.
// On an hours-of-sleep run the moonlit block is the sleep that has to fit
// before the close, so "latest asleep" is a real time, not a slogan. Any
// other run (a workout, or a night that no longer fits) fills the whole rail
// with the time left, so the rail never reads as a chart that failed to load;
// before the clock is read it is left out. Server-safe; the caller ticks it.

export interface NightRail {
  /** 0 to 100: where the sleep block starts on the rail. */
  latestPct: number;
  /** "01:30". */
  latestLabel: string;
  /** "7h", printed on the block. */
  blockLabel: string;
}

export default function YourNight({
  title = "Your night",
  nowLabel,
  caption,
  captionLive = false,
  endLabel,
  rail,
  left = null,
  railLabel,
  note,
  children,
}: {
  title?: string;
  /** "Now 15:49", or null before the clock is read. */
  nowLabel: string | null;
  caption: string;
  /** Announce the caption when it changes (after joining). */
  captionLive?: boolean;
  /** "08:30": when the run closes. */
  endLabel: string;
  /** The sleep block, or null for a run that is not about hours of sleep. */
  rail: NightRail | null;
  /** "9h 48m": the time left to the close, the fill when there is no sleep
   *  block. Null (clock unread) leaves the rail out. */
  left?: string | null;
  /** What the rail shows, for screen readers. */
  railLabel: string;
  note: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card as="section" aria-labelledby="night-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="night-h" className="m-0 text-[1.0625rem] font-semibold">
          {title}
        </h2>
        {nowLabel !== null ? <span className="num text-sm text-haze">{nowLabel}</span> : null}
      </div>
      <SpotterCaption line={caption} live={captionLive} className="mt-3.5" />
      {rail !== null || left !== null ? (
        <>
          <div role="img" aria-label={railLabel} className="relative mt-6 h-11">
            <span className="absolute inset-x-0 top-[18px] h-2 rounded bg-fill-quiet-hover" />
            <span
              className={`num absolute right-0 top-3 grid h-5 place-items-center rounded-md text-xs font-bold text-ink ${
                rail !== null
                  ? "bg-[linear-gradient(180deg,var(--moonlight),color-mix(in_srgb,var(--moonlight)_82%,var(--gold)))] shadow-[0_0_18px_color-mix(in_srgb,var(--moonlight)_35%,transparent)]"
                  : "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--moonlight)_92%,transparent),color-mix(in_srgb,var(--moonlight)_72%,var(--surface)))]"
              }`}
              style={{ left: rail !== null ? `${rail.latestPct}%` : "0%" }}
            >
              {rail !== null ? rail.blockLabel : `${left} left`}
            </span>
            <span className="absolute left-0 top-2 h-7 w-0.5 rounded-[1px] bg-foreground" />
            <span className="absolute right-0 top-2 h-7 w-0.5 rounded-[1px] bg-muted" />
          </div>
          <div aria-hidden="true" className="num relative h-[38px] text-[0.8125rem] leading-[1.25] text-haze [&_b]:block [&_b]:font-semibold [&_b]:text-foreground">
            <span className="absolute left-0 top-0 whitespace-nowrap">Now</span>
            {rail !== null && rail.latestPct > 14 && rail.latestPct < 80 ? (
              <span
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-center"
                style={{ left: `${rail.latestPct}%` }}
              >
                <b>{rail.latestLabel}</b>latest asleep
              </span>
            ) : null}
            <span className="absolute right-0 top-0 whitespace-nowrap text-right">
              <b>{endLabel}</b>run closes
            </span>
          </div>
        </>
      ) : null}
      <p
        className={`m-0 text-[0.9375rem] leading-[1.45] text-muted [&_b]:font-semibold [&_b]:text-foreground ${
          rail !== null || left !== null ? "mt-2" : "mt-3.5"
        }`}
      >
        {note}
      </p>
      {children}
    </Card>
  );
}
