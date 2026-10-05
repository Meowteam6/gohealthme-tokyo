"use client";

import RunSlip from "@/components/game/RunSlip";
import { VerdictView, verdictHeadOf } from "@/components/game/VerdictStage";
import PayoutMoment from "@/components/PayoutMoment";
import PayoutScreening from "@/components/intercepta/PayoutScreening";
import { Button } from "@/components/ui";
import type { LedgerEntry } from "@/lib/agent-receipt";
import type { PoolInfo } from "@/lib/contract";
import { runSlotOf } from "@/lib/game/lobby";
import { verdictScreenOf } from "@/lib/game/verdict";
import { GallerySection, StateFrame, type SectionProps } from "../_kit";

// Lobby, My runs and History states live beside the components they share:
// the lobby's run cards and locks with the landing (they are the landing's
// RunRow), My runs and History with character creation (they share its
// fixture player). This section is the index, so a reviewer finds every one
// from here instead of a placeholder.
//
// It also renders the list player's two frames (Andre, 2026-10-02, "Pay on
// the verdict"): the join and the paid verdict. Both are decided by the real
// functions (runSlotOf, verdictScreenOf with payout "verdict"), not typed, so
// the frames break if a list player is ever held for World ID again.

const INDEX: readonly { group: string; states: readonly { id: string; note: string }[] }[] = [
  {
    group: "Challenges (/pools, /c/[token])",
    states: [
      { id: "lobby-cards", note: "challenge cards by slot, signed in: playable, locked, joined, completed" },
      { id: "lobby-signed-out-picked", note: "signed out with WHOOP picked: the steps challenge reads locked" },
      { id: "lobby-challenge-highlight", note: "the challenge from the link, marked, with its entry control" },
      { id: "lobby-lock-sensor-check", note: "the one tap at the top of Challenges" },
      { id: "lobby-lock-hardware", note: "a hardware limit with the fix as the one action" },
      { id: "lobby-lock-paused", note: "a build-wide pause" },
      { id: "lobby-money-in-paused", note: "new stakes paused (KILL_BASE_MONEY_IN) on every open card" },
      { id: "lobby-lock-money-in-paused", note: "the money-in pause on the challenge page, with the operator's note" },
      { id: "lobby-list-player-joins", note: "a list player where World players confirm with World ID: no lock, they join" },
      { id: "verdict-list-player-paid", note: "a list player's hit, paid on the verdict with no World ID step" },
      { id: "landing-no-open-runs", note: "nothing live: start a challenge" },
    ],
  },
  {
    group: "My challenges (/dashboard)",
    states: [
      { id: "my-runs-signed-out", note: "sign in on the card SPOTTER stands on" },
      { id: "my-runs-loading", note: "reading the challenges" },
      { id: "my-runs-empty", note: "in no challenge: one pose, one line, one action" },
      { id: "my-runs-active", note: "in a live challenge: nights, If you hit, Who's in" },
      { id: "my-runs-finished", note: "completed challenges only" },
      { id: "my-runs-error", note: "the read failed" },
    ],
  },
  {
    group: "History (/agent)",
    states: [
      { id: "history-feed", note: "claims with badges and tx links" },
      { id: "history-empty", note: "nothing checked yet" },
    ],
  },
];

const USDC = 1_000_000n;
const NOW = BigInt(Math.floor(Date.UTC(2026, 9, 2, 12, 0, 0) / 1000));
const HOUR = 3600n;
const LIST_PLAYER = "0x1111000000000000000000000000000000000001";
const TX = "0x3b9f0c2a7e61d4a58c0f7e2d9b4a6c1e8f3d5b7a9c2e4f6a8b0d1c3e5f7a9b2c";

const SLEEP: PoolInfo = {
  id: 5n,
  creator: "0x0000000000000000000000000000000000000001",
  bountyModel: 2,
  settled: false,
  cancelled: false,
  periodStart: NOW - HOUR,
  periodEnd: NOW + 16n * HOUR,
  entryFee: USDC,
  balance: 2n * USDC,
  initiative: "Sleep 7 hours Saturday night",
  goalSpec: "Sleep at least 7 hours for 1 night",
};

/** A list player on a World-on build where World players confirm payouts:
 *  proven human through the list, wearable checked, nothing build-wide held.
 *  The retired world-to-collect lock would have stood here. */
const LIST_JOIN = runSlotOf({
  phase: "live",
  canPay: true,
  joined: false,
  address: LIST_PLAYER,
  joinBlock: { kind: "ok" },
  worldLane: "on",
  humanVerified: true,
  gate: "passed",
  needsDocumentVerifier: false,
  verifier: "available",
  payouts: "ready",
  moneyIn: "open",
  deviceLabel: "WHOOP",
});

const AT = "2026-10-03T08:41:00+09:00";
const REF = "wearable-1790348400";
/** The ledger SPOTTER writes for a list player's hit: read, pay, record,
 *  settle. No approval row: nothing was asked. */
const LIST_PAID_LEDGER: LedgerEntry[] = [
  {
    kind: "plan",
    at: AT,
    steps: [{ service: "whoop-read", label: "WHOOP sleep read", estUsd: "0.00" }],
    capUsd: "1.00",
  },
  {
    kind: "verdict",
    at: AT,
    verified: true,
    confidence: "high",
    reason: "Your wearable shows 1 qualifying days (7+ hours of sleep), meeting the 1-day goal.",
    ref: REF,
  },
  { kind: "reason", at: AT, decision: "pay", note: "Checked by SPOTTER's fixed rule. paying.", ref: REF },
  { kind: "record", at: AT, goalId: "0x01", registryStatus: "skipped" },
  { kind: "settle", at: AT, status: "settled", paidUsd: "3.00", txHash: TX },
];

const LIST_PAID = verdictScreenOf({
  joined: true,
  poolCancelled: false,
  poolSettled: true,
  refunded: false,
  runStatus: "paid",
  ledger: LIST_PAID_LEDGER,
  localApproval: null,
  payout: "verdict",
});

const LIST_PAID_HEAD = verdictHeadOf({
  screen: LIST_PAID,
  goalShort: "7 hours",
  deviceName: "WHOOP",
  selfStaked: true,
  entryFee: USDC,
  settleAchievers: 1,
});

export default function LobbyStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <StateFrame name="lobby-index" note="where each Challenges, My challenges and History state is rendered">
        <div className="grid gap-6 min-[900px]:grid-cols-3">
          {INDEX.map(({ group, states }) => (
            <div key={group}>
              <h3 className="m-0 text-base font-semibold text-foreground">{group}</h3>
              <ul className="m-0 mt-2 list-none p-0">
                {states.map((s) => (
                  <li key={s.id} className="border-t border-edge py-2 text-[0.9375rem] first:border-t-0">
                    <a
                      href={`?#${s.id}`}
                      className="font-medium text-foreground underline decoration-muted/35 underline-offset-4"
                    >
                      #{s.id}
                    </a>
                    <span className="block text-[0.8125rem] text-haze">{s.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </StateFrame>

      <StateFrame
        name="lobby-list-player-joins"
        note="in through the list on a build where World players confirm with World ID: the challenge is open to them, and SPOTTER pays them on the verdict"
        phone
      >
        <RunSlip
          row={{ pool: SLEEP, phase: "live", slot: LIST_JOIN, highlighted: true }}
          returnTo="/pools/5"
          players={1}
          action={<Button block>Lock in 1 USDC</Button>}
        />
      </StateFrame>

      {LIST_PAID_HEAD !== null ? (
        <StateFrame
          name="verdict-list-player-paid"
          note="a list player's hit: SPOTTER read the wearable and paid on the verdict, no World ID card on the way"
          phone
        >
          <VerdictView
            kind={LIST_PAID.kind}
            head={LIST_PAID_HEAD}
            receipt={
              LIST_PAID.kind === "won" ? (
                <PayoutMoment
                  paidUsd={LIST_PAID.paidUsd}
                  txHash={LIST_PAID.txHash}
                  selfStaked
                  entryFee={USDC}
                  paidAt={AT}
                  tuck
                />
              ) : null
            }
            screening={<PayoutScreening status="clear" />}
          />
        </StateFrame>
      ) : null}
    </GallerySection>
  );
}
