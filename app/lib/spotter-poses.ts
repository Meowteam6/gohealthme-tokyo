// SPOTTER's poses and the one pose each screen state gets (docs/DESIGN.md,
// "SPOTTER (the mascot is the layout)"). Screens ask for a state, never a file
// name, so a pose change lands everywhere at once.
//
// Art lives in public/spotter/ as WebP at a 1000px max edge. spotter.png and
// spotter-wave.png also stay as PNG for consumers that cannot read WebP (the
// JSON-LD logo, the wallet modal logo, the OG image renderer).

export const SPOTTER_POSES = [
  "broke",
  "checkup",
  "cheer",
  "cointoss",
  "dental",
  "detective",
  "facepalm",
  "flex",
  "flushot",
  "greet",
  "lift",
  "lounging",
  "meditate",
  "nature",
  "neutral",
  "payday",
  "payout",
  "peek",
  "point",
  "portrait",
  "run",
  "screening",
  "sleep",
  "standing",
  "thinking",
  "thumbsup",
  "verified",
  "wallet",
  "watching",
  "wave",
  "wearable",
] as const;

export type SpotterPose = (typeof SPOTTER_POSES)[number];

export interface PoseMeta {
  /** Intrinsic size of the WebP, for next/image's aspect ratio. */
  width: number;
  height: number;
  /** What a screen reader hears when the pose carries meaning. */
  alt: string;
  /** True for the square painted cards (cream background baked in). They are
   *  framed as rounded tiles; every other pose is a transparent cutout. */
  opaque: boolean;
}

export const POSE_META: Record<SpotterPose, PoseMeta> = {
  broke: { width: 714, height: 777, alt: "SPOTTER shrugging, paws empty", opaque: false },
  checkup: { width: 986, height: 986, alt: "SPOTTER at a check-up", opaque: false },
  cheer: { width: 637, height: 762, alt: "SPOTTER cheering", opaque: false },
  cointoss: { width: 848, height: 1000, alt: "SPOTTER tossing a coin", opaque: false },
  dental: { width: 842, height: 842, alt: "SPOTTER at the dentist", opaque: false },
  detective: { width: 767, height: 1000, alt: "SPOTTER checking with a magnifier", opaque: false },
  facepalm: { width: 803, height: 1000, alt: "SPOTTER with a paw over his face", opaque: false },
  flex: { width: 765, height: 1000, alt: "SPOTTER flexing", opaque: false },
  flushot: { width: 890, height: 890, alt: "SPOTTER after a flu shot", opaque: false },
  greet: { width: 875, height: 875, alt: "SPOTTER waving hello", opaque: false },
  lift: { width: 835, height: 1000, alt: "SPOTTER lifting weights", opaque: false },
  lounging: { width: 874, height: 522, alt: "SPOTTER lounging on his back", opaque: false },
  meditate: { width: 875, height: 1000, alt: "SPOTTER meditating", opaque: false },
  nature: { width: 1000, height: 1000, alt: "SPOTTER standing on a rock by the river", opaque: true },
  neutral: { width: 1000, height: 1000, alt: "SPOTTER, unimpressed", opaque: true },
  payday: { width: 605, height: 763, alt: "SPOTTER holding up a gold coin", opaque: false },
  payout: { width: 1000, height: 1000, alt: "SPOTTER lying back with a gold coin", opaque: true },
  peek: { width: 859, height: 650, alt: "SPOTTER peeking up from below", opaque: false },
  point: { width: 861, height: 1000, alt: "SPOTTER pointing", opaque: false },
  portrait: { width: 1000, height: 1000, alt: "SPOTTER, the GoHealthMe otter", opaque: true },
  run: { width: 895, height: 648, alt: "SPOTTER running", opaque: false },
  screening: { width: 798, height: 798, alt: "SPOTTER wearing a blood-pressure cuff", opaque: false },
  sleep: { width: 1000, height: 726, alt: "SPOTTER asleep", opaque: false },
  standing: { width: 579, height: 787, alt: "SPOTTER standing", opaque: false },
  thinking: { width: 761, height: 1000, alt: "SPOTTER thinking it over", opaque: false },
  thumbsup: { width: 848, height: 1000, alt: "SPOTTER giving a thumbs up", opaque: false },
  verified: { width: 1000, height: 1000, alt: "SPOTTER, eyes closed, giving a thumbs up", opaque: true },
  wallet: { width: 973, height: 1000, alt: "SPOTTER holding a wallet", opaque: false },
  watching: { width: 1000, height: 1000, alt: "SPOTTER saluting, keeping watch", opaque: true },
  wave: { width: 637, height: 1000, alt: "SPOTTER waving", opaque: false },
  wearable: { width: 714, height: 1000, alt: "SPOTTER pointing at the watch on his wrist", opaque: false },
};

/** Public URL of a pose. `portrait` is the bare spotter.webp. */
export function spotterSrc(pose: SpotterPose): string {
  return pose === "portrait" ? "/spotter/spotter.webp" : `/spotter/spotter-${pose}.webp`;
}

export const SPOTTER_BACKDROP_SRC = "/spotter/backdrop.webp";

/** The size a state is drawn at. Matches the Spotter component's `size`. */
export type SpotterSize = "row" | "inline" | "xs" | "sm" | "md" | "lg" | "hero";

/** Every screen state DESIGN.md gives a pose, plus loading and error. */
export type SpotterScreenState =
  | "onboarding-welcome"
  | "onboarding-world-id"
  | "onboarding-name"
  | "onboarding-wearable"
  | "lobby"
  | "locked-row"
  | "commit"
  | "run-day"
  | "run-night-sleep"
  | "run-workout"
  | "run-steps"
  | "checking"
  | "screening"
  | "verdict-paid"
  | "verdict-not-met"
  | "confirmation-declined"
  | "confirmation-expired"
  | "empty"
  | "settings"
  | "history-verified"
  | "history-other"
  | "loading"
  | "error";

export interface StatePose {
  pose: SpotterPose;
  size: SpotterSize;
}

export const STATE_POSES: Record<SpotterScreenState, StatePose> = {
  "onboarding-welcome": { pose: "wave", size: "hero" },
  "onboarding-world-id": { pose: "peek", size: "hero" },
  "onboarding-name": { pose: "point", size: "hero" },
  "onboarding-wearable": { pose: "wearable", size: "hero" },
  lobby: { pose: "peek", size: "md" },
  "locked-row": { pose: "detective", size: "inline" },
  commit: { pose: "payday", size: "hero" },
  "run-day": { pose: "watching", size: "md" },
  "run-night-sleep": { pose: "sleep", size: "md" },
  "run-workout": { pose: "lift", size: "md" },
  "run-steps": { pose: "run", size: "md" },
  checking: { pose: "detective", size: "hero" },
  screening: { pose: "screening", size: "hero" },
  "verdict-paid": { pose: "payday", size: "hero" },
  "verdict-not-met": { pose: "facepalm", size: "hero" },
  "confirmation-declined": { pose: "thinking", size: "hero" },
  "confirmation-expired": { pose: "neutral", size: "hero" },
  empty: { pose: "lounging", size: "lg" },
  settings: { pose: "wallet", size: "md" },
  "history-verified": { pose: "verified", size: "row" },
  "history-other": { pose: "detective", size: "row" },
  loading: { pose: "detective", size: "md" },
  error: { pose: "thinking", size: "md" },
};

/** The pose and size for a screen state. */
export function poseFor(state: SpotterScreenState): StatePose {
  return STATE_POSES[state];
}

/** Narrows an untyped string (legacy call sites, lib/game/verdict.ts) to a
 *  pose, or null so the caller can fall back instead of rendering a 404. */
export function asSpotterPose(value: string): SpotterPose | null {
  const bare = value.replace(/^\/?spotter\//, "").replace(/^spotter-/, "").replace(/\.(png|webp)$/, "");
  if (bare === "spotter") return "portrait";
  return (SPOTTER_POSES as readonly string[]).includes(bare) ? (bare as SpotterPose) : null;
}
