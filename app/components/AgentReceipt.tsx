"use client";

// The most protected surface in the build: SPOTTER's per-claim receipt.
// Nothing renders here that did not go through the ledger first.
//
// It reads as checks (lib/receipt-summary.ts): the newest check in a few
// plain lines - what the read showed, what SPOTTER decided, where the World ID
// confirmation stands, and what landed on chain - and every earlier check one
// tap away. The ledger is append-only, so a claim read twice carries both
// reads; printing both in full put a stale "not verified" above the hit that
// replaced it. Spend and privacy are one fine line each.
//
// Error rows lead with a calm plain-language label - the raw message stays
// available behind a disclosure, never as a wall of red - and a transient
// error the claim already moved past does not print at all.

import type { ReactNode } from "react";
import {
  projectReceipt,
  SCREEN_HELD_PREFIX,
  toUsd2,
  type LedgerEntry,
  type ReceiptRow,
} from "@/lib/agent-receipt";
import {
  summarizeReceipt,
  type ApprovalEntry,
  type CheckError,
  type CheckSummary,
  type EvidenceKind,
  type RecordEntry,
  type SettleEntry,
} from "@/lib/receipt-summary";
import { ArcTxLink, FOCUS_RING, Money } from "@/components/ui";
import { Glyph } from "@/components/run/glyphs";
import PayoutScreening from "@/components/intercepta/PayoutScreening";
import { credentialLabel } from "@/lib/world/credentials";
import { missStakeLine } from "@/lib/agent-history";

// settle.periodEndIso is an optional field newer ledgers carry on deferred
// entries; widened locally so this file compiles whether or not the ledger
// type has it yet.
type SettleLedgerEntry = SettleEntry & { periodEndIso?: string };

const GATEWAY_NOTE = /gateway tx (\S+)/;

// The non-component helpers below are exported for the unit tests in
// AgentReceipt.test.ts (and settleMomentLine for the agent feed).

export function gatewayRefOf(note: string | null): string | null {
  if (note === null) return null;
  return GATEWAY_NOTE.exec(note)?.[1] ?? null;
}

export function noteWithoutGatewayRef(note: string | null): string | null {
  if (note === null) return null;
  const rest = note.replace(GATEWAY_NOTE, "").replace(/\s{2,}/g, " ").trim();
  return rest === "" ? null : rest;
}

function shortRef(ref: string): string {
  return ref.length > 16 ? `${ref.slice(0, 10)}…${ref.slice(-4)}` : ref;
}

/** Local, human moment for a settle time; null when unparseable. Same-day
 *  moments render as a time, anything else as date plus time. */
export function formatSettleMoment(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

const EPOCH_NOTE = /pool period ends at (\d+)/;

/** The line a deferred settle moment renders as; null when the date is
 *  invalid. Future moments read as a promise; past moments must not - the
 *  pool period already ended, so the honest copy is that SPOTTER settles on
 *  its next pass. */
export function settleMomentLine(date: Date): string | null {
  const when = formatSettleMoment(date);
  if (when === null) return null;
  return date.getTime() > Date.now()
    ? `SPOTTER settles this automatically at ${when}`
    : `settling opened at ${when}; SPOTTER settles this on its next pass`;
}

/** What a deferred settle row says. Prefers the entry's periodEndIso, then a
 *  recognizable epoch inside the prose note - converted, never shown raw -
 *  then the note itself. */
export function deferredSettleCopy(
  periodEndIso: string | undefined,
  note: string | null,
): string {
  // typeof guard, not an undefined check: the field is untyped in old
  // ledgers, and a runtime null would otherwise become new Date(null),
  // which is VALID and renders Jan 1 1970 as the settle time.
  if (typeof periodEndIso === "string") {
    const line = settleMomentLine(new Date(periodEndIso));
    if (line !== null) return line;
  }
  const epoch = note !== null ? EPOCH_NOTE.exec(note) : null;
  if (epoch !== null) {
    const seconds = Number(epoch[1]);
    const line =
      seconds > 1e9 && seconds < 1e11
        ? settleMomentLine(new Date(seconds * 1000))
        : null;
    return (
      line ??
      "SPOTTER settles this automatically the moment the challenge ends"
    );
  }
  return note ?? "settlement pending";
}

/** The record row's label: a recorded miss says so, never "recorded" alone,
 *  which reads like a pass. */
export function recordRowLabel(row: Extract<ReceiptRow, { kind: "record" }>): string {
  return row.verdict ? "Recorded on chain" : "Miss recorded on chain";
}

/** Calm per-stage label for an error row. Transient conditions (the chain not
 *  ready yet, the verification service briefly down) read as waiting, not as
 *  failure; only genuine failures keep the danger tone. */
export function errorPresentation(
  stage: string,
  message: string,
): { label: string; transient: boolean } {
  // A payout screening hold (lib/server/screening/gate.ts) is not a chain
  // failure. blocked is a decision; unavailable is a wait for Intercepta.
  if (message.startsWith(SCREEN_HELD_PREFIX)) {
    return message.includes(" unavailable ")
      ? { label: "payout held until Intercepta answers", transient: true }
      : { label: "payout held: this wallet failed screening", transient: false };
  }
  switch (stage) {
    case "attester":
      return { label: "verification service unreachable", transient: true };
    case "buy":
      // The AFTER-settlement case is not a clean stop: money already moved
      // for a purchase that then broke the cap. Say so in the headline.
      if (message.includes("AFTER settlement")) {
        return {
          label: "a purchase cost more than estimated after it was paid",
          transient: false,
        };
      }
      return message.includes("cap")
        ? { label: "stopped at the spend cap for this claim", transient: false }
        : {
            label: "could not buy the verification this claim needs",
            transient: false,
          };
    case "record":
      return {
        label: "could not record the verdict on-chain",
        transient: false,
      };
    case "settle":
      if (message.includes("canSettle")) {
        return { label: "settlement is waiting on the chain", transient: true };
      }
      if (message.includes("pool settled before this claim completed")) {
        return {
          label: "the challenge settled before this claim finished",
          transient: false,
        };
      }
      return { label: "settlement did not complete", transient: false };
    default:
      return { label: "this step did not complete", transient: false };
  }
}

/** The World ID line for an approval row, in the player's words. */
export function approvalLine(approval: ApprovalEntry): string {
  switch (approval.status) {
    case "requested":
      return "Asked you to confirm with World ID";
    case "approved":
      return "You confirmed with World ID";
    case "declined":
      return "You declined the World ID confirmation";
    case "expired":
      return "The World ID request expired";
    case "cancelled":
      return "The World ID request was withdrawn";
  }
}

/** Where to hang the text column: the result glyph (18px) plus its gap. */
const INDENT = "pl-7";

function ErrorLine({ error }: { error: CheckError }) {
  const { label, transient } = errorPresentation(error.stage, error.message);
  return (
    <li className={`${INDENT} text-sm`}>
      <details>
        {/* min-h-11 keeps the disclosure a real 44px thumb target; the flex
            wrap lets the label and the "details" affordance stack at 375px
            instead of forcing the row wider than the card. */}
        <summary
          className={`flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 [&::-webkit-details-marker]:hidden ${FOCUS_RING} ${
            transient ? "text-muted" : "text-danger"
          }`}
        >
          <span className="min-w-0 break-words">{label}</span>
          {error.count > 1 ? (
            <span className="text-xs text-muted">tried {error.count} times</span>
          ) : null}
          <span className="text-xs text-muted underline decoration-dotted">details</span>
        </summary>
        <p className="m-0 mt-1 break-words text-xs text-muted">
          {error.stage}: {error.message}
        </p>
      </details>
    </li>
  );
}

function ApprovalText({ approval }: { approval: ApprovalEntry }) {
  const credential = approval.credential ?? null;
  const proof =
    approval.status === "approved" && approval.nullifierStub !== undefined
      ? `${credential !== null ? `${credentialLabel(credential)}, ` : ""}nullifier ${approval.nullifierStub}…`
      : null;
  return (
    <>
      {approvalLine(approval)}
      {proof !== null ? <span className="text-haze"> ({proof})</span> : null}
      {approval.provider === "mock" ? (
        <span className="text-haze"> (event mode, mocked proof)</span>
      ) : null}
    </>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What landed on chain for a recorded check, most advanced first. */
function OnChainLine({
  record,
  settle,
}: {
  record: RecordEntry;
  settle: SettleLedgerEntry | null;
}) {
  const recorded = recordRowLabel({
    kind: "record",
    resultTx: record.resultTx ?? null,
    registryTx: record.registryTx ?? null,
    verdict: record.verdict !== false,
    stakeUsd: record.stakeUsd ?? null,
  });
  let line: ReactNode = recorded;
  if (settle !== null) {
    if (settle.status === "settled" && settle.paidUsd !== undefined) {
      line = (
        <>
          Paid <Money usd={toUsd2(settle.paidUsd)} sign="+" size="sm" />
        </>
      );
    } else if (settle.status === "closed" && settle.outcome !== undefined) {
      line = missStakeLine(settle.outcome, record.stakeUsd ?? null, true);
    } else if (settle.status === "deferred") {
      line = `${recorded}. ${capitalize(deferredSettleCopy(settle.periodEndIso, settle.note ?? null))}.`;
    } else if (settle.note !== undefined) {
      line = `${recorded}. ${capitalize(settle.note)}`;
    }
  }
  const links: { hash: string; label: string }[] = [];
  if (record.resultTx !== undefined) links.push({ hash: record.resultTx, label: "result tx" });
  if (record.registryTx !== undefined) {
    links.push({ hash: record.registryTx, label: "verdict registry tx" });
  }
  if (settle?.txHash !== undefined) links.push({ hash: settle.txHash, label: "settle tx" });
  return (
    <li className={`${INDENT} text-sm`}>
      <p className="m-0 font-medium text-foreground">{line}</p>
      {links.length > 0 ? (
        <p className="m-0 flex flex-wrap gap-x-4">
          {links.map((l) => (
            <ArcTxLink key={l.label} txHash={l.hash} label={l.label} />
          ))}
        </p>
      ) : null}
    </li>
  );
}

const READING: Record<EvidenceKind, string> = {
  wearable: "SPOTTER is reading your wearable summary",
  document: "SPOTTER is reading your document",
  "self-reported": "SPOTTER is reading your photo",
};

const PRIVACY: Record<EvidenceKind, string> = {
  wearable:
    "Your wearable data stays on SPOTTER's server and never goes on chain. Only the verdict does.",
  "self-reported":
    "Your photo was read in the enclave and never stored. Self-reported proof is low-trust and never marked verified.",
  document: "Your document never left the secure enclave. SPOTTER only ever saw the verdict.",
};

function ResultLine({ check, evidenceKind }: { check: CheckSummary; evidenceKind: EvidenceKind }) {
  const result = check.result;
  if (result === null) {
    return (
      <li className="flex items-start gap-2.5 text-[0.9375rem] text-muted">
        <Glyph name="info" size={18} className="mt-0.5 text-haze" />
        <span className="min-w-0">{READING[evidenceKind]}</span>
      </li>
    );
  }
  const split = result.text.indexOf(": ");
  const lead = split === -1 ? result.text : result.text.slice(0, split);
  const detail = split === -1 ? null : result.text.slice(split + 2);
  const leadTone =
    result.tone === "verified"
      ? "text-moonlight"
      : result.tone === "self-reported"
        ? "text-warning"
        : "text-foreground";
  return (
    <li className="flex items-start gap-2.5 text-[0.9375rem]">
      <Glyph name={result.tone === "verified" ? "hit" : "miss"} size={18} className="mt-0.5" />
      <span className="min-w-0 break-words">
        <span className={`font-semibold ${leadTone}`}>{lead}</span>
        {detail !== null ? <span className="text-foreground">: {detail}</span> : null}
      </span>
    </li>
  );
}

/** Errors worth a line: anything still current, and any real failure even
 *  after the claim moved on (money may have moved). */
function errorsToShow(check: CheckSummary): CheckError[] {
  return check.errors.filter(
    (e) => e.current || !errorPresentation(e.stage, e.message).transient,
  );
}

function LatestCheck({ check, evidenceKind }: { check: CheckSummary; evidenceKind: EvidenceKind }) {
  const decisionTone =
    check.decision?.tone === "pay" ? "text-foreground" : "text-dusk-ink";
  const decision =
    check.decision !== null && check.record === null ? (
      <li className={`${INDENT} text-sm font-medium ${decisionTone}`}>{check.decision.text}</li>
    ) : null;
  const approval =
    check.approval !== null ? (
      <li className={`${INDENT} text-sm text-muted`}>
        <ApprovalText approval={check.approval} />
      </li>
    ) : null;
  return (
    <ul className="m-0 mt-2.5 grid list-none gap-1.5 p-0" aria-label="Latest check">
      <ResultLine check={check} evidenceKind={evidenceKind} />
      {check.record !== null ? (
        <>
          {approval}
          <OnChainLine record={check.record} settle={check.settle} />
        </>
      ) : (
        <>
          {decision}
          {approval}
        </>
      )}
      {check.screen !== null ? (
        <li className={INDENT}>
          <PayoutScreening status={check.screen.status} reason={check.screen.reason} />
        </li>
      ) : null}
      {errorsToShow(check).map((error) => (
        <ErrorLine key={`${error.stage}:${error.message}`} error={error} />
      ))}
    </ul>
  );
}

function checkTime(check: CheckSummary): string | null {
  return check.at !== null ? formatSettleMoment(new Date(check.at)) : null;
}

function EarlierChecks({ checks, open }: { checks: CheckSummary[]; open: boolean }) {
  return (
    <details className="group mt-2 border-t border-edge" open={open}>
      <summary
        className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}
      >
        Earlier checks ({checks.length})
        <Glyph
          name="chev"
          className="text-haze transition-transform duration-[120ms] group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <ol className="m-0 grid list-none gap-3 p-0 pb-1">
        {checks.map((check, index) => {
          const time = checkTime(check);
          return (
            <li key={`${check.at ?? "none"}-${index}`} className="border-t border-edge pt-3 text-sm">
              {time !== null ? (
                <p className="num m-0 text-[0.8125rem] text-haze">{time}</p>
              ) : null}
              {check.result !== null ? (
                <p className="m-0 mt-0.5 break-words text-foreground">
                  {check.result.text}
                  <span className="text-haze">, {check.result.confidence} confidence</span>
                </p>
              ) : null}
              {check.decision !== null ? (
                <p className="m-0 mt-0.5 text-muted">{check.decision.text}</p>
              ) : null}
              {check.decision?.note != null ? (
                <p className="m-0 mt-0.5 break-words text-haze">SPOTTER: {check.decision.note}</p>
              ) : null}
              {check.approval !== null ? (
                <p className="m-0 mt-0.5 text-muted">
                  <ApprovalText approval={check.approval} />
                </p>
              ) : null}
              {check.errors.map((error) => (
                <p key={`${error.stage}:${error.message}`} className="m-0 mt-0.5 text-muted">
                  {errorPresentation(error.stage, error.message).label}
                  {error.count > 1 ? ` (tried ${error.count} times)` : ""}
                </p>
              ))}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

export default function AgentReceipt({
  ledger,
  evidenceKind = "document",
  earlierOpen = false,
}: {
  ledger: LedgerEntry[];
  /** Which evidence path this receipt belongs to. Defaults to "document" so
   *  every existing caller is unchanged; the wearable path opts in so the
   *  privacy footer tells the truth. Only the document/self-reported paths run
   *  inside the confidential enclave (lib/server/judge.ts); the wearable path
   *  reads the Junction summary on SPOTTER's own server, so it must not claim
   *  otherwise. The self-reported path is the same enclave read but the footer
   *  states plainly that the proof is low-trust and unverified. */
  evidenceKind?: EvidenceKind;
  /** Start with the earlier checks open (the state gallery). */
  earlierOpen?: boolean;
}) {
  const summary = summarizeReceipt(ledger, evidenceKind);
  const receipt = projectReceipt(ledger);
  const latest: CheckSummary = summary?.latest ?? {
    at: null,
    result: null,
    decision: null,
    approval: null,
    record: null,
    settle: null,
    screen: null,
    errors: [],
  };
  const time = checkTime(latest);
  // x402 purchases carry their Gateway reference; it is proof the payment
  // happened, so it stays on the spend line rather than behind a tap.
  const gatewayRefs = ledger.flatMap((e) => {
    if (e.kind !== "spend") return [];
    const ref = gatewayRefOf(e.note ?? null);
    return ref !== null ? [ref] : [];
  });

  return (
    <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 text-sm font-semibold">Latest check</p>
        {time !== null && latest.at !== null ? (
          <time dateTime={latest.at} className="num text-[0.8125rem] text-haze">
            {time}
          </time>
        ) : null}
      </div>
      <LatestCheck check={latest} evidenceKind={evidenceKind} />
      <div className="mt-3 grid gap-1 border-t border-edge pt-3 text-[0.8125rem] leading-[1.45] text-haze">
        {receipt.capUsd !== null ? (
          <p className="num m-0 break-words">
            Spent {receipt.spentUsd} of a {receipt.capUsd} USDC cap on this claim.
            {gatewayRefs.length > 0 ? (
              <>
                {" "}Paid via x402, gateway tx{" "}
                {gatewayRefs.map((ref, i) => (
                  <span key={ref} className="break-all font-mono" title={ref}>
                    {i > 0 ? ", " : ""}
                    {shortRef(ref)}
                  </span>
                ))}
                .
              </>
            ) : null}
          </p>
        ) : null}
        <p className="m-0">{PRIVACY[evidenceKind]}</p>
      </div>
      {summary !== null && summary.earlier.length > 0 ? (
        <EarlierChecks checks={summary.earlier} open={earlierOpen} />
      ) : null}
    </div>
  );
}
