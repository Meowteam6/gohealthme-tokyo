import type { CSSProperties, ReactNode } from "react";
import {
  poseFor,
  poseMeta,
  type SpotterPose,
  type SpotterScreenState,
  type StageWidth,
} from "@/lib/spotter-poses";
import { SpotterFigure, stageVars, stageWidth } from "@/components/spotter/Spotter";

// SPOTTER standing on the top edge of the card he belongs to (docs/DESIGN.md:
// one pose per viewport, always on a card's edge, with a contact shadow). Wrap
// the card: <Perch state="run-open"><Card>...</Card></Perch>. The perch reserves
// his height above the card, so nothing overlaps the content before it, and his
// feet sink a few pixels into the card's lit edge. Server-safe.

type PoseOrState =
  | { pose: SpotterPose; state?: never }
  | { state: SpotterScreenState; pose?: never };

export type PerchProps = PoseOrState & {
  /** The card he stands on. */
  children: ReactNode;
  /** Width in px, one number or [phone, from 900px]. Defaults to the state's
   *  staged width, else 96px. */
  width?: number | StageWidth;
  /** Which end of the card he stands at. */
  side?: "left" | "right";
  /** Distance from that end, in px: one number or [phone, from 900px]. */
  inset?: number | StageWidth;
  /** How far his feet sink into the card's edge, in px. */
  overlap?: number;
  /** A fixed height to reserve above the card, in px: one number or [phone,
   *  from 900px]. Give cards that sit side by side the same reserve so their
   *  tops line up whatever the pose. Defaults to his own height. */
  reserve?: number | StageWidth;
  decorative?: boolean;
  alt?: string;
  priority?: boolean;
  breathe?: boolean;
  className?: string;
};

export default function Perch(props: PerchProps) {
  const resolved =
    props.state !== undefined ? poseFor(props.state) : { pose: props.pose, width: undefined };
  const width = stageWidth(props.width, undefined, resolved.width ?? [96, 96]);
  const meta = poseMeta(resolved.pose);
  const [insetSm, insetLg] =
    typeof props.inset === "number"
      ? [props.inset, props.inset]
      : (props.inset ?? [14, 24]);
  const side = props.side ?? "right";
  const [reserveSm, reserveLg] =
    typeof props.reserve === "number" ? [props.reserve, props.reserve] : (props.reserve ?? [null, null]);

  const style = {
    ...stageVars(width),
    "--perch-ratio": (meta.height / meta.width).toFixed(4),
    "--perch-overlap": `${props.overlap ?? 6}px`,
    // "initial" stops a reserve inheriting from an outer perch.
    "--perch-reserve-sm": reserveSm === null ? "initial" : `${reserveSm}px`,
    "--perch-reserve-lg": reserveLg === null ? "initial" : `${reserveLg}px`,
    "--inset-sm": `${insetSm}px`,
    "--inset-lg": `${insetLg}px`,
  } as CSSProperties;

  return (
    <div className={`night-perch ${props.className ?? ""}`} style={style}>
      <SpotterFigure
        pose={resolved.pose}
        width={width}
        decorative={props.decorative}
        alt={props.alt}
        priority={props.priority}
        breathe={props.breathe}
        className={
          side === "right"
            ? "right-[var(--inset-sm)] min-[900px]:right-[var(--inset-lg)]"
            : "left-[var(--inset-sm)] min-[900px]:left-[var(--inset-lg)]"
        }
      />
      {props.children}
    </div>
  );
}
