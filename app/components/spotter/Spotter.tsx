import type { CSSProperties } from "react";
import Image from "next/image";
import {
  poseFor,
  poseMeta,
  spotterSrc,
  toNightPose,
  type SpotterPose,
  type SpotterScreenState,
  type SpotterSize,
  type StageWidth,
} from "@/lib/spotter-poses";
import SpotterCaption from "@/components/spotter/SpotterCaption";

// SPOTTER, drawn once (docs/DESIGN.md, "SPOTTER on a night field"). Every otter
// in the product renders through here: the relit night art, the alt text and
// the contact shadow read as one character. Screens pass a `state` (lib/
// spotter-poses.ts picks pose and staged width) or a `pose`. To stand him on a
// card's top edge, wrap the card in <Perch>. Server-safe: no client state.

/** Fixed widths in px for the older `size` names. */
const SIZE_PX: Record<Exclude<SpotterSize, "hero">, number> = {
  row: 40,
  inline: 48,
  xs: 72,
  sm: 96,
  md: 132,
  lg: 176,
};

/** `size="hero"` is the landing sleeper: 176px on a phone, 280px from 900px. */
const HERO_WIDTH: StageWidth = [176, 280];

type PoseOrState =
  | { pose: SpotterPose; state?: never }
  | { state: SpotterScreenState; pose?: never };

export type SpotterProps = PoseOrState & {
  /** A fixed older size. Ignored when `width` is given. */
  size?: SpotterSize;
  /** Width in px: one number, or [phone, from 900px]. Overrides `size` and the
   *  state's staged width. */
  width?: number | StageWidth;
  /** One line from SPOTTER, in his caption box beside or under him. */
  line?: string;
  /** Where the caption sits: under him (default), or beside him. */
  linePlacement?: "below" | "side" | "above";
  /** Announce a line that changes after an action. */
  live?: boolean;
  /** Pure decoration: empty alt, hidden from the accessibility tree. */
  decorative?: boolean;
  /** Replaces the pose's default alt text. */
  alt?: string;
  /** Preload: pass for the hero otter that is the page's largest image. */
  priority?: boolean;
  /** The soft shadow under his feet. On by default. */
  contact?: boolean;
  /** The slow sleeping breath. On by default for the sleep pose only. */
  breathe?: boolean;
  className?: string;
};

export function stageWidth(
  width: number | StageWidth | undefined,
  size: SpotterSize | undefined,
  staged: StageWidth | undefined,
): StageWidth {
  if (typeof width === "number") return [width, width];
  if (width !== undefined) return width;
  if (size === "hero") return HERO_WIDTH;
  if (size !== undefined) return [SIZE_PX[size], SIZE_PX[size]];
  if (staged !== undefined) return staged;
  return [SIZE_PX.md, SIZE_PX.md];
}

/** The CSS variables a staged figure reads (see .night-figure in globals.css). */
export function stageVars([phone, wide]: StageWidth): CSSProperties {
  return { "--sw-sm": `${phone}px`, "--sw-lg": `${wide}px` } as CSSProperties;
}

/** Just the figure: the art and its contact shadow, sized by the stage vars. */
export function SpotterFigure({
  pose,
  width,
  decorative = false,
  alt,
  priority = false,
  contact = true,
  breathe,
  className = "",
}: {
  pose: SpotterPose;
  width: StageWidth;
  decorative?: boolean;
  alt?: string;
  priority?: boolean;
  contact?: boolean;
  breathe?: boolean;
  className?: string;
}) {
  const meta = poseMeta(pose);
  const sleeping = breathe ?? toNightPose(pose) === "sleep";
  return (
    <span className={`night-figure block ${className}`} style={stageVars(width)}>
      <Image
        src={spotterSrc(pose)}
        width={meta.width}
        height={meta.height}
        alt={decorative ? "" : (alt ?? meta.alt)}
        aria-hidden={decorative ? true : undefined}
        sizes={`${Math.max(width[0], width[1])}px`}
        priority={priority}
        className={`block h-auto w-full ${sleeping ? "animate-breathe" : ""}`}
      />
      {contact ? <span aria-hidden="true" className="night-contact" /> : null}
    </span>
  );
}

export default function Spotter(props: SpotterProps) {
  const resolved =
    props.state !== undefined ? poseFor(props.state) : { pose: props.pose, width: undefined };
  const width = stageWidth(props.width, props.size, resolved.width);
  const figure = (
    <SpotterFigure
      pose={resolved.pose}
      width={width}
      decorative={props.decorative}
      alt={props.alt}
      priority={props.priority}
      contact={props.contact}
      breathe={props.breathe}
    />
  );

  if (props.line === undefined || props.line === "") {
    return <span className={`inline-flex ${props.className ?? ""}`}>{figure}</span>;
  }

  const placement = props.linePlacement ?? "below";
  const layout =
    placement === "side"
      ? "flex-row items-end gap-3"
      : placement === "above"
        ? "flex-col-reverse items-start gap-3"
        : "flex-col items-start gap-3";
  return (
    <div className={`flex ${layout} ${props.className ?? ""}`}>
      {figure}
      <SpotterCaption line={props.line} live={props.live === true} className="max-w-xs" />
    </div>
  );
}
