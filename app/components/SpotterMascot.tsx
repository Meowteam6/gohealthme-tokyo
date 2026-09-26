import Perch from "@/components/spotter/Perch";
import type { SpotterPose } from "@/lib/spotter-poses";

// SPOTTER standing on the top edge of a small caption card: his name or a
// one-line label, then a quiet sublabel. Draws through components/spotter so
// the art, alt text and contact shadow stay in one place.

const WIDTH: Record<"sm" | "md" | "lg", readonly [number, number]> = {
  sm: [72, 84],
  md: [96, 120],
  lg: [132, 176],
};

export default function SpotterMascot({
  pose = "wave",
  caption,
  sublabel,
  size = "md",
  className = "",
}: {
  pose?: SpotterPose;
  caption?: string;
  sublabel?: string;
  size?: "sm" | "md" | "lg";
  /** Retired: SPOTTER no longer idles (motion answers the player only). */
  float?: boolean;
  className?: string;
}) {
  return (
    <Perch pose={pose} width={WIDTH[size]} side="left" inset={[14, 18]} alt={caption} className={className}>
      <div className="rounded-control bg-surface-raised px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--border)]">
        {caption !== undefined ? (
          <p className="m-0 text-[0.9375rem] font-semibold text-foreground">{caption}</p>
        ) : null}
        {sublabel !== undefined ? (
          <p className="m-0 mt-0.5 text-[0.8125rem] text-haze">{sublabel}</p>
        ) : null}
      </div>
    </Perch>
  );
}
