import { existsSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  POSE_META,
  SPOTTER_BACKDROP_SRC,
  SPOTTER_POSES,
  STATE_POSES,
  asSpotterPose,
  poseFor,
  spotterSrc,
} from "./spotter-poses";

const publicFile = (src: string) => path.join(__dirname, "..", "public", src);

describe("spotter poses", () => {
  it("every pose has art on disk and alt text", () => {
    for (const pose of SPOTTER_POSES) {
      expect(existsSync(publicFile(spotterSrc(pose))), pose).toBe(true);
      expect(POSE_META[pose].alt.length, pose).toBeGreaterThan(0);
    }
    expect(existsSync(publicFile(SPOTTER_BACKDROP_SRC))).toBe(true);
  });

  it("keeps the PNGs that non-WebP consumers read", () => {
    expect(existsSync(publicFile("/spotter/spotter.png"))).toBe(true);
    expect(existsSync(publicFile("/spotter/spotter-wave.png"))).toBe(true);
  });

  it("maps the DESIGN.md states to their poses", () => {
    expect(poseFor("onboarding-welcome").pose).toBe("wave");
    expect(poseFor("onboarding-world-id").pose).toBe("peek");
    expect(poseFor("onboarding-name").pose).toBe("point");
    expect(poseFor("onboarding-wearable").pose).toBe("wearable");
    expect(poseFor("locked-row")).toEqual({ pose: "detective", size: "inline" });
    expect(poseFor("verdict-paid").pose).toBe("payday");
    expect(poseFor("verdict-not-met").pose).toBe("facepalm");
    expect(poseFor("run-night-sleep").pose).toBe("sleep");
    expect(poseFor("empty").pose).toBe("lounging");
    expect(poseFor("settings").pose).toBe("wallet");
    for (const { pose } of Object.values(STATE_POSES)) {
      expect(SPOTTER_POSES).toContain(pose);
    }
  });

  it("narrows legacy strings to a pose or null", () => {
    expect(asSpotterPose("payday")).toBe("payday");
    expect(asSpotterPose("spotter-greet.png")).toBe("greet");
    expect(asSpotterPose("/spotter/spotter-peek.webp")).toBe("peek");
    expect(asSpotterPose("spotter.png")).toBe("portrait");
    expect(asSpotterPose("together")).toBeNull();
  });
});
