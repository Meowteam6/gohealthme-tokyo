import Spotter from "@/components/spotter/Spotter";
import type { SpotterPose } from "@/lib/spotter-poses";

// SPOTTER with a caption underneath, for the pool and agent pages. Draws
// through components/spotter/Spotter so the art and alt text stay in one place.

export default function SpotterMascot({
  pose = "neutral",
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
    <div className={`flex shrink-0 flex-col items-center ${className}`}>
      <Spotter pose={pose} size={size} alt={caption} />
      {caption !== undefined ? (
        <p className="mt-2 text-center text-sm font-bold">{caption}</p>
      ) : null}
      {sublabel !== undefined ? (
        <p className="mt-0.5 text-center text-xs text-muted">{sublabel}</p>
      ) : null}
    </div>
  );
}
