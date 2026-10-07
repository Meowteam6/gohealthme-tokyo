"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GallerySection, StateFrame, type SectionProps } from "../_kit";
import RunBoard, { type Player } from "@/components/game/RunBoard";
import { providerQueryKey, type ProviderState } from "@/lib/wearable-provider";
import CharacterCreation from "@/components/game/CharacterCreation";
import { GateLoading } from "@/components/AccessGate";
import type { CharacterView } from "@/lib/game/useCharacter";
import type { Onboarding } from "@/lib/game/onboarding-store";
import type { HumanProof, StepId, StepState } from "@/lib/game/character";
import { NAME_LOCKED_NOTE, NAME_NEEDS_WORLD_NOTE } from "@/lib/game/character";
import { SWITCHES_QUERY_KEY } from "@/lib/game/useSwitches";
import type { Switches } from "@/lib/switches";
import { providerOptionsQueryKey, type PhoneSteps, type ProviderOptions } from "@/lib/wearable-connect";
import PhonePairPanel from "@/components/PhonePairPanel";
import Link from "next/link";
import { ClaimCard, FeedEmpty } from "@/app/agent/AgentFeed";
import { FinishedRunRow, LoadingCard, MY_RUNS_LEAD, MyRunsFrame } from "@/components/DashboardContent";
import { WalletDetailView } from "@/components/WalletSettings";
import CharacterCard from "@/components/game/CharacterCard";
import SignInPanel from "@/components/SignInPanel";
import { CARD_TITLE, EmptyCard, PAGE_COLUMN, PAGE_LEAD, PAGE_TITLE, PerchedHeader } from "@/components/night/kit";
import { Card, Chip, ErrorNote, buttonClasses } from "@/components/ui";
import type { PoolInfo } from "@/lib/contract";
import type { PublicFeedClaim } from "@/lib/server/agent/feed-view";
import { ProfilePaidWall } from "@/components/profile-paid-wall";
import { PayoutRow } from "@/components/NamedPayoutFeed";

// Character creation states for the dev gallery: the real CharacterCreation
// with fixture views. Nothing here reads a wallet; every callback is a no-op.

const ADDRESS = "0x8a39c0ffee000000000000000000000000006141" as const satisfies `0x${string}`;
const noop = () => {};

const PROVIDERS: ProviderOptions = {
  status: "known",
  selected: null,
  providers: [
    { id: "junction", label: "Junction", configured: true, connected: false, metrics: ["sleep_hours", "workouts", "steps"], observedMetrics: null, capability: "declared" },
    { id: "whoop", label: "WHOOP", configured: true, connected: false, metrics: ["sleep_hours", "workouts"], observedMetrics: null, capability: "declared" },
    { id: "apple", label: "Apple Health", configured: false, connected: false, metrics: ["sleep_hours", "workouts", "steps"], observedMetrics: null, capability: "declared" },
  ],
} as unknown as ProviderOptions;

const WHOOP_PAIRED: ProviderOptions = {
  ...PROVIDERS,
  selected: "whoop",
  providers: PROVIDERS.providers.map((p) =>
    p.id === "whoop" ? { ...p, connected: true, capability: "declared" } : p,
  ),
} as ProviderOptions;

// Apple on a build with the iPhone app (APPLE_APP_AVAILABLE=1): the Apple
// Watch card is offered beside WHOOP and Junction, with the same shape.
const APPLE_METRICS = ["sleep_efficiency", "sleep_hours", "steps", "workouts"];
const APPLE_OFFERED: ProviderOptions = {
  ...PROVIDERS,
  providers: PROVIDERS.providers.map((p) =>
    p.id === "apple" ? { ...p, configured: true, metrics: APPLE_METRICS } : p,
  ),
} as ProviderOptions;
function appleWith(over: Record<string, unknown>): ProviderOptions {
  return {
    ...APPLE_OFFERED,
    selected: "apple",
    providers: APPLE_OFFERED.providers.map((p) =>
      p.id === "apple" ? { ...p, connected: true, ...over } : p,
    ),
  } as ProviderOptions;
}
const APPLE_PAIRED = appleWith({ capability: "observed", observedMetrics: ["sleep_efficiency", "sleep_hours", "workouts"] });
// The server always adds workouts to an Apple wallet that has synced anything
// (apple.ts observedMetrics): an iPhone records workouts without a Watch.
const APPLE_IPHONE_ONLY = appleWith({ capability: "observed", observedMetrics: ["steps", "workouts"] });
const APPLE_AWAITING = appleWith({ capability: "awaiting-sync" });
const APPLE_UNREADABLE = appleWith({ capability: "unknown" });
const APPLE_DEVICE = { provider: "apple", label: "Apple Health", metrics: ["sleep_efficiency", "sleep_hours", "workouts"] };
const IPHONE_ONLY_DEVICE = { provider: "apple", label: "Apple Health", metrics: ["steps", "workouts"] };

// A pairing code as the link route mints it. Fixed instants, so the "until"
// time renders the same on the server and the client.
const INSTALL_URL = "https://testflight.apple.com/join/gohealthme";
const PAIR_CODE = { code: "7KQ4MN9P", deepLink: "gohealthme://pair?code=7KQ4MN9P" };
const PAIR_STEPS: PhoneSteps = {
  instructions: "Apple Health is read on your iPhone. Open the GoHealthMe app there and allow Apple Health when it asks.",
  pairing: { ...PAIR_CODE, expiresAt: Date.UTC(2027, 0, 1, 23, 30) },
  installUrl: INSTALL_URL,
};
const PAIR_EXPIRED: PhoneSteps = {
  ...PAIR_STEPS,
  pairing: { ...PAIR_CODE, expiresAt: Date.UTC(2026, 0, 1, 23, 30) },
};

/**
 * A frame whose provider read is seeded for ADDRESS, so the pairing card can
 * show what it does after the phone's first sync without a network. Nothing
 * refetches; the card's own poll is off.
 */
function WithProviders({ options, children }: { options: ProviderOptions; children: React.ReactNode }) {
  const [client] = useState(() => {
    const c = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          gcTime: Infinity,
          retry: false,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    });
    c.setQueryData(providerOptionsQueryKey(ADDRESS), options);
    return c;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function view(over: {
  signedIn?: boolean;
  gate?: boolean;
  steps?: Partial<Record<StepId, StepState>>;
  humanMode?: CharacterView["humanMode"];
  accessStatus?: "none" | "pending" | "approved" | "denied";
  sensor?: CharacterView["sensor"];
  providers?: ProviderOptions;
  name?: string | null;
  /** How step 2 was proven, when the fixture needs the stamp to say so. */
  humanProof?: HumanProof | null;
  worldLane?: CharacterView["worldLane"];
}): CharacterView {
  const signedIn = over.signedIn ?? true;
  const steps: Record<StepId, StepState> = {
    "sign-in": signedIn ? { status: "done", summary: "mika@example.com" } : { status: "todo" },
    human: { status: "todo" },
    name: { status: "todo" },
    sensor: { status: "todo" },
    ...over.steps,
  };
  const sensor = over.sensor ?? { kind: "none" };
  return {
    ready: true,
    authenticated: signedIn,
    address: signedIn ? ADDRESS : null,
    character: signedIn
      ? {
          address: ADDRESS,
          human: steps.human.status === "done" ? "verified" : "unverified",
          ...(over.humanProof === undefined ? {} : { humanProof: over.humanProof }),
          name: over.name ?? null,
          device: sensor.kind === "paired" ? sensor.device : null,
        }
      : null,
    steps,
    gate: over.gate ?? false,
    gateLoading: false,
    humanMode: over.humanMode ?? "world",
    nameMode: "ens",
    worldLane: over.worldLane ?? "on",
    ensLane: "on",
    sensor,
    providers: over.providers ?? PROVIDERS,
    access: {
      loading: false,
      error: false,
      status: over.accessStatus ?? "none",
      isAdmin: false,
      authenticated: signedIn,
      address: signedIn ? ADDRESS : null,
      refetch: noop,
    },
    checkSensor: async () => false,
    checkingSensor: false,
    refresh: noop,
  };
}

function onboarding(skipped: StepId[] = [], done = false): Onboarding {
  return {
    skipped: new Set(skipped),
    done,
    hydrated: true,
    skip: noop,
    finish: noop,
    reopen: noop,
  };
}

const HUMAN_DONE: StepState = { status: "done", summary: "Verified with World ID" };
const NAME_DONE: StepState = { status: "done", summary: "mika.gohealthme.eth" };
const WHOOP = { provider: "whoop", label: "WHOOP", metrics: ["sleep_score", "sleep_efficiency", "sleep_hours", "workouts", "active_calories"] };

const FIXTURE_POOL: PoolInfo = {
  id: 9n,
  creator: ADDRESS,
  bountyModel: 2,
  settled: true,
  cancelled: false,
  periodStart: 1_790_000_000n,
  periodEnd: 1_790_086_400n,
  entryFee: 1_000_000n,
  balance: 0n,
  initiative: "sleep",
  goalSpec: "Sleep at least 7 hours for 1 night",
};

/**
 * My runs with a live run: the page as a player in one sees it. RunBoard reads
 * the chain and the wearable through react-query, so the fixture hands it a
 * client of its own, seeded with the answers (players, the night count, the
 * fee) and never refetching. Times are relative to now, so the clock is live.
 */
function ActiveRunBoard() {
  const [fixture] = useState(() => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const pool: PoolInfo = {
      id: 9007n,
      creator: ADDRESS,
      bountyModel: 2,
      settled: false,
      cancelled: false,
      periodStart: now - 30n * 3600n,
      periodEnd: now + 42n * 3600n,
      entryFee: 1_000_000n,
      balance: 5_000_000n,
      initiative: "Sleep 7 hours, 3 nights",
      goalSpec: "Sleep at least 7 hours for 3 nights",
    };
    const players: Player[] = [
      { address: ADDRESS, hit: false },
      { address: "0x2b6f00000000000000000000000000000000a11c", hit: true },
      { address: "0x77e100000000000000000000000000000000b0b0", hit: false },
    ];
    const progress: ProviderState = {
      kind: "ok",
      progress: {
        connected: true,
        provider: "whoop",
        linkState: "linked",
        metric: "sleep_hours",
        streakDays: 1,
        targetDays: 3,
        lastSync: new Date().toISOString(),
      },
    };
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          gcTime: Infinity,
          retry: false,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    });
    client.setQueryData(["run-players", pool.id.toString()], players);
    client.setQueryData(providerQueryKey(ADDRESS, pool.id, "sleep_hours"), progress);
    client.setQueryData(["commitment-fee-bps"], 0);
    return { pool, client };
  });
  return (
    <QueryClientProvider client={fixture.client}>
      <RunBoard pool={fixture.pool} address={ADDRESS} showLink />
    </QueryClientProvider>
  );
}

/**
 * A frame whose switches read is seeded (GET /api/switches), so the gallery
 * shows a kill switch without the dev server having one thrown. Nothing
 * refetches.
 */
function WithSwitches({ switches, children }: { switches: Switches; children: React.ReactNode }) {
  const [client] = useState(() => {
    const c = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          gcTime: Infinity,
          retry: false,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    });
    c.setQueryData(SWITCHES_QUERY_KEY, switches);
    return c;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CLAIMS: PublicFeedClaim[] = [
  {
    goalId: "0x4f1c9a0b7e2d4c61aa90b3f1e8d2c7a5b6e4f3d2c1b0a9f8e7d6c5b4a3f2e1d0",
    at: "2026-09-27T00:05:00.000Z",
    decision: "pay",
    spends: [{ at: "2026-09-27T00:01:00.000Z", label: "Wearable check", amountUsd: "0.01", settlement: "x402" }],
    recordTxs: { resultTx: "0xabc1230000000000000000000000000000000000000000000000000000000001", registryTx: null },
    settle: {
      at: "2026-09-27T00:04:00.000Z",
      status: "settled",
      paidUsd: "3.00",
      txHash: "0xabc1230000000000000000000000000000000000000000000000000000000002",
      periodEndIso: null,
    },
    selfReported: false,
    screen: { at: "2026-09-27T00:03:00.000Z", purpose: "settle", status: "clear", toxicScore: 0, traits: [], reason: "", cached: false },
    approval: { at: "2026-09-27T00:02:00.000Z", status: "approved", provider: "world", expiresAtIso: null, credential: "orb" },
  },
  {
    goalId: "0x9e2d1c0b7e2d4c61aa90b3f1e8d2c7a5b6e4f3d2c1b0a9f8e7d6c5b4a3f2e1ff",
    at: "2026-09-26T23:10:00.000Z",
    decision: "pay",
    spends: [{ at: "2026-09-26T23:09:00.000Z", label: "Wearable check", amountUsd: "0.01", settlement: "prepaid" }],
    recordTxs: null,
    settle: null,
    selfReported: false,
    approval: { at: "2026-09-26T23:10:00.000Z", status: "expired", provider: "world", expiresAtIso: null, credential: null },
  },
];

export default function OnboardingStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <StateFrame name="character-loading" note="the gate reading the player before anything renders">
        <GateLoading />
      </StateFrame>
      <StateFrame name="character-sign-in" note="step 1, signed out: email code makes the wallet">
        <CharacterCreation view={view({ signedIn: false })} onboarding={onboarding()} mode="gate" />
      </StateFrame>
      <StateFrame name="character-world-id" note="step 2, World on: one scan, the hard gate">
        <CharacterCreation view={view({})} onboarding={onboarding()} mode="gate" />
      </StateFrame>
      <StateFrame name="character-allowlist-pending" note="step 2, World off: the request is waiting on Andre">
        <CharacterCreation
          view={view({ humanMode: "allowlist", accessStatus: "pending", steps: { human: { status: "waiting", note: "Waiting on approval" } } })}
          onboarding={onboarding()}
          mode="gate"
        />
      </StateFrame>
      <StateFrame name="character-name" note="step 3 open after the World scan">
        <CharacterCreation
          view={view({ gate: true, steps: { human: HUMAN_DONE } })}
          onboarding={onboarding()}
          mode="gate"
        />
      </StateFrame>
      <StateFrame name="character-name-locked" note="/character?step=name before step 2: the name-lock line">
        <CharacterCreation
          view={view({ gate: true, humanMode: "allowlist", steps: { human: { status: "todo" }, name: { status: "locked", note: NAME_LOCKED_NOTE } } })}
          onboarding={onboarding()}
          focus="name"
          mode="page"
        />
      </StateFrame>
      <StateFrame name="character-wearable" note="step 4: every option says what it measures; Apple is not offered until the iPhone app is on this build">
        <CharacterCreation
          view={view({ gate: true, steps: { human: HUMAN_DONE, name: NAME_DONE } })}
          onboarding={onboarding()}
          mode="gate"
        />
      </StateFrame>
      <StateFrame name="player-card" note="the player card after onboarding: name + human stamp, challenges you can join, see all challenges">
        <CharacterCard
          view={view({
            gate: true,
            steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "WHOOP" } },
            sensor: { kind: "paired", device: WHOOP },
            providers: WHOOP_PAIRED,
          })}
        />
      </StateFrame>
      <StateFrame name="player-card-on-the-list" note="World on, in through the list: stamped On the list, never One human, and every challenge open">
        <CharacterCard
          view={view({
            gate: true,
            accessStatus: "approved",
            humanProof: "list",
            steps: {
              human: { status: "done", summary: "On the list" },
              name: { status: "locked", note: NAME_NEEDS_WORLD_NOTE },
              sensor: { status: "done", summary: "WHOOP" },
            },
            sensor: { kind: "paired", device: WHOOP },
            providers: WHOOP_PAIRED,
          })}
          variant="strip"
        />
      </StateFrame>
      <StateFrame name="character-list-player-world-on" note="step 2 done through the list with World on: World ID offered as optional, for a name">
        <CharacterCreation
          view={view({
            gate: true,
            accessStatus: "approved",
            humanProof: "list",
            steps: {
              human: { status: "done", summary: "On the list" },
              name: { status: "locked", note: NAME_NEEDS_WORLD_NOTE },
            },
          })}
          onboarding={onboarding()}
          focus="human"
          mode="page"
        />
      </StateFrame>
      <StateFrame name="character-world-paused" note="KILL_WORLD_ID: World ID is paused, the list is the way in, with the operator's note">
        <WithSwitches switches={{ worldId: true, baseMoneyIn: false, reason: "Back after the World upgrade on Friday." }}>
          <CharacterCreation
            view={view({ humanMode: "allowlist", worldLane: "off" })}
            onboarding={onboarding()}
            mode="gate"
          />
        </WithSwitches>
      </StateFrame>
      <StateFrame name="character-wearable-paired" note="step 4 with WHOOP: the limit is named before any stake">
        <CharacterCreation
          view={view({
            gate: true,
            steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "WHOOP" } },
            sensor: { kind: "paired", device: WHOOP },
            providers: WHOOP_PAIRED,
          })}
          onboarding={onboarding()}
          focus="sensor"
          mode="page"
        />
      </StateFrame>
      <StateFrame name="character-wearable-apple-offered" note="step 4 on a build with the iPhone app: the Apple Watch card reads like the WHOOP card">
        <CharacterCreation
          view={view({ gate: true, steps: { human: HUMAN_DONE, name: NAME_DONE }, providers: APPLE_OFFERED })}
          onboarding={onboarding()}
          focus="sensor"
          mode="page"
        />
      </StateFrame>
      <StateFrame name="character-wearable-apple-paired" note="step 4 after the phone's first sync: Apple Watch is paired, with what it counts">
        <CharacterCreation
          view={view({
            gate: true,
            steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "Apple Watch" } },
            sensor: { kind: "paired", device: APPLE_DEVICE },
            providers: APPLE_PAIRED,
          })}
          onboarding={onboarding()}
          focus="sensor"
          mode="page"
        />
      </StateFrame>
      <StateFrame name="character-wearable-apple-iphone-only" note="step 4, iPhone with no Watch: steps arrived and no sleep, so the sleep limit is named before any stake">
        <CharacterCreation
          view={view({
            gate: true,
            steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "Apple Watch" } },
            sensor: { kind: "paired", device: IPHONE_ONLY_DEVICE },
            providers: APPLE_IPHONE_ONLY,
          })}
          onboarding={onboarding()}
          focus="sensor"
          mode="page"
        />
      </StateFrame>
      <StateFrame name="character-wearable-apple-awaiting" note="step 4, code redeemed and nothing stored yet: the hold names the GoHealthMe app, not Apple Health">
        <CharacterCreation
          view={view({
            gate: true,
            steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "waiting", note: "Waiting on its first sync" } },
            sensor: { kind: "unreadable", label: "Apple Health" },
            providers: APPLE_AWAITING,
          })}
          onboarding={onboarding()}
          focus="sensor"
          mode="page"
        />
      </StateFrame>
      <StateFrame name="pair-apple-iphone" note="the pairing card on the iPhone: deep link first, Get the app second, the code after, expiry, one-tap new code" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="iphone" poll={false} />
      </StateFrame>
      <StateFrame name="pair-apple-desktop" note="the pairing card on a computer: the code leads, typed into the app on the iPhone" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="other" poll={false} />
      </StateFrame>
      <StateFrame name="pair-apple-no-install-link" note="iPhone, deployment without APPLE_APP_INSTALL_URL: the deep link alone" phone>
        <PhonePairPanel steps={{ ...PAIR_STEPS, installUrl: null }} address={ADDRESS} platform="iphone" poll={false} />
      </StateFrame>
      <StateFrame name="pair-apple-expired" note="ten minutes passed: one line, one tap" phone>
        <PhonePairPanel steps={PAIR_EXPIRED} address={ADDRESS} platform="iphone" poll={false} />
      </StateFrame>
      <StateFrame name="pair-apple-paired" note="the phone stored its first sync: the card flips by itself, no button" phone>
        <WithProviders options={APPLE_PAIRED}>
          <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="iphone" poll={false} repair={false} />
        </WithProviders>
      </StateFrame>
      <StateFrame name="pair-apple-iphone-only" note="first sync came from an iPhone alone (steps, no sleep): named as the iPhone, sleep limit said here" phone>
        <WithProviders options={APPLE_IPHONE_ONLY}>
          <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="iphone" poll={false} repair={false} />
        </WithProviders>
      </StateFrame>
      <StateFrame name="pair-apple-repair" note="Re-pair on a paired wallet: the code stays, the new phone replaces the old one, the app confirms it" phone>
        <WithProviders options={APPLE_PAIRED}>
          <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="iphone" poll={false} repair />
        </WithProviders>
      </StateFrame>
      <StateFrame name="pair-apple-no-code" note="the route answered without a code: one line, one tap, never a sentence about a code that is not there" phone>
        <PhonePairPanel steps={{ ...PAIR_STEPS, pairing: null }} address={ADDRESS} platform="iphone" poll={false} />
      </StateFrame>
      <StateFrame name="pair-apple-awaiting-sync" note="code redeemed, first day not stored yet (Health sheet still open, or denied)" phone>
        <WithProviders options={APPLE_AWAITING}>
          <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="iphone" poll={false} repair={false} />
        </WithProviders>
      </StateFrame>
      <StateFrame name="pair-apple-unreadable" note="paired, and the capability read failed this minute" phone>
        <WithProviders options={APPLE_UNREADABLE}>
          <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="iphone" poll={false} repair={false} />
        </WithProviders>
      </StateFrame>
      <StateFrame name="pair-apple-shell-pairing" note="inside the iPhone app: the code went to the shell, no code or link shown, one line while it redeems" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} />
      </StateFrame>
      <StateFrame name="pair-apple-shell-health-sheet" note="the system Health sheet is up over the page" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} shellPair={{ status: "health-sheet" }} />
      </StateFrame>
      <StateFrame name="pair-apple-shell-syncing" note="Health allowed, the app reads the last 30 days" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} shellPair={{ status: "syncing" }} />
      </StateFrame>
      <StateFrame name="pair-apple-shell-synced" note="the phone synced; the provider read is on its way back" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} shellPair={{ status: "synced", stored: 75, covered: 31, daysWithData: 31, unread: [] }} />
      </StateFrame>
      <StateFrame name="pair-apple-shell-repair" note="re-pair inside the app: the card keeps its own line until the shell has synced" phone>
        <WithProviders options={APPLE_PAIRED}>
          <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} repair shellPair={{ status: "syncing" }} />
        </WithProviders>
      </StateFrame>
      <StateFrame name="pair-apple-shell-nothing-synced" note="Health denied or an idle Watch: nothing stored, not paired, Try again and Open Settings" phone>
        <WithProviders options={APPLE_AWAITING}>
          <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} repair={false} shellPair={{ status: "synced", stored: 0, covered: 0, daysWithData: 0, unread: [] }} />
        </WithProviders>
      </StateFrame>
      <StateFrame name="pair-apple-shell-code-failed" note="the shell could not redeem or save the code: one line, a new code" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} shellPair={{ status: "failed", reason: "invalid-code", message: "That code did not work. Codes last ten minutes and work once." }} />
      </StateFrame>
      <StateFrame name="pair-apple-shell-health-unreadable" note="no Health query answered: the app's own line, Try again" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} shellPair={{ status: "failed", reason: "health-unreadable", message: "Health could not be read. Check Health access in Settings and try again." }} />
      </StateFrame>
      <StateFrame name="pair-apple-shell-revoked" note="another phone took the pairing meanwhile: Pair again" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} shellPair={{ status: "failed", reason: "revoked", message: "This iPhone is no longer paired. Get a new code on the GoHealthMe website and pair again." }} />
      </StateFrame>
      <StateFrame name="pair-apple-shell-awaiting-sync" note="the read says redeemed and nothing stored, no word from the shell yet: allow Health, never open an app you are in" phone>
        <WithProviders options={APPLE_AWAITING}>
          <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} repair={false} />
        </WithProviders>
      </StateFrame>
      <StateFrame name="pair-apple-shell-no-health" note="iPad or simulator: Apple Health cannot be read, said before any code is handed over" phone>
        <PhonePairPanel steps={PAIR_STEPS} address={ADDRESS} platform="shell" poll={false} healthAvailable={false} />
      </StateFrame>
      <StateFrame name="my-runs-signed-out" note="/dashboard signed out: SPOTTER on the sign-in card">
        <div className={PAGE_COLUMN}>
          <MyRunsFrame pose="wave" lead="Sign in to see your challenges, your nights and your payouts. Base Sepolia test USDC.">
            <SignInPanel surface="card" />
          </MyRunsFrame>
        </div>
      </StateFrame>
      <StateFrame name="my-runs-loading" note="reading the challenges from Base Sepolia">
        <div className={PAGE_COLUMN}>
          <MyRunsFrame pose="detective">
            <LoadingCard label="Reading your challenges from Base Sepolia" />
          </MyRunsFrame>
        </div>
      </StateFrame>
      <StateFrame name="my-runs-empty" note="signed in, in no challenge: one pose, one line, one action">
        <div className={PAGE_COLUMN}>
          <MyRunsFrame pose="meditate">
            <EmptyCard
              title="You are not in a challenge yet"
              detail="Pick a challenge and put money on yourself, or start one with a friend. Your nights show up here."
              action={
                <Link href="/pools" className={buttonClasses({ size: "sm" })}>
                  Find a challenge
                </Link>
              }
            />
          </MyRunsFrame>
        </div>
      </StateFrame>
      <StateFrame name="my-runs-error" note="the challenges read failed; nothing changed">
        <div className={PAGE_COLUMN}>
          <MyRunsFrame pose="thinking">
            <Card>
              <ErrorNote
                title="Could not read your challenges"
                detail="I could not read your challenges from Base Sepolia just now. Nothing changed on your side."
                retryLabel="Read my challenges again"
                onRetry={noop}
              />
            </Card>
          </MyRunsFrame>
        </div>
      </StateFrame>
      <StateFrame
        name="my-runs-active"
        note="in a live challenge: the board carries its own scene, so no pose in the header; night count, If you hit, Who's in"
      >
        <div className={`${PAGE_COLUMN} [&>*+*]:mt-8`}>
          <div className="[&>*+*]:mt-5">
            <header>
              <h1 className={PAGE_TITLE}>My challenges</h1>
              <p className={PAGE_LEAD}>{MY_RUNS_LEAD}</p>
            </header>
            <CharacterCard
              view={view({
                name: "mika.gohealthme.eth",
                steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "WHOOP" } },
                sensor: { kind: "paired", device: WHOOP },
                providers: WHOOP_PAIRED,
              })}
              variant="strip"
            />
          </div>
          <ActiveRunBoard />
        </div>
      </StateFrame>
      <StateFrame name="my-runs-finished" note="only completed challenges: SPOTTER on the character strip, result rows below">
        <div className={`${PAGE_COLUMN} [&>*+*]:mt-8`}>
          <PerchedHeader title="My challenges" lead={MY_RUNS_LEAD} pose="thumbsup">
            <CharacterCard
              view={view({
                name: "mika.gohealthme.eth",
                steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "WHOOP" } },
                sensor: { kind: "paired", device: WHOOP },
                providers: WHOOP_PAIRED,
              })}
              variant="strip"
            />
          </PerchedHeader>
          <section className="[&>*+*]:mt-3">
            <h2 className="type-heading text-[1.625rem]">Completed challenges</h2>
            <FinishedRunRow pool={FIXTURE_POOL} result={{ text: "Paid", tone: "accent" }} />
            <FinishedRunRow
              pool={{ ...FIXTURE_POOL, id: 12n, goalSpec: "Complete at least 1 workout for 3 days", balance: 0n }}
              result={{ text: "Refunded - payout not confirmed", tone: "muted" }}
            />
          </section>
        </div>
      </StateFrame>
      <StateFrame name="history-feed" note="/agent with claims: rows, badges, tx links, no pose per row">
        <div className={PAGE_COLUMN}>
          <PerchedHeader
            title="History"
            lead="Every verdict SPOTTER reached on your challenges, your World ID confirmations, and what each challenge paid."
            pose="detective"
          >
            <Card className="[&>*+*]:mt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className={CARD_TITLE}>Your history</h2>
                <div role="group" aria-label="Whose history" className="flex gap-2">
                  <Chip selected>Yours</Chip>
                  <Chip>Everyone</Chip>
                </div>
              </div>
              <ol className="list-none">
                {CLAIMS.map((claim) => (
                  <ClaimCard key={claim.goalId} claim={claim} />
                ))}
              </ol>
            </Card>
          </PerchedHeader>
        </div>
      </StateFrame>
      <StateFrame name="history-empty" note="signed in, nothing checked yet">
        <div className={PAGE_COLUMN}>
          <PerchedHeader title="History" lead="Every verdict SPOTTER reached on your challenges." pose="detective">
            <Card>
              <FeedEmpty
                title="Nothing in your history yet"
                detail="When SPOTTER checks one of your challenges, its verdict, your World ID confirmation and the payout land here. Everyone's claims are one tap away."
              />
            </Card>
          </PerchedHeader>
        </div>
      </StateFrame>
      <StateFrame name="settings-signed-in" note="/settings with the provisioned wallet and WHOOP paired">
        <PerchedHeader
          className={PAGE_COLUMN}
          title="Settings"
          lead="Your wallet and where your test USDC lives, the name you play under, and the wearable SPOTTER reads."
          pose="wearable"
        >
          <WalletDetailView
            address={ADDRESS}
            isEmbedded
            connectorName={null}
            view={view({
              name: "mika.gohealthme.eth",
              steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "WHOOP" } },
              sensor: { kind: "paired", device: WHOOP },
              providers: WHOOP_PAIRED,
            })}
            balance={{ isLoading: false, isError: false, data: 12_500_000n, refetch: noop }}
            logout={noop}
          />
        </PerchedHeader>
      </StateFrame>
      <StateFrame name="settings-external-wallet" note="/settings on MetaMask, balance read failed, no wearable">
        <PerchedHeader className={PAGE_COLUMN} title="Settings" pose="wearable">
          <WalletDetailView
            address={ADDRESS}
            isEmbedded={false}
            connectorName="MetaMask"
            view={view({})}
            balance={{ isLoading: false, isError: true, data: undefined, refetch: noop }}
            logout={noop}
          />
        </PerchedHeader>
      </StateFrame>
      <StateFrame name="profile-with-runs" note="/u/[handle] with runs hit: a verified and a self-reported row">
        <ProfilePaidWall
          profile={{
            handle: "mika",
            emoji: "M",
            address: ADDRESS,
            goalsHit: 3,
            verifiedWins: 2,
            selfReportedWins: 1,
            usdcEarned: "7.50",
            winStreak: 2,
            readOk: true,
            wins: [
              { id: "a", at: "2026-09-26T23:00:00.000Z", amountUsd: "3.00", txHash: "0xabc1230000000000000000000000000000000000000000000000000000000002", role: "achiever", tier: "verified" },
              { id: "b", at: "2026-09-20T08:30:00.000Z", amountUsd: "1.50", txHash: "0xabc1230000000000000000000000000000000000000000000000000000000003", role: "achiever", tier: "self-reported" },
            ],
          }}
        />
      </StateFrame>
      <StateFrame name="profile-read-failed" note="/u/[handle] when the chain does not answer: no zeros as fact">
        <ProfilePaidWall
          profile={{
            handle: "mika",
            emoji: "M",
            address: ADDRESS,
            goalsHit: 0,
            verifiedWins: 0,
            selfReportedWins: 0,
            usdcEarned: "0.00",
            winStreak: 0,
            readOk: false,
            wins: [],
          }}
        />
      </StateFrame>
      <StateFrame name="feed-with-payouts" note="/feed rows: name, time, tx, amount; self-reported tagged">
        <div className={PAGE_COLUMN}>
          <PerchedHeader title="Who got paid" lead="Recent payouts on Base Sepolia, named by handle." pose="thumbsup">
            <Card>
              <h2 className={CARD_TITLE}>Payout feed</h2>
              <ul className="mt-4 list-none">
                <PayoutRow payout={{ at: "2026-09-26T23:00:00.000Z", handle: "mika", address: ADDRESS, amountUsd: "3.00", txHash: "0xabc1230000000000000000000000000000000000000000000000000000000002", selfReported: false }} />
                <PayoutRow payout={{ at: "2026-09-26T21:00:00.000Z", handle: null, address: "0x51f2000000000000000000000000000000a90c", amountUsd: "1.50", txHash: "0xabc1230000000000000000000000000000000000000000000000000000000004", selfReported: true }} />
              </ul>
            </Card>
          </PerchedHeader>
        </div>
      </StateFrame>
      <StateFrame name="character-done" note="all four done: the card and the way in">
        <CharacterCreation
          view={view({
            gate: true,
            name: "mika.gohealthme.eth",
            steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "WHOOP" } },
            sensor: { kind: "paired", device: WHOOP },
            providers: WHOOP_PAIRED,
          })}
          onboarding={onboarding()}
          mode="gate"
        />
      </StateFrame>
    </GallerySection>
  );
}
