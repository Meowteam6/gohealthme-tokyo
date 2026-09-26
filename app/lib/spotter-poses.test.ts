import { existsSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_POSES,
  NIGHT_POSES,
  POSE_META,
  SPOTTER_POSES,
  STATE_POSES,
  asSpotterPose,
  poseFor,
  poseMeta,
  spotterSrc,
  toNightPose,
} from "./spotter-poses";

const publicFile = (src: string) => path.join(__dirname, "..", "public", src);

describe("spotter poses on the night field", () => {
  it("has relit art on disk and alt text for every night pose", () => {
    for (const pose of NIGHT_POSES) {
      expect(existsSync(publicFile(spotterSrc(pose))), pose).toBe(true);
      expect(POSE_META[pose].alt.length, pose).toBeGreaterThan(0);
    }
  });

  it("only ever serves the eight relit poses", () => {
    expect(NIGHT_POSES).toEqual([
      "sleep",
      "wearable",
      "wave",
      "thumbsup",
      "meditate",
      "detective",
      "facepalm",
      "thinking",
    ]);
    for (const pose of SPOTTER_POSES) {
      expect(spotterSrc(pose)).toMatch(/^\/spotter\/night\/[a-z]+\.webp$/);
      expect(NIGHT_POSES).toContain(toNightPose(pose));
    }
  });

  it("never renders a banned or baked-background pose, even when asked by name", () => {
    for (const banned of ["payday", "cheer", "greet", "standing", "run", "peek", "wallet"] as const) {
      expect(NIGHT_POSES).not.toContain(banned);
      expect(spotterSrc(banned)).not.toContain(banned);
    }
    for (const baked of ["nature", "neutral", "payout", "portrait", "verified", "watching"] as const) {
      expect(spotterSrc(baked)).not.toContain(baked);
    }
    expect(LEGACY_POSES.length + NIGHT_POSES.length).toBe(SPOTTER_POSES.length);
  });

  it("keeps the PNGs that consumers outside the page read", () => {
    expect(existsSync(publicFile("/spotter/spotter.png"))).toBe(true);
    expect(existsSync(publicFile("/spotter/spotter-wave.png"))).toBe(true);
    expect(existsSync(publicFile("/brand/mark.svg"))).toBe(true);
    expect(existsSync(publicFile("/brand/og-sleep.png"))).toBe(true);
  });

  it("stages the DESIGN.md table", () => {
    expect(poseFor("landing-hero")).toMatchObject({ pose: "sleep", width: [176, 280] });
    expect(poseFor("landing-woke")).toMatchObject({ pose: "wave", width: [74, 118] });
    expect(poseFor("outcome-hit").pose).toBe("thumbsup");
    expect(poseFor("outcome-miss").pose).toBe("facepalm");
    expect(poseFor("outcome-none").pose).toBe("meditate");
    expect(poseFor("run-open")).toMatchObject({ pose: "wearable", width: [96, 176] });
    expect(poseFor("run-joined")).toMatchObject({ pose: "sleep", width: [132, 260] });
    expect(poseFor("verdict-confirm").pose).toBe("detective");
    expect(poseFor("verdict-denied").pose).toBe("thinking");
    expect(poseFor("verdict-lost").pose).toBe("facepalm");
    expect(poseFor("verdict-paid")).toMatchObject({ pose: "thumbsup", width: [84, 84] });
    for (const { pose } of Object.values(STATE_POSES)) {
      expect(NIGHT_POSES).toContain(pose);
    }
  });

  it("gives a legacy name the night pose's size", () => {
    expect(poseMeta("payday")).toEqual(POSE_META.thumbsup);
    expect(poseMeta("lounging")).toEqual(POSE_META.meditate);
  });

  it("narrows legacy strings to a pose or null", () => {
    expect(asSpotterPose("payday")).toBe("payday");
    expect(asSpotterPose("spotter-greet.png")).toBe("greet");
    expect(asSpotterPose("/spotter/spotter-peek.webp")).toBe("peek");
    expect(asSpotterPose("/spotter/night/sleep.webp")).toBe("sleep");
    expect(asSpotterPose("spotter.png")).toBe("portrait");
    expect(asSpotterPose("together")).toBeNull();
  });
});
