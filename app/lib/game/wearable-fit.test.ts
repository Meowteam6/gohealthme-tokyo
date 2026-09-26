import { describe, expect, it } from "vitest";
import { segmentsText } from "@/lib/game/landing";
import {
  brandFit,
  brandHint,
  isWearableBrand,
  pairableBrands,
  type WearableAvailability,
} from "@/lib/game/wearable-fit";

const TODAY: WearableAvailability = { junction: true, whoop: true, apple: false };
const SLEEP = "Sleep at least 7 hours for 1 night";
const EFFICIENCY = "Sleep efficiency 85% or better for 1 night";
const WORKOUT = "Complete at least 1 workout for 1 day";
const STEPS = "Walk at least 8,000 steps for 1 day";
const OPEN = [SLEEP, EFFICIENCY, WORKOUT];

describe("brandFit", () => {
  it("reads the capability table: WHOOP has no step counter", () => {
    expect(brandFit("whoop", SLEEP, TODAY)).toEqual({ ok: true, line: "Your WHOOP can check this" });
    expect(brandFit("whoop", WORKOUT, TODAY).ok).toBe(true);
    expect(brandFit("whoop", STEPS, TODAY)).toEqual({ ok: false, line: "Not with WHOOP: no step count" });
    expect(brandFit("oura", STEPS, TODAY).ok).toBe(true);
  });

  it("locks Apple Watch until the iPhone app ships, and every run for no wearable", () => {
    expect(brandFit("apple", SLEEP, TODAY)).toEqual({ ok: false, line: "Not with Apple Watch yet" });
    expect(brandFit("apple", SLEEP, { ...TODAY, apple: true }).ok).toBe(true);
    expect(brandFit("none", SLEEP, TODAY)).toEqual({ ok: false, line: "Needs a wearable to join" });
  });

  it("locks Junction brands when Junction is off, and keeps WHOOP on its direct path", () => {
    const whoopOnly = { junction: false, whoop: true, apple: false };
    expect(brandFit("garmin", SLEEP, whoopOnly)).toEqual({ ok: false, line: "Not with Garmin yet" });
    expect(brandFit("whoop", SLEEP, whoopOnly).ok).toBe(true);
    expect(pairableBrands(whoopOnly)).toEqual(["whoop"]);
  });
});

describe("brandHint", () => {
  it("names WHOOP's limit and counts the runs it can check", () => {
    expect(segmentsText(brandHint("whoop", OPEN, TODAY))).toBe(
      "WHOOP can check all 3 open challenges. It has no step counter, so challenges on step count, active calories or distance stay locked for it.",
    );
    expect(segmentsText(brandHint("whoop", [...OPEN, STEPS], TODAY))).toMatch(/^WHOOP can check 3 of 4 open challenges\./);
  });

  it("tells an Apple Watch wearer before any stake, with what works today", () => {
    const hint = brandHint("apple", OPEN, TODAY);
    expect(hint[0]).toEqual({ text: "Apple Watch can't join yet.", strong: true });
    expect(segmentsText(hint)).toBe(
      "Apple Watch can't join yet. It needs our iPhone app, which is not out. A WHOOP, Oura, Garmin or Fitbit works today.",
    );
  });

  it("Junction brands confirm after the first sync; no wearable can still look", () => {
    expect(segmentsText(brandHint("oura", OPEN, TODAY))).toBe(
      "Oura can check all 3 open challenges. SPOTTER confirms what it counts after its first sync.",
    );
    expect(segmentsText(brandHint("none", OPEN, TODAY))).toBe(
      "You can look around. To stake, you need a wearable: WHOOP, Oura, Garmin or Fitbit.",
    );
    expect(segmentsText(brandHint("fitbit", [SLEEP], TODAY))).toMatch(/^Fitbit can check the open challenge\./);
    expect(segmentsText(brandHint("fitbit", [], TODAY))).toMatch(/^Fitbit works here\./);
  });

  it("says challenge, never run, in every hint (one vocabulary, 2026-09-27)", () => {
    const off: WearableAvailability = { junction: false, whoop: false, apple: false };
    for (const brand of ["whoop", "oura", "garmin", "fitbit", "apple", "none"] as const) {
      for (const a of [TODAY, off]) {
        expect(segmentsText(brandHint(brand, [...OPEN, STEPS], a)), brand).not.toMatch(/\bruns?\b/i);
      }
    }
    expect(segmentsText(brandHint("none", OPEN, off))).toBe(
      "You can look around. No wearable can pair on this build yet, so challenges stay locked.",
    );
  });

  it("accepts only known brands from storage", () => {
    expect(isWearableBrand("whoop")).toBe(true);
    expect(isWearableBrand("pebble")).toBe(false);
    expect(isWearableBrand(null)).toBe(false);
  });
});
