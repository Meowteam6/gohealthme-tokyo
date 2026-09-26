"use client";

import type { ReactNode } from "react";
import { ButtonLink, Card, Fine } from "@/components/ui";
import WearableCheck from "@/components/WearableCheck";
import HoldCoin from "@/components/spotter/HoldCoin";
import JoinMoment from "@/components/JoinMoment";
import { FundingHelpView } from "@/components/FundingHelp";
import RunHero from "@/components/run/RunHero";
import RunLayout from "@/components/run/RunLayout";
import HoldBar from "@/components/run/HoldBar";
import StakeLock from "@/components/run/StakeLock";
import {
  StakeAction,
  StakeCard,
  StakeChecks,
  StakeFailed,
  StakePending,
  StakeStats,
  StakeVault,
  type StakeCheck,
} from "@/components/run/StakeCard";
import { MissUnderStake, MoneyLineBox, MoneyTermsList } from "@/components/game/MoneyTerms";
import YourNight, { type NightRail } from "@/components/run/YourNight";
import WhosIn, { type RosterRow } from "@/components/run/WhosIn";
import AlsoOpen from "@/components/run/AlsoOpen";
import ChallengeFriend from "@/components/run/ChallengeFriend";
import { joinCoinCopy } from "@/components/join-coin";
import { formatUsdc } from "@/lib/contract";
import { sponsorPotOf, type CommitmentTerms } from "@/lib/game/commitment-copy";
import { momentLabel, runMoneyOf, type RunMoney } from "@/lib/game/money-flow";
import { missConfirmByMs } from "@/lib/miss-grace";
import type { SpotterScreenState } from "@/lib/spotter-poses";
import {
  clockLabel,
  closeLabelOf,
  endsLabel,
  friendMathOf,
  leftLabel,
  nightTimelineOf,
  runHeadlineOf,
} from "@/lib/game/run-page";
import { GallerySection, StateFrame, type SectionProps } from "../_kit";

// Run page states for the dev gallery (docs/DESIGN.md, "Stake card states").
// Every frame is the real page grid with the real run components and fixture
// props: pool 5 as it reads on chain (1.00 stake, a 2.00 sponsor pot, ends Sun
// 08:30 JST), seen at 15:49 JST the day before. Every figure is computed by
// lib/commitment.ts through lib/game/run-page.ts, never typed. The sign-in
// sheet and its code step from the mock are Dynamic's own modal on this build
// (docs/DESIGN.md, Decisions), shown under Foundation.

export const USDC = 1_000_000n;
export const TZ = "Asia/Tokyo";
/** Sun 27 Sep 2026, 08:30 JST. */
export const END = BigInt(Date.parse("2026-09-27T08:30:00+09:00") / 1000);
/** Sat 26 Sep 2026, 15:49 JST. */
export const NOW = Date.parse("2026-09-26T15:49:00+09:00") / 1000;
export const GOAL = "Sleep at least 7 hours for 1 night";
export const HEADLINE = runHeadlineOf({ goalSpec: GOAL, periodEnd: END, timeZone: TZ });

export function termsFor(players: number): CommitmentTerms {
  // The sponsor put 2.00 in; every player adds their own 1.00 stake. A sleep
  // run past the miss-rule cutoff, so a miss can go to the players who hit.
  return { entryFee: USDC, players, balance: 2n * USDC + BigInt(players) * USDC, feeBps: 0, recordsMisses: true };
}

const OPEN = termsFor(0);
const IN = termsFor(1);

/** The run's money flow as the page builds it (lib/game/money-flow.ts): a
 *  group run, the reader about to stake unless already in. */
function moneyFor(t: CommitmentTerms, includeJoiner = true): RunMoney {
  return runMoneyOf({
    pool: { bountyModel: 2, initiative: "Sleep 7 hours Saturday night" },
    flow: { players: t.players, creatorStaked: null, creatorName: "0x5A1c...00b7" },
    numbers: {
      entryFee: t.entryFee,
      players: t.players,
      pot: sponsorPotOf(t),
      feeBps: t.feeBps,
      recordable: t.recordsMisses,
      includeJoiner,
      confirmBy: momentLabel(missConfirmByMs(END), TZ),
    },
  });
}

/** The miss chip under the stake button; the Miss term above says the rest. */
function UnderStake({ t }: { t: CommitmentTerms }) {
  const money = moneyFor(t);
  return money.copy !== null ? <MissUnderStake miss={money.miss} detail={null} /> : null;
}
const STAKE = formatUsdc(USDC);
const END_CLOCK = clockLabel(Number(END), TZ);

/** The run page's hero on a group run: the tag alone, as the mock has it. */
export function RunHeroFixture({
  spotter,
  ended = false,
}: {
  spotter: SpotterScreenState | null;
  ended?: boolean;
}) {
  const left = leftLabel(END, NOW);
  return (
    <RunHero
      tag={ended ? { tone: "ended", label: "Ended" } : { tone: "live", label: "Open tonight" }}
      figure={HEADLINE.figure}
      rest={HEADLINE.rest}
      ends={
        ended ? (
          <>
            Ended <b>{endsLabel(END, TZ)}</b>
          </>
        ) : (
          <>
            Ends <b>{endsLabel(END, TZ)}</b>, in {left}
          </>
        )
      }
      spotter={spotter}
    />
  );
}

function Terms({ t, id }: { t: CommitmentTerms; id: string }) {
  const money = moneyFor(t);
  return (
    <>
      <StakeStats stake={STAKE} pot={formatUsdc(t.balance)} players={t.players} />
      {money.copy !== null ? (
        <>
          <MoneyTermsList
            copy={money.copy}
            id={id}
            line={false}
            skip={["stake"]}
            className="mt-3.5 border-t border-edge pt-3.5"
          />
          <MoneyLineBox copy={money.copy} />
        </>
      ) : null}
    </>
  );
}

const CLEARED: StakeCheck[] = [
  {
    key: "device",
    glyph: "ok",
    children: (
      <>
        <b>Your WHOOP</b> tracks hours of sleep, so it can check this challenge
      </>
    ),
  },
  {
    key: "human",
    glyph: "ok",
    children: (
      <>
        Joining as <b>mika.gohealthme.eth</b>, verified as one person
      </>
    ),
  },
];

const BETA = "Beta: test USDC on Base Sepolia, no real money. Refunded if nobody hits.";

function Hold({ bar = false }: { bar?: boolean }) {
  const coin = joinCoinCopy(USDC, "idle");
  return (
    <HoldCoin
      onCommit={() => {}}
      label={coin.label}
      hint={coin.hint}
      tapLabel={bar ? "Tap instead" : undefined}
      confirmPrompt={`Stake ${STAKE} USDC on ${HEADLINE.figure} ${HEADLINE.rest}?`}
      confirmLabel={coin.confirmLabel}
      committedHint={coin.committedHint}
    />
  );
}

function Night({ caption, joined = false, device = "WHOOP" }: { caption: string; joined?: boolean; device?: string }) {
  const t = nightTimelineOf({ nowSec: NOW, periodEnd: END, goalHours: HEADLINE.threshold });
  const rail: NightRail | null =
    t !== null
      ? { latestPct: t.latestPct, latestLabel: clockLabel(t.latestSec, TZ), blockLabel: `${HEADLINE.threshold}h` }
      : null;
  return (
    <YourNight
      nowLabel={`Now ${clockLabel(NOW, TZ)}`}
      caption={caption}
      captionLive={joined}
      endLabel={END_CLOCK}
      rail={rail}
      railLabel={`From now to the ${END_CLOCK} close. Asleep by ${rail?.latestLabel ?? ""} fits ${HEADLINE.short}.`}
      note={
        <>
          To fit {HEADLINE.short} before the {END_CLOCK} close, be asleep by{" "}
          <b>{rail?.latestLabel}</b> at the latest. Your {device} counts time asleep, not time in
          bed. Open the {device} app when you wake so the night syncs.
        </>
      }
    />
  );
}

function Roster({ rows, joined = false }: { rows: RosterRow[]; joined?: boolean }) {
  const math = friendMathOf(joined ? IN : OPEN, joined);
  return (
    <WhosIn
      rows={rows}
      copy={
        math !== null ? (
          <>
            Bring a friend. If you both hit, each gets <b>{math.bothHit}</b>. If they miss, you get{" "}
            <b>{math.friendMisses}</b>.
          </>
        ) : undefined
      }
      action={
        joined ? undefined : (
          <ChallengeFriend path="/pools/5" text="Put money on yourself with me." variant="secondary" />
        )
      }
    />
  );
}

const ALSO = [
  {
    href: "/pools/6",
    title: "Sleep efficiency 85% tonight",
    ends: endsLabel(END + 7200n, TZ),
    stake: STAKE,
    pot: formatUsdc(2n * USDC),
  },
  {
    href: "/pools/7",
    title: "One workout today",
    ends: endsLabel(END - 1800n, TZ),
    stake: STAKE,
    pot: formatUsdc(3n * USDC),
  },
];

const GUEST_CAPTION =
  "Wear whatever tracks your sleep to bed. When you wake, sync it and send me in to read the night.";
const WHOOP_CAPTION =
  "Wear your WHOOP to bed. When you wake, sync it and send me in to read the night.";

function Page({
  spotter = "run-open",
  stake,
  caption = WHOOP_CAPTION,
  joined = false,
  also = true,
  device = "WHOOP",
  children,
}: {
  spotter?: SpotterScreenState | null;
  stake: ReactNode;
  caption?: string;
  joined?: boolean;
  also?: boolean;
  device?: string;
  children?: ReactNode;
}) {
  const me: RosterRow = {
    key: "me",
    name: "mika.gohealthme.eth",
    initial: "M",
    you: true,
    status: "You, night to play",
    hit: false,
  };
  return (
    <RunLayout hero={<RunHeroFixture spotter={spotter} />} stake={stake}>
      <Night caption={caption} joined={joined} device={device} />
      {children}
      <Roster rows={joined ? [me] : []} joined={joined} />
      {also ? <AlsoOpen rows={ALSO} sub={`Other challenges your ${device} can check`} /> : null}
    </RunLayout>
  );
}

export default function RunStates({ meta }: SectionProps) {
  const zero = 0n;
  return (
    <GallerySection meta={meta}>
      <StateFrame name="run-guest" note="signed out: the run reads, the one action is sign in">
        <Page
          caption={GUEST_CAPTION}
          stake={
            <StakeCard>
              <Terms t={OPEN} id="gallery-terms-1" />
              <StakeAction
                fine="Sign in with Base or email, no seed phrase. You make your player once, then land back on this challenge."
              >
                <ButtonLink href="/character?next=%2Fpools%2F5" block>
                  Sign in to stake {STAKE} USDC
                </ButtonLink>
                <UnderStake t={OPEN} />
              </StakeAction>
              <StakeVault />
            </StakeCard>
          }
        />
      </StateFrame>

      <StateFrame name="run-default" note="signed in, every check cleared: hold to stake, tap to confirm instead">
        <Page
          stake={
            <StakeCard>
              <Terms t={OPEN} id="gallery-terms-2" />
              <StakeChecks items={CLEARED} />
              <StakeAction fine={BETA}>
                <Hold />
                <UnderStake t={OPEN} />
              </StakeAction>
              <StakeVault />
            </StakeCard>
          }
        />
      </StateFrame>

      <StateFrame
        name="run-default-one-in"
        note="one player already in: joining makes two, so a miss goes to who hits, in the Miss term and on the chip under the hold"
      >
        <Page
          stake={
            <StakeCard>
              <Terms t={IN} id="gallery-terms-2b" />
              <StakeChecks items={CLEARED} />
              <StakeAction fine={BETA}>
                <Hold />
                <UnderStake t={IN} />
              </StakeAction>
              <StakeVault />
            </StakeCard>
          }
        />
      </StateFrame>

      <StateFrame name="run-zero-balance" note="the hold found 0.00 in the wallet: nothing moved, add free test USDC">
        <Page
          stake={
            <StakeCard>
              <Terms t={OPEN} id="gallery-terms-3" />
              <StakeChecks items={CLEARED} />
              <StakeAction>
                <FundingHelpView
                  address="0x5A1c0000000000000000000000000000000000b7"
                  balance={zero}
                  headline={`You need ${STAKE} to stake.`}
                  extra=""
                  funding={false}
                  primaryLabel="Add free test USDC"
                  onFund={() => {}}
                  funded={false}
                  fallbackReason={null}
                  recheckLabel="I added it, check again"
                  onRecheck={() => {}}
                />
              </StakeAction>
              <StakeVault />
            </StakeCard>
          }
        />
      </StateFrame>

      <StateFrame name="run-locked-apple" note="Apple Watch linked, nothing synced yet: locked before any stake, one tap to check again">
        <Page
          device="Apple Watch"
          caption="Your Apple Watch has not sent me a night yet. Open its app so it syncs, and I'll check this challenge."
          stake={
            <StakeCard>
              <Terms t={OPEN} id="gallery-terms-4" />
              <StakeLock
                lock={{ kind: "sensor-hold", hold: "awaiting-sync", deviceLabel: "Apple Watch" }}
                returnTo="/pools/5"
                onCheckSensor={async () => false}
              />
              <StakeVault />
            </StakeCard>
          }
        />
      </StateFrame>

      <StateFrame name="run-locked-hardware" note="WHOOP on a step run: no pedometer, said plainly, with the fix">
        <Page
          caption="WHOOP can't send me a step count. Pair a wearable that tracks it and I'll check this challenge."
          stake={
            <StakeCard>
              <Terms t={OPEN} id="gallery-terms-5" />
              <StakeLock
                lock={{ kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" }}
                returnTo="/pools/5"
              />
              <StakeVault />
            </StakeCard>
          }
        />
      </StateFrame>

      <StateFrame name="run-pending" note="after the hold: the stake is on its way, nothing to press">
        <Page
          stake={
            <StakeCard>
              <StakePending
                title={`Putting ${STAKE} USDC in the pot`}
                detail="This takes a few seconds on Base Sepolia. Approve it in your wallet if it asks, and keep this page open."
              />
            </StakeCard>
          }
        />
      </StateFrame>

      <StateFrame name="run-failed" note="the stake did not land: nothing left the wallet, one retry">
        <Page
          stake={
            <StakeCard>
              <StakeFailed
                title="The stake did not go through"
                detail="Nothing left your wallet. The network did not confirm in time."
                raw="TransactionExecutionError: timeout waiting for receipt"
                onRetry={() => {}}
                retryLabel="Try the stake again"
              />
            </StakeCard>
          }
        />
      </StateFrame>

      <StateFrame name="run-joined" note="you're in: lights out, SPOTTER asleep on the card, the challenge is the one action">
        <Page
          spotter="run-joined"
          joined
          also={false}
          caption={`You're in. I'm asleep till ${END_CLOCK}. You should be too.`}
          stake={
            <StakeCard label="Your stake">
              <JoinMoment
                txHash="0x8f2e4c1b9a7d3e6f5c2b1a0d9e8f7c6b5a4d3e2f1c0b9a8d7e6f5c4b3a2d1e0f"
                fresh={false}
                stake={STAKE}
                pot={formatUsdc(IN.balance)}
                players={IN.players}
                night
                deviceName="WHOOP"
                goalShort={HEADLINE.short}
                closeLabel={closeLabelOf(END, TZ)}
                closeClock={END_CLOCK}
                icsHref="data:text/calendar;charset=utf-8,BEGIN%3AVCALENDAR"
                action={<ChallengeFriend path="/pools/5" text="Put money on yourself with me." />}
              />
            </StakeCard>
          }
        />
      </StateFrame>

      <StateFrame name="run-check" note="joined, the proof card: the live WearableCheck reading pool 5 (signed out here, so it asks you to sign in)">
        <div className="max-w-[732px]">
          <Card as="section" aria-labelledby="gallery-proof-h">
            <h2 id="gallery-proof-h" className="m-0 text-[1.0625rem] font-semibold">
              Send SPOTTER in
            </h2>
            <div className="mt-4">
              <WearableCheck poolId={5n} goalSpec={GOAL} />
            </div>
          </Card>
        </div>
      </StateFrame>

      <StateFrame name="run-hold-bar" phone note="phone only: once the rules were read and the card's own hold scrolled away">
        <HoldBar mode="hold" actionIds={[]} watchKey="gallery" inline>
          <Hold bar />
          <Fine className="-mt-1">Beta. Refunded if nobody hits.</Fine>
        </HoldBar>
      </StateFrame>

      <StateFrame name="run-hold-bar-in" phone note="phone only, after joining: the bar says you're in and carries the challenge">
        <HoldBar mode="in" actionIds={[]} watchKey="gallery-in" inline>
          <p className="num m-0 mb-2 text-[0.9375rem] font-semibold">
            You&apos;re in. <span className="font-medium text-muted">Your {STAKE} is in the pot.</span>
          </p>
          <ChallengeFriend path="/pools/5" text="Put money on yourself with me." variant="secondary" />
        </HoldBar>
      </StateFrame>
    </GallerySection>
  );
}
