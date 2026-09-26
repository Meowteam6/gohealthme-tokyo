import type { ReactNode } from "react";
import Perch from "@/components/spotter/Perch";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import { Card } from "@/components/ui";
import { asSpotterPose, type SpotterPose } from "@/lib/spotter-poses";

// A screen title on the night field (docs/DESIGN.md): the title card, with
// SPOTTER standing on its top edge doing something relevant to the page. His
// optional line sits in his caption box inside the card.
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
  /** A pose name ("wave") or a legacy file name ("spotter-greet.webp"). */
  pose: SpotterPose | string;
  poseAlt: string;
  /** A short sentence-case context line above the title. */
  eyebrow?: string;
  /** One SPOTTER line, in his caption box. */
  spotterLine?: string;
  children?: ReactNode;
}) {
  const resolved: SpotterPose = asSpotterPose(pose) ?? "wave";
  return (
    <Perch pose={resolved} width={[88, 132]} side="right" alt={poseAlt}>
      <Card as="section">
        {eyebrow !== undefined ? (
          <p className="m-0 text-sm font-semibold text-haze">{eyebrow}</p>
        ) : null}
        <h1 className="type-title m-0 mt-1 break-words text-[2rem] min-[900px]:text-[2.75rem]">
          {title}
        </h1>
        {subtitle !== undefined ? (
          <p className="m-0 mt-2 max-w-[60ch] text-base leading-relaxed text-muted">{subtitle}</p>
        ) : null}
        {spotterLine !== undefined ? (
          <SpotterCaption line={spotterLine} className="mt-4 max-w-md" />
        ) : null}
        {children}
      </Card>
    </Perch>
  );
}
