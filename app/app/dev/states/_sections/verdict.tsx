"use client";

import type { ReactNode } from "react";
import { Button, ButtonLink, Card, Fine } from "@/components/ui";
import AgentReceipt from "@/components/AgentReceipt";
import PayoutMoment from "@/components/PayoutMoment";
import type { LedgerEntry } from "@/lib/agent-receipt";
import PayoutScreening from "@/components/intercepta/PayoutScreening";
import { VerdictView, verdictHeadOf } from "@/components/game/VerdictStage";
import { ApprovalAsk, ApprovalOutcomeView } from "@/components/world/HumanApprovalCard";
import RunLayout from "@/components/run/RunLayout";
import WhosIn, { type RosterRow } from "@/components/run/WhosIn";
import ChallengeFriend from "@/components/run/ChallengeFriend";
import { commitmentOutcome } from "@/lib/commitment";
import { formatUsdc } from "@/lib/contract";
import { hitRange } from "@/lib/game/commitment-copy";
import { paidShareText } from "@/lib/game/run-page";
import type { VerdictScreen } from "@/lib/game/verdict";
import type { SpotterScreenState } from "@/lib/spotter-poses";
import { GallerySection, StateFrame, type SectionProps } from "../_kit";
import { HEADLINE, RunHeroFixture, USDC, termsFor } from "./run";

// Verdict states for the dev gallery (docs/DESIGN.md, "Verdict card"): the
// real VerdictView, the real World ID ask and outcome views, and the real
// paper receipt, fed the fixture run from the run section after its 08:30
// close. The paid amount and every split come from lib/commitment.ts.

const STAKE = formatUsdc(USDC);
const TX = "0x3b9f0c2a7e61d4a58c0f7e2d9b4a6c1e8f3d5b7a9c2e4f6a8b0d1c3e5f7a9b2c";

/** Pool 5 with one player (you) who hit it alone: stake back plus the pot. */
const SOLO = termsFor(1);
const SOLO_PAID = (() => {
  const o = commitmentOutcome({
    entryFee: SOLO.entryFee,
    players: 1,
    achievers: 1,
    sponsorPot: 2n * USDC,
    feeBps: 0,
  });
  return formatUsdc(o.kind === "paid" ? o.perAchiever : o.refundEach);
})();

const ME: RosterRow = { key: "me", name: "mika.gohealthme.eth", initial: "M", you: true, status: "You, hit", hit: true };
const ME_MISSED: RosterRow = { ...ME, status: "You", hit: false };
const NIKKI: RosterRow = { key: "nikki", name: "nikki.gohealthme.eth", initial: "N", you: false, status: "Hit", hit: true };

function head(screen: VerdictScreen, achievers: number | null = null) {
  const h = verdictHeadOf({
    screen,
    goalShort: HEADLINE.short,
    deviceName: "WHOOP",
    selfStaked: true,
    entryFee: USDC,
    settleAchievers: achievers,
  });
  if (h === null) throw new Error("no verdict head");
  return h;
}

function Page({
  spotter,
  card,
  rows,
  proof,
}: {
  spotter: SpotterScreenState | null;
  card: ReactNode;
  rows: RosterRow[];
  /** The proof card, in the main column above Who's in, as on the pool page. */
  proof?: ReactNode;
}) {
  return (
    <RunLayout hero={<RunHeroFixture spotter={spotter} ended />} stake={card}>
      {proof}
      <WhosIn rows={rows} />
    </RunLayout>
  );
}

// SPOTTER's receipt on the proof card, with the ledger shapes the server
// writes (lib/server/agent/wearable.ts reasons, reason.ts fixed-rule notes).
// The pool-2 shape from 2026-09-27: a "still syncing" read and its no-pay,
// then the hit, the pay decision and the World ID ask.
const R_AT = "2026-09-27T08:12:00+09:00";
const R_LATER = "2026-09-27T08:41:00+09:00";
const R_REF = "wearable-1790348400";
const FIXED = "Checked by SPOTTER's fixed rule.";
const SYNCING =
  "Your wearable is connected but has not synced any sleep data for this period yet. Give it a few minutes to sync, then run the check again.";
const HIT =
  "Your wearable shows 1 qualifying days (7+ hours of sleep) inside this pool period, meeting the 1-day goal.";
const SHORT =
  "Your wearable shows 0 of 1 qualifying days (7+ hours of sleep) inside this pool period. The goal is not met yet.";

const R_START: LedgerEntry[] = [
  {
    kind: "plan",
    at: R_AT,
    steps: [{ service: "whoop-read", label: "WHOOP sleep read", estUsd: "0.00" }],
    capUsd: "1.00",
  },
  {
    kind: "spend",
    at: R_AT,
    service: "whoop-read",
    label: "WHOOP sleep read",
    amountUsd: "0.00",
    ref: R_REF,
    settlement: "prepaid",
  },
  { kind: "verdict", at: R_AT, verified: false, confidence: "low", reason: SYNCING, ref: R_REF },
  { kind: "reason", at: R_AT, decision: "no-pay", note: `${FIXED} not paying: ${SYNCING}`, ref: R_REF },
];

const HIT_AFTER_BAD_READ: LedgerEntry[] = [
  ...R_START,
  { kind: "verdict", at: R_LATER, verified: true, confidence: "high", reason: HIT, ref: R_REF },
  {
    kind: "reason",
    at: R_LATER,
    decision: "pay",
    note: `${FIXED} verified, high confidence. paying.`,
    ref: R_REF,
  },
  {
    kind: "approval",
    at: R_LATER,
    status: "requested",
    requestId: "req-1",
    action: "settle:0x01:1",
    provider: "world",
  },
];

const NOT_YET: LedgerEntry[] = [
  ...R_START,
  { kind: "verdict", at: R_LATER, verified: false, confidence: "high", reason: SHORT, ref: R_REF },
  { kind: "reason", at: R_LATER, decision: "no-pay", note: `${FIXED} not paying: ${SHORT}`, ref: R_REF },
];

/** PoolDetail's proof card once a verdict shows: the receipt, then the
 *  buttons that live with it. */
function ProofCard({ ledger, open = false, retry = false }: { ledger: LedgerEntry[]; open?: boolean; retry?: boolean }) {
  return (
    <Card as="section" aria-label="SPOTTER's check">
      <h2 className="m-0 text-[1.0625rem] font-semibold">SPOTTER&apos;s check</h2>
      <div className="mt-4 space-y-4">
        <AgentReceipt ledger={ledger} evidenceKind="wearable" earlierOpen={open} />
        {retry ? (
          <Button type="button" variant="ghost" className="w-full">
            Check again
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function GoAgain({ share }: { share?: string }) {
  return (
    <>
      <ButtonLink href="/pools/6" block>
        Go again tonight
      </ButtonLink>
      {share !== undefined ? (
        <ChallengeFriend
          path="/pools/5"
          text={paidShareText(share, USDC, HEADLINE.short)}
          label={`Share my ${share}`}
          variant="secondary"
        />
      ) : (
        <Fine>Tonight counts on its own. One night never follows you into the next run.</Fine>
      )}
    </>
  );
}

export default function VerdictStates({ meta }: SectionProps) {
  const range = hitRange(SOLO, false);
  const get = range === null ? "--" : range.low === range.high ? formatUsdc(range.low) : `${formatUsdc(range.low)} to ${formatUsdc(range.high)}`;
  return (
    <GallerySection meta={meta}>
      <StateFrame name="verdict-confirm" note="SPOTTER read a hit: confirm with World ID before any USDC moves">
        <Page
          spotter="verdict-confirm"
          rows={[ME_MISSED]}
          card={
            <VerdictView
              kind="confirm-human"
              head={head({ kind: "confirm-human" })}
              money={{ stake: STAKE, get, range: range !== null && range.low !== range.high }}
              approval={
                <ApprovalAsk
                  secondsLeft={90}
                  mocked={false}
                  error={null}
                  verifying={false}
                  confirmLabel="Confirm with World ID"
                  onConfirm={() => {}}
                  onDecline={() => {}}
                />
              }
            />
          }
        />
      </StateFrame>

      <StateFrame
        name="receipt-hit-after-a-bad-read"
        note="pool 2, 2026-09-27: a still-syncing read, then the hit. Card and receipt both follow the newest read; the old one folds away"
      >
        <Page
          spotter="verdict-confirm"
          rows={[ME_MISSED]}
          card={
            <VerdictView
              kind="confirm-human"
              head={head({ kind: "confirm-human" })}
              money={{ stake: STAKE, get, range: range !== null && range.low !== range.high }}
              approval={
                <ApprovalAsk
                  secondsLeft={540}
                  mocked={false}
                  error={null}
                  verifying={false}
                  confirmLabel="Confirm with World ID"
                  onConfirm={() => {}}
                  onDecline={() => {}}
                />
              }
            />
          }
          proof={<ProofCard ledger={HIT_AFTER_BAD_READ} />}
        />
      </StateFrame>

      <StateFrame name="receipt-not-yet" note="read fine, goal not met so far: the latest check in three lines, Check again under it">
        <Page
          spotter="verdict-lost"
          rows={[ME_MISSED]}
          card={<VerdictView kind="not-yet" head={head({ kind: "not-yet" })} />}
          proof={<ProofCard ledger={NOT_YET} retry />}
        />
      </StateFrame>

      <StateFrame name="receipt-earlier-open" note="the Earlier checks disclosure opened: time, the read with its confidence, the decision" phone>
        <ProofCard ledger={HIT_AFTER_BAD_READ} open />
      </StateFrame>

      <StateFrame name="verdict-paid" note="settled: the paper receipt with the settle's split, time and Basescan; SPOTTER on the paper">
        <Page
          spotter={null}
          rows={[ME]}
          card={
            <VerdictView
              kind="won"
              head={head({ kind: "won", paidUsd: SOLO_PAID, txHash: TX, selfReported: false })}
              receipt={
                <PayoutMoment
                  paidUsd={SOLO_PAID}
                  txHash={TX}
                  selfStaked
                  entryFee={USDC}
                  payee="mika.gohealthme.eth"
                  paidAt="2026-09-27T08:41:00+09:00"
                  tuck
                />
              }
              screening={<PayoutScreening status="clear" />}
              actions={<GoAgain share={SOLO_PAID} />}
            />
          }
        />
      </StateFrame>

      <StateFrame name="verdict-denied" note="the player said not now: nothing paid, ask again before settle">
        <Page
          spotter="verdict-denied"
          rows={[ME_MISSED]}
          card={
            <VerdictView
              kind="approval-failed"
              head={head({ kind: "approval-failed", outcome: "declined", settled: false })}
              approval={<ApprovalOutcomeView outcome="declined" onAskAgain={() => {}} />}
            />
          }
        />
      </StateFrame>

      <StateFrame name="verdict-expired" note="the 90 second World ID request ran out: nothing paid, ask again">
        <Page
          spotter="verdict-denied"
          rows={[ME_MISSED]}
          card={
            <VerdictView
              kind="approval-failed"
              head={head({ kind: "approval-failed", outcome: "expired", settled: false })}
              approval={<ApprovalOutcomeView outcome="expired" onAskAgain={() => {}} />}
            />
          }
        />
      </StateFrame>

      <StateFrame name="verdict-lost" note="missed, and another player hit: the stake went to them">
        <Page
          spotter="verdict-lost"
          rows={[NIKKI, ME_MISSED]}
          card={
            <VerdictView
              kind="lost"
              head={head({ kind: "lost", stakeBack: false }, 1)}
              actions={<GoAgain />}
            />
          }
        />
      </StateFrame>

      <StateFrame name="verdict-nobody" note="nobody hit: every stake comes back, calm, not a loss">
        <Page
          spotter="outcome-none"
          rows={[ME_MISSED]}
          card={
            <VerdictView
              kind="lost"
              head={head({ kind: "lost", stakeBack: false }, 0)}
              actions={<GoAgain />}
            />
          }
        />
      </StateFrame>

      <StateFrame name="verdict-refund" note="no miss written on chain (contract B-2): the settle sent the stake back">
        <Page
          spotter="verdict-lost"
          rows={[ME_MISSED]}
          card={
            <VerdictView
              kind="lost"
              head={head({ kind: "lost", stakeBack: true }, null)}
              actions={<GoAgain />}
            />
          }
        />
      </StateFrame>

      <StateFrame name="verdict-missed-pending" note="a miss SPOTTER recorded on a run that can record one (lib/miss-rule.ts), before settle">
        <Page
          spotter="verdict-lost"
          rows={[NIKKI, ME_MISSED]}
          card={
            <VerdictView
              kind="missed"
              head={head({ kind: "missed", outcome: "pending", stakeUsd: "1.00" })}
              actions={<GoAgain />}
            />
          }
        />
      </StateFrame>

      <StateFrame name="verdict-missed-forfeited" note="the recorded miss after settle: the stake went to the players who hit">
        <Page
          spotter="verdict-lost"
          rows={[NIKKI, ME_MISSED]}
          card={
            <VerdictView
              kind="missed"
              head={head({ kind: "missed", outcome: "forfeited", stakeUsd: "1.00" })}
              actions={<GoAgain />}
            />
          }
        />
      </StateFrame>

      <StateFrame name="verdict-hit-unconfirmed" note="a hit nobody confirmed with World ID before settle: stake back, no share">
        <Page
          spotter="verdict-denied"
          rows={[ME]}
          card={
            <VerdictView
              kind="hit-unconfirmed"
              head={head({ kind: "hit-unconfirmed" })}
              actions={<GoAgain />}
            />
          }
        />
      </StateFrame>
    </GallerySection>
  );
}
