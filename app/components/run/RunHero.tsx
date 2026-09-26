import type { CSSProperties, ReactNode } from "react";
import { Tag, type TagTone } from "@/components/ui";
import { SpotterFigure } from "@/components/spotter/Spotter";
import { poseFor, type SpotterScreenState } from "@/lib/spotter-poses";

// The run page's hero (docs/DESIGN.md, "Run page"): a tag, the one big figure
// in Figtree with its line in Fraunces, the live end time, and SPOTTER standing
// at the right, his feet on the edge of the card below. One pose per viewport:
// the paid verdict hides him here because he stands on the receipt instead.
// Server-safe; the caller passes the live clock in `ends`.

/**
 * The big figure's size: 60px on a phone and 112px from 960px, shrunk only as
 * far as it takes to keep a long figure ("8,000 steps") on one line beside
 * SPOTTER, so a number never breaks away from its unit. Figtree bold runs
 * about 0.56em a character at this tracking.
 */
function figureSize(figure: string, roomPhone: number, roomWide: number): CSSProperties {
  const n = (Math.max(figure.length, 7) * 0.56).toFixed(2);
  return {
    "--fig-sm": `min(3.75rem, calc((100vw - ${32 + roomPhone}px) / ${n}))`,
    // The left column from 960px: the page's 1200px less its gutters, the
    // 420px stake column and the 48px gap between them.
    "--fig-lg": `min(7rem, calc((min(100vw, 75rem) - ${64 + 468 + roomWide}px) / ${n}))`,
  } as CSSProperties;
}

export interface RunHeroProps {
  tag: { tone: TagTone; label: string };
  /** "7 hours", or null for a goal with no number (the title is the H1). */
  figure: string | null;
  /** "of sleep, Saturday night", or the goal text when there is no figure. */
  rest: string;
  /** "Ends <b>Sun 08:30</b>, in 16h 40m". */
  ends: ReactNode;
  /** The money chips beside the tag (what kind of run, what a miss does). */
  chips?: ReactNode;
  /** SPOTTER's staged state, or null to leave him off this viewport. */
  spotter: SpotterScreenState | null;
  /** The pose's alt text when it carries meaning; decorative otherwise. */
  spotterAlt?: string;
  headingId?: string;
}

export default function RunHero({
  tag,
  figure,
  rest,
  ends,
  chips,
  spotter,
  spotterAlt,
  headingId = "run-goal",
}: RunHeroProps) {
  const staged = spotter !== null ? poseFor(spotter) : null;
  // The sleeping pose lies down: wider, so the words give it more room.
  const lying = staged?.pose === "sleep";
  const room =
    spotter === null
      ? ""
      : lying
        ? "max-w-[calc(100%-128px)] min-[900px]:max-w-[calc(100%-260px)]"
        : "max-w-[calc(100%-104px)] min-[900px]:max-w-[calc(100%-200px)]";
  return (
    <section
      aria-labelledby={headingId}
      className="relative pt-1 [grid-area:hero] min-[900px]:min-h-[250px] min-[960px]:min-h-[312px] min-[960px]:pt-3"
    >
      {chips !== undefined && chips !== null ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone={tag.tone}>{tag.label}</Tag>
          {chips}
        </div>
      ) : (
        <Tag tone={tag.tone}>{tag.label}</Tag>
      )}
      <h1 id={headingId} className={`m-0 mt-2.5 ${room}`}>
        {figure !== null ? (
          <>
            <span
              className="num block whitespace-nowrap font-sans text-[length:var(--fig-sm)] font-bold leading-[0.95] tracking-[-0.035em] [font-variant-numeric:lining-nums_proportional-nums] min-[960px]:text-[length:var(--fig-lg)]"
              style={figureSize(
                figure,
                spotter === null ? 0 : lying ? 128 : 104,
                spotter === null ? 0 : lying ? 260 : 200,
              )}
            >
              {figure}
            </span>
            <span className="type-heading mt-2 block text-[1.375rem] leading-[1.15] min-[960px]:mt-2.5 min-[960px]:text-[2.125rem]">
              {rest}
            </span>
          </>
        ) : (
          <span className="type-display block break-words text-[2.5rem] min-[960px]:text-[4rem]">
            {rest}
          </span>
        )}
      </h1>
      <p
        className={`num m-0 mt-2 pb-[18px] text-[0.9375rem] text-muted min-[960px]:mt-3.5 min-[960px]:pb-9 min-[960px]:text-[1.0625rem] [&_b]:font-semibold [&_b]:text-foreground ${room}`}
      >
        {ends}
      </p>
      {staged !== null && staged.width !== undefined ? (
        <span
          className={`pointer-events-none absolute z-[3] ${
            lying
              ? "-right-1 bottom-[-8px] min-[900px]:right-6 min-[900px]:bottom-[-10px]"
              : "right-0.5 bottom-[-6px] min-[900px]:right-14 min-[900px]:bottom-[-10px]"
          }`}
        >
          <SpotterFigure
            pose={staged.pose}
            width={staged.width}
            decorative={spotterAlt === undefined}
            alt={spotterAlt}
            priority
          />
        </span>
      ) : null}
    </section>
  );
}
