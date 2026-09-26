import type { ReactNode } from "react";
import Spotter from "@/components/spotter/Spotter";
import {
  SPOTTER_BACKDROP_SRC,
  asSpotterPose,
  type SpotterPose,
} from "@/lib/spotter-poses";

// SPOTTER's riverbank behind a screen title (docs/DESIGN.md). The otter stands
// in the grass doing something relevant to the page; he shows on phones too,
// smaller, because the mascot is the layout. The backdrop is decoration.
export default function SceneHeader({
  title,
  subtitle,
  pose,
  poseAlt,
  eyebrow,
  spotterLine,
  children,
}: {
  title: string;
  subtitle?: string;
  /** A pose name ("greet") or a legacy file name ("spotter-greet.webp"). */
  pose: SpotterPose | string;
  poseAlt: string;
  /** A short sentence-case context line above the title. */
  eyebrow?: string;
  /** A deadpan SPOTTER line, in his speech bubble beside the otter. */
  spotterLine?: string;
  children?: ReactNode;
}) {
  const resolved: SpotterPose = asSpotterPose(pose) ?? "standing";
  return (
    <section className="relative overflow-hidden rounded-3xl border border-edge bg-surface-raised">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={SPOTTER_BACKDROP_SRC}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-bottom"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-surface-raised/90 via-surface-raised/55 to-transparent"
      />

      <div className="relative z-10 flex min-h-[13rem] items-end justify-between gap-3 px-5 pt-7 sm:min-h-[16rem] sm:px-9">
        <div className="min-w-0 max-w-md pb-7 sm:pb-8">
          {eyebrow !== undefined ? (
            <p className="text-sm font-bold text-accent-deep">{eyebrow}</p>
          ) : null}
          <h1 className="mt-1 break-words font-display text-[2rem] font-extrabold leading-display tracking-display sm:text-[2.5rem]">
            {title}
          </h1>
          {subtitle !== undefined ? (
            <p className="mt-2 text-base leading-relaxed text-foreground/80">
              {subtitle}
            </p>
          ) : null}
          {children}
        </div>
        <div className="-mb-1 shrink-0 self-end md:hidden">
          <Spotter pose={resolved} size="xs" alt={poseAlt} />
        </div>
        <div className="-mb-1 hidden shrink-0 self-end md:block">
          <Spotter
            pose={resolved}
            size="lg"
            alt={poseAlt}
            line={spotterLine}
            linePlacement="side"
          />
        </div>
      </div>
    </section>
  );
}
