"use client";

import { GallerySection, StateFrame, type SectionProps } from "../_kit";
import CharacterCreation from "@/components/game/CharacterCreation";
import { GateLoading } from "@/components/AccessGate";
import type { CharacterView } from "@/lib/game/useCharacter";
import type { Onboarding } from "@/lib/game/onboarding-store";
import type { StepId, StepState } from "@/lib/game/character";
import { NAME_LOCKED_NOTE } from "@/lib/game/character";
import type { ProviderOptions } from "@/lib/wearable-connect";
import Link from "next/link";
import { ClaimCard, FeedEmpty } from "@/app/agent/AgentFeed";
import { FinishedRunRow, LoadingCard, MY_RUNS_LEAD, MyRunsFrame } from "@/components/DashboardContent";
import { WalletDetailView } from "@/components/WalletSettings";
import CharacterCard from "@/components/game/CharacterCard";
import SignInPanel from "@/components/SignInPanel";
import { CARD_TITLE, EmptyCard, PAGE_COLUMN, PerchedHeader } from "@/components/night/kit";
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

function view(over: {
  signedIn?: boolean;
  gate?: boolean;
  steps?: Partial<Record<StepId, StepState>>;
  humanMode?: CharacterView["humanMode"];
  accessStatus?: "none" | "pending" | "approved" | "denied";
  sensor?: CharacterView["sensor"];
  providers?: ProviderOptions;
  name?: string | null;
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
          name: over.name ?? null,
          device: sensor.kind === "paired" ? sensor.device : null,
        }
      : null,
    steps,
    gate: over.gate ?? false,
    gateLoading: false,
    humanMode: over.humanMode ?? "world",
    nameMode: "ens",
    worldLane: "on",
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
      <StateFrame name="character-wearable" note="step 4: every option says what it measures; Apple says it cannot pair yet">
        <CharacterCreation
          view={view({ gate: true, steps: { human: HUMAN_DONE, name: NAME_DONE } })}
          onboarding={onboarding()}
          mode="gate"
        />
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
      <StateFrame name="my-runs-signed-out" note="/dashboard signed out: SPOTTER on the sign-in card">
        <div className={PAGE_COLUMN}>
          <MyRunsFrame pose="wave" lead="Sign in to see your runs, your nights and your payouts. Base Sepolia test USDC.">
            <SignInPanel surface="card" />
          </MyRunsFrame>
        </div>
      </StateFrame>
      <StateFrame name="my-runs-loading" note="reading the runs from Base Sepolia">
        <div className={PAGE_COLUMN}>
          <MyRunsFrame pose="detective">
            <LoadingCard label="Reading your runs from Base Sepolia" />
          </MyRunsFrame>
        </div>
      </StateFrame>
      <StateFrame name="my-runs-empty" note="signed in, in no run: one pose, one line, one action">
        <div className={PAGE_COLUMN}>
          <MyRunsFrame pose="meditate">
            <EmptyCard
              title="You are not in a run yet"
              detail="Pick a run in the lobby and put money on yourself. Your nights show up here."
              action={
                <Link href="/pools" className={buttonClasses({ size: "sm" })}>
                  Find a run
                </Link>
              }
            />
          </MyRunsFrame>
        </div>
      </StateFrame>
      <StateFrame name="my-runs-error" note="the runs read failed; nothing changed">
        <div className={PAGE_COLUMN}>
          <MyRunsFrame pose="thinking">
            <Card>
              <ErrorNote
                title="Could not read your runs"
                detail="I could not read your runs from Base Sepolia just now. Nothing changed on your side."
                retryLabel="Read my runs again"
                onRetry={noop}
              />
            </Card>
          </MyRunsFrame>
        </div>
      </StateFrame>
      <StateFrame name="my-runs-finished" note="only finished runs: SPOTTER on the character strip, result rows below">
        <div className={`${PAGE_COLUMN} [&>*+*]:mt-8`}>
          <PerchedHeader title="My runs" lead={MY_RUNS_LEAD} pose="thumbsup">
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
            <h2 className="type-heading text-[1.625rem]">Finished runs</h2>
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
            lead="Every verdict SPOTTER reached on your runs, your World ID confirmations, and what each run paid."
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
          <PerchedHeader title="History" lead="Every verdict SPOTTER reached on your runs." pose="detective">
            <Card>
              <FeedEmpty
                title="Nothing in your history yet"
                detail="When SPOTTER checks one of your runs, its verdict, your World ID confirmation and the payout land here. Everyone's claims are one tap away."
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
