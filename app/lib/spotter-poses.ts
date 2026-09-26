// SPOTTER's poses and the pose each screen state gets (docs/DESIGN.md,
// "SPOTTER on a night field"). Screens ask for a state, never a file name, so a
// pose change lands everywhere at once.
//
// Only the eight relit poses may stand on a night field. They live in
// public/spotter/night/ as WebP, re-matted and relit by
// scripts/relight-spotter.mjs. Older call sites may still name a Riverbank pose
// ("payday", "greet", a painted card with a baked background); each resolves
// here to the night pose that carries the same meaning, so no screen can put a
// banned pose or a baked backdrop on the indigo field. New code names a
// NightPose or a state.
//
// public/spotter/spotter.png and spotter-wave.png stay for consumers outside
// the page (the JSON-LD logo, the wallet modal logo on the V3 domain).

export const NIGHT_POSES = [
  "sleep",
  "wearable",
  "wave",
  "thumbsup",
  "meditate",
  "detective",
  "facepalm",
  "thinking",
] as const;

export type NightPose = (typeof NIGHT_POSES)[number];

/** Riverbank pose names still accepted from older call sites. */
export const LEGACY_POSES = [
  "broke",
  "checkup",
  "cheer",
  "cointoss",
  "dental",
  "flex",
  "flushot",
  "greet",
  "lift",
  "lounging",
  "nature",
  "neutral",
  "payday",
  "payout",
  "peek",
  "point",
  "portrait",
  "run",
  "screening",
  "standing",
  "verified",
  "wallet",
  "watching",
] as const;

export type LegacyPose = (typeof LEGACY_POSES)[number];

/** Any pose name a caller may pass. It always renders as a NightPose. */
export type SpotterPose = NightPose | LegacyPose;

export const SPOTTER_POSES: readonly SpotterPose[] = [...NIGHT_POSES, ...LEGACY_POSES];

/** The night pose that carries each legacy pose's meaning. */
export const LEGACY_TO_NIGHT: Record<LegacyPose, NightPose> = {
  broke: "facepalm",
  checkup: "detective",
  cheer: "thumbsup",
  cointoss: "thinking",
  dental: "detective",
  flex: "thumbsup",
  flushot: "detective",
  greet: "wave",
  lift: "wearable",
  lounging: "meditate",
  nature: "meditate",
  neutral: "thinking",
  payday: "thumbsup",
  payout: "thumbsup",
  peek: "detective",
  point: "wearable",
  portrait: "wave",
  run: "wearable",
  screening: "detective",
  standing: "wave",
  verified: "thumbsup",
  wallet: "wearable",
  watching: "detective",
};

export function isNightPose(pose: string): pose is NightPose {
  return (NIGHT_POSES as readonly string[]).includes(pose);
}

/** The night pose a caller's pose renders as. */
export function toNightPose(pose: SpotterPose): NightPose {
  return isNightPose(pose) ? pose : LEGACY_TO_NIGHT[pose];
}

export interface PoseMeta {
  /** Intrinsic size of the relit WebP, trimmed to the otter. */
  width: number;
  height: number;
  /** What a screen reader hears when the pose carries meaning. */
  alt: string;
}

export const POSE_META: Record<NightPose, PoseMeta> = {
  sleep: { width: 1000, height: 726, alt: "SPOTTER asleep" },
  wearable: { width: 714, height: 1000, alt: "SPOTTER pointing at the wearable on his wrist" },
  wave: { width: 637, height: 1000, alt: "SPOTTER waving" },
  thumbsup: { width: 848, height: 1000, alt: "SPOTTER giving a thumbs up" },
  meditate: { width: 875, height: 1000, alt: "SPOTTER sitting calmly" },
  detective: { width: 767, height: 1000, alt: "SPOTTER checking with a magnifier" },
  facepalm: { width: 803, height: 1000, alt: "SPOTTER with a paw over his face" },
  thinking: { width: 761, height: 1000, alt: "SPOTTER thinking it over" },
};

/** Size and alt text for any pose name. */
export function poseMeta(pose: SpotterPose): PoseMeta {
  return POSE_META[toNightPose(pose)];
}

/** Public URL of the relit art for any pose name. */
export function spotterSrc(pose: SpotterPose): string {
  return `/spotter/night/${toNightPose(pose)}.webp`;
}

/** Fixed widths for older call sites. Staged art passes `width` instead. */
export type SpotterSize = "row" | "inline" | "xs" | "sm" | "md" | "lg" | "hero";

/** Width in px at phone size, and from 900px up. */
export type StageWidth = readonly [phone: number, wide: number];

/** Every screen state with a pose: the Night Shift staging table first, then
 *  the older states, remapped to night poses. */
export type SpotterScreenState =
  // Staging table (docs/DESIGN.md).
  | "landing-hero"
  | "landing-woke"
  | "outcome-hit"
  | "outcome-miss"
  | "outcome-none"
  | "run-open"
  | "run-joined"
  | "verdict-confirm"
  | "verdict-denied"
  | "verdict-lost"
  | "verdict-paid"
  // Older states.
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
  pose: NightPose;
  size: SpotterSize;
  /** The staged width, for the states in the staging table. */
  width?: StageWidth;
}

export const STATE_POSES: Record<SpotterScreenState, StatePose> = {
  "landing-hero": { pose: "sleep", size: "hero", width: [176, 280] },
  "landing-woke": { pose: "wave", size: "xs", width: [74, 118] },
  "outcome-hit": { pose: "thumbsup", size: "sm", width: [92, 116] },
  "outcome-miss": { pose: "facepalm", size: "sm", width: [92, 116] },
  "outcome-none": { pose: "meditate", size: "sm", width: [92, 116] },
  "run-open": { pose: "wearable", size: "sm", width: [96, 176] },
  "run-joined": { pose: "sleep", size: "md", width: [132, 260] },
  "verdict-confirm": { pose: "detective", size: "sm", width: [96, 176] },
  "verdict-denied": { pose: "thinking", size: "sm", width: [96, 176] },
  "verdict-lost": { pose: "facepalm", size: "sm", width: [96, 176] },
  "verdict-paid": { pose: "thumbsup", size: "xs", width: [84, 84] },

  "onboarding-welcome": { pose: "wave", size: "md" },
  "onboarding-world-id": { pose: "detective", size: "md" },
  "onboarding-name": { pose: "thinking", size: "md" },
  "onboarding-wearable": { pose: "wearable", size: "md" },
  lobby: { pose: "wearable", size: "sm" },
  "locked-row": { pose: "detective", size: "inline" },
  commit: { pose: "wearable", size: "sm", width: [96, 176] },
  "run-day": { pose: "detective", size: "sm" },
  "run-night-sleep": { pose: "sleep", size: "md" },
  "run-workout": { pose: "wearable", size: "sm" },
  "run-steps": { pose: "wearable", size: "sm" },
  checking: { pose: "detective", size: "sm", width: [96, 176] },
  screening: { pose: "detective", size: "sm", width: [96, 176] },
  "verdict-not-met": { pose: "facepalm", size: "sm", width: [96, 176] },
  "confirmation-declined": { pose: "thinking", size: "sm", width: [96, 176] },
  "confirmation-expired": { pose: "thinking", size: "sm", width: [96, 176] },
  empty: { pose: "meditate", size: "sm" },
  settings: { pose: "wearable", size: "sm" },
  "history-verified": { pose: "thumbsup", size: "row" },
  "history-other": { pose: "detective", size: "row" },
  loading: { pose: "detective", size: "sm" },
  error: { pose: "thinking", size: "sm" },
};

/** The pose and size for a screen state. */
export function poseFor(state: SpotterScreenState): StatePose {
  return STATE_POSES[state];
}

/** Narrows an untyped string (legacy call sites, lib/game/verdict.ts) to a
 *  pose name, or null so the caller can fall back instead of rendering a 404.
 *  Accepts bare names, old file names and night paths. */
export function asSpotterPose(value: string): SpotterPose | null {
  const bare = value
    .replace(/^\/?spotter\/(night\/)?/, "")
    .replace(/^spotter-/, "")
    .replace(/\.(png|webp)$/, "");
  if (bare === "spotter") return "portrait";
  return (SPOTTER_POSES as readonly string[]).includes(bare) ? (bare as SpotterPose) : null;
}
