// "What do you wear?" before any account: which open runs a wearable brand
// can check, from the same capability table the join gate reads
// (lib/provider-capabilities.ts) and the providers this build can pair
// (lib/server/wearable providerConfigured). A preview, never the gate: the
// signed-in lobby and the run page still decide per device, before a stake.
//
// Brands map onto providers the way pairing does (components/game/
// SensorStep.tsx): Oura, Garmin and Fitbit pair through Junction; WHOOP pairs
// through Junction or directly; Apple Watch needs the iPhone app.

import { PROVIDER_CAPABILITIES } from "@/lib/provider-capabilities";
import { evidenceTypeOf } from "@/lib/contract";
import {
  WEARABLE_METRICS,
  classifyWearableGoal,
  metricLabel,
  type WearableMetric,
} from "@/lib/wearable-goal";
import type { Segment } from "@/lib/game/landing";

export const WEARABLE_BRANDS = ["whoop", "oura", "garmin", "fitbit", "apple", "none"] as const;
export type WearableBrand = (typeof WEARABLE_BRANDS)[number];

export const BRAND_LABEL: Record<WearableBrand, string> = {
  whoop: "WHOOP",
  oura: "Oura",
  garmin: "Garmin",
  fitbit: "Fitbit",
  apple: "Apple Watch",
  none: "None yet",
};

/** Which providers this build can pair right now. Read on the server. */
export interface WearableAvailability {
  junction: boolean;
  whoop: boolean;
  apple: boolean;
}

/** Remembered on the device so the lobby and the landing agree. */
export const WEAR_STORAGE_KEY = "ghm-wear";

export function isWearableBrand(value: unknown): value is WearableBrand {
  return typeof value === "string" && (WEARABLE_BRANDS as readonly string[]).includes(value);
}

/** Brands a player can pair on this build today. */
export function pairableBrands(a: WearableAvailability): WearableBrand[] {
  return WEARABLE_BRANDS.filter((b) => brandPairable(b, a));
}

function brandPairable(brand: WearableBrand, a: WearableAvailability): boolean {
  switch (brand) {
    case "whoop":
      return a.junction || a.whoop;
    case "oura":
    case "garmin":
    case "fitbit":
      return a.junction;
    case "apple":
      return a.apple;
    case "none":
      return false;
  }
}

/**
 * What a brand measures. A WHOOP strap is a WHOOP strap whichever way it
 * pairs; Oura, Garmin and Fitbit get Junction's list, which SPOTTER narrows
 * to the device after its first sync.
 */
function brandMetrics(brand: WearableBrand): readonly WearableMetric[] {
  switch (brand) {
    case "whoop":
      return PROVIDER_CAPABILITIES.whoop;
    case "oura":
    case "garmin":
    case "fitbit":
      return PROVIDER_CAPABILITIES.junction;
    case "apple":
      return PROVIDER_CAPABILITIES.apple;
    case "none":
      return [];
  }
}

export type Fit =
  | { ok: true; line: string }
  | { ok: false; line: string };

/** One run's fit for one brand, as the row's last line says it. */
export function brandFit(brand: WearableBrand, goalSpec: string, a: WearableAvailability): Fit {
  if (evidenceTypeOf(goalSpec) !== "wearable") {
    return { ok: true, line: "Proved by an upload, no wearable needed" };
  }
  const label = BRAND_LABEL[brand];
  if (brand === "none") return { ok: false, line: "Needs a wearable to join" };
  if (!brandPairable(brand, a)) return { ok: false, line: `Not with ${label} yet` };
  const metric = classifyWearableGoal(goalSpec).metric;
  if (metric === null || !brandMetrics(brand).includes(metric)) {
    return { ok: false, line: metric === null ? `Not with ${label} yet` : `Not with ${label}: no ${metricLabel(metric)}` };
  }
  return { ok: true, line: `Your ${label} can check this` };
}

function joinOr(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

function canCheck(label: string, ok: number, total: number): string {
  if (total === 0) return `${label} works here.`;
  if (ok === total) return total === 1 ? `${label} can check the open challenge.` : `${label} can check all ${total} open challenges.`;
  if (ok === 0) return total === 1 ? `${label} can't check the open challenge.` : `${label} can't check any of the ${total} open challenges.`;
  return `${label} can check ${ok} of ${total} open challenges.`;
}

/**
 * The hint under the chips: what this brand can do across the open runs, and
 * its limit named plainly, with the next thing that works.
 */
export function brandHint(
  brand: WearableBrand,
  goalSpecs: readonly string[],
  a: WearableAvailability,
): Segment[] {
  const label = BRAND_LABEL[brand];
  // Every brand this build can pair is an alternative, Apple Watch included
  // once APPLE_APP_AVAILABLE is on: it plays the same sleep and workout
  // challenges WHOOP does.
  const others = pairableBrands(a)
    .filter((b) => b !== brand)
    .map((b) => BRAND_LABEL[b]);
  const article = /^[aeiou]/i.test(others[0] ?? "") ? "An" : "A";
  const alternatives =
    others.length > 0 ? ` ${article} ${joinOr(others)} works today.` : "";

  if (brand === "none") {
    const pairable = pairableBrands(a).map((b) => BRAND_LABEL[b]);
    return [
      { text: "You can look around.", strong: true },
      {
        text:
          pairable.length > 0
            ? ` To stake, you need a wearable: ${joinOr(pairable)}.`
            : " No wearable can pair on this build yet, so challenges stay locked.",
      },
    ];
  }

  if (!brandPairable(brand, a)) {
    if (brand === "apple") {
      return [
        { text: "Apple Watch can't join yet.", strong: true },
        { text: ` It needs our iPhone app, which is not out.${alternatives}` },
      ];
    }
    return [{ text: `${label} can't pair on this build yet.`, strong: true }, { text: alternatives }];
  }

  const metrics = brandMetrics(brand);
  const wearableSpecs = goalSpecs.filter((g) => evidenceTypeOf(g) === "wearable");
  const ok = wearableSpecs.filter((g) => brandFit(brand, g, a).ok).length;
  const lead = canCheck(label, ok, wearableSpecs.length);

  if (brand === "whoop") {
    const missing = WEARABLE_METRICS.filter((m) => !metrics.includes(m)).map(metricLabel);
    return [
      { text: lead, strong: true },
      {
        text:
          missing.length > 0
            ? ` It has no step counter, so challenges on ${joinOr(missing)} stay locked for it.`
            : "",
      },
    ];
  }
  if (brand === "apple") {
    // The limits, named here the way WHOOP's are: sleep comes from the Watch
    // (an iPhone alone has none; the join gate narrows that per wallet after
    // the first sync), and the metrics Apple never reports (no proprietary
    // sleep score) are read from the same table WHOOP's gap is. Then the
    // pairing, once: after it the iPhone app posts each day on its own
    // (HealthKit background delivery) and whenever it is opened.
    const missing = WEARABLE_METRICS.filter((m) => !metrics.includes(m)).map(metricLabel);
    return [
      { text: lead, strong: true },
      {
        text:
          missing.length > 0
            ? ` Sleep needs the Watch, and it has no ${joinOr(missing)}.`
            : " Sleep needs the Watch.",
      },
      { text: " Pair it once; the GoHealthMe iPhone app syncs on its own after that." },
    ];
  }
  return [
    { text: lead, strong: true },
    { text: " SPOTTER confirms what it counts after its first sync." },
  ];
}
