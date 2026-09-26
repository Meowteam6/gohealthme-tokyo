import Image from "next/image";
import {
  POSE_META,
  poseFor,
  spotterSrc,
  type SpotterPose,
  type SpotterScreenState,
  type SpotterSize,
} from "@/lib/spotter-poses";

// SPOTTER, drawn once. Every otter in the product renders through here so the
// art, the alt text and the speech bubble read as one character (docs/DESIGN.md).
// Screens pass a `state` (lib/spotter-poses.ts picks pose and size) or, for a
// one-off, a `pose`. Server-safe: no client state.

/** Width in px for the width-driven sizes; `hero` is height-driven. */
const WIDTH_PX: Record<Exclude<SpotterSize, "hero">, number> = {
  row: 40,
  inline: 48,
  xs: 72,
  sm: 120,
  md: 160,
  lg: 200,
};

const HERO_SIZES = "(max-width: 640px) 80vw, 480px";

type PoseOrState =
  | { pose: SpotterPose; state?: never }
  | { state: SpotterScreenState; pose?: never };

export type SpotterProps = PoseOrState & {
  /** Overrides the state's size. Default "md" for a bare pose. */
  size?: SpotterSize;
  /** One deadpan line, drawn in Patrick Hand in a speech bubble. */
  line?: string;
  /** Bubble above the otter (default) or beside it. */
  linePlacement?: "above" | "side";
  /** Announce a line that changes after an action. */
  live?: boolean;
  /** Pure decoration: empty alt, hidden from the accessibility tree. */
  decorative?: boolean;
  /** Replaces the pose's default alt text. */
  alt?: string;
  /** Preload: pass for the hero otter that is the page's largest image. */
  priority?: boolean;
  className?: string;
};

export default function Spotter(props: SpotterProps) {
  const resolved =
    props.state !== undefined
      ? poseFor(props.state)
      : { pose: props.pose, size: "md" as SpotterSize };
  const pose = resolved.pose;
  const size = props.size ?? resolved.size;
  const meta = POSE_META[pose];
  const alt = props.decorative === true ? "" : (props.alt ?? meta.alt);
  const placement = props.linePlacement ?? "above";

  const isHero = size === "hero";
  const px = isHero ? null : WIDTH_PX[size];
  const imageClass = isHero
    ? "h-[min(60vh,34rem)] w-auto max-w-full object-contain"
    : "h-auto w-full";
  const frame = meta.opaque
    ? "overflow-hidden rounded-2xl border border-edge bg-surface-raised"
    : "";

  const figure = (
    <div
      className={`shrink-0 ${frame}`}
      style={px !== null ? { width: px } : undefined}
    >
      <Image
        src={spotterSrc(pose)}
        width={meta.width}
        height={meta.height}
        alt={alt}
        aria-hidden={props.decorative === true ? true : undefined}
        sizes={px !== null ? `${px}px` : HERO_SIZES}
        priority={props.priority}
        className={imageClass}
      />
    </div>
  );

  if (props.line === undefined || props.line === "") {
    return <div className={`inline-flex ${props.className ?? ""}`}>{figure}</div>;
  }

  return (
    <div
      className={`flex ${
        placement === "side"
          ? "flex-row-reverse items-end gap-2"
          : "flex-col items-center gap-3"
      } ${props.className ?? ""}`}
    >
      <SpotterBubble
        line={props.line}
        live={props.live === true}
        tail={placement === "side" ? "side" : "down"}
      />
      {figure}
    </div>
  );
}

/** SPOTTER's speech bubble. Patrick Hand lives here and nowhere else. */
export function SpotterBubble({
  line,
  live = false,
  tail = "down",
}: {
  line: string;
  live?: boolean;
  tail?: "down" | "side";
}) {
  return (
    <p
      aria-live={live ? "polite" : undefined}
      className="relative max-w-[16rem] rounded-[18px] border-2 border-foreground bg-surface px-3.5 py-2 font-hand text-xl leading-tight text-foreground"
    >
      <span className="sr-only">SPOTTER says: </span>
      {line}
      <span
        aria-hidden="true"
        className={`absolute h-3.5 w-3.5 rotate-45 border-foreground bg-surface ${
          tail === "down"
            ? "-bottom-[9px] left-7 border-b-2 border-r-2"
            : "-left-[9px] bottom-4 border-b-2 border-l-2"
        }`}
      />
    </p>
  );
}
