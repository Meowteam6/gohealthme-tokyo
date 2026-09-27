// SPOTTER's receipt, read as checks. The ledger is append-only, so a claim
// that was read twice (a "still syncing" read, then the hit) carries every
// row of both. Players need the newest check in a few plain lines; the older
// ones stay one tap away. This folds the ledger into checks and says each one
// in the product's words. Pure and client-safe: the server strings it
// recognizes are mirrored from lib/server/agent (wearable.ts, miss.ts,
// reason.ts), and anything it does not recognize falls back to the first
// sentence SPOTTER wrote, never to nothing.
//
// A check starts at each read (a verdict entry) and runs until the next one.
// The vision judge's second opinion belongs to the read it corrects. Once a
// result is on chain the recorded check is the last one: the on-chain write
// is one-shot, so a later read (a provider hiccup after the payout was
// earned) cannot change it and never takes the summary over.

import type { LedgerEntry } from "@/lib/agent-receipt";

type VerdictEntry = Extract<LedgerEntry, { kind: "verdict" }>;
type ReasonEntry = Extract<LedgerEntry, { kind: "reason" }>;
export type ApprovalEntry = Extract<LedgerEntry, { kind: "approval" }>;
export type RecordEntry = Extract<LedgerEntry, { kind: "record" }>;
export type SettleEntry = Extract<LedgerEntry, { kind: "settle" }>;
export type ScreenEntry = Extract<LedgerEntry, { kind: "screen" }>;

export type EvidenceKind = "document" | "wearable" | "self-reported";

export interface CheckResult {
  tone: "verified" | "not-verified" | "self-reported";
  /** "Verified: 1 day with a workout in the window". No confidence jargon. */
  text: string;
  /** For the earlier-checks disclosure only. */
  confidence: "low" | "medium" | "high";
}

export interface CheckDecision {
  tone: "pay" | "no-pay" | "pending";
  /** "Paying", "Not paying yet", "Not paying", "Deciding now". */
  text: string;
  /** What SPOTTER added beyond the read, for the disclosure; null when the
   *  note only named the fixed rule or repeated the read. */
  note: string | null;
}

export interface CheckError {
  stage: string;
  message: string;
  /** Consecutive repeats of the same stage and message, collapsed. */
  count: number;
  /** Nothing moved after it: the claim is still sitting on this error. */
  current: boolean;
}

export interface CheckSummary {
  /** When the check's read landed; the first entry's time before any read. */
  at: string | null;
  result: CheckResult | null;
  decision: CheckDecision | null;
  approval: ApprovalEntry | null;
  record: RecordEntry | null;
  settle: SettleEntry | null;
  screen: ScreenEntry | null;
  errors: CheckError[];
}

export interface ReceiptSummary {
  latest: CheckSummary;
  /** Every earlier check, newest first. */
  earlier: CheckSummary[];
}

function isEscalation(entry: LedgerEntry): boolean {
  return entry.kind === "verdict" && entry.ref.endsWith(":vision-judge");
}

/** Entries that move a claim forward. An error followed by one of these is
 *  history, not the claim's current state. */
function isProgress(entry: LedgerEntry): boolean {
  return (
    entry.kind === "verdict" ||
    entry.kind === "reason" ||
    entry.kind === "approval" ||
    entry.kind === "record" ||
    entry.kind === "settle"
  );
}

/** The ledger cut into checks, oldest first. Entries before the first read
 *  (the plan, the purchase, a buy-step error) belong to the first check. */
function segmentsOf(ledger: LedgerEntry[]): LedgerEntry[][] {
  const recordAt = ledger.findIndex((e) => e.kind === "record");
  const segments: LedgerEntry[][] = [];
  let current: LedgerEntry[] = [];
  ledger.forEach((entry, index) => {
    const opensCheck =
      entry.kind === "verdict" &&
      !isEscalation(entry) &&
      (recordAt === -1 || index < recordAt) &&
      current.some((e) => e.kind === "verdict");
    if (opensCheck) {
      segments.push(current);
      current = [];
    }
    current.push(entry);
  });
  segments.push(current);
  return segments;
}

function lastOf<K extends LedgerEntry["kind"]>(
  entries: LedgerEntry[],
  kind: K,
): Extract<LedgerEntry, { kind: K }> | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e.kind === kind) return e as Extract<LedgerEntry, { kind: K }>;
  }
  return null;
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.+?[.!?])(?:\s|$)/.exec(trimmed);
  return stripPeriod(match !== null ? match[1] : trimmed);
}

function stripPeriod(text: string): string {
  return text.replace(/\.$/, "");
}

/** Sleep goals count nights, everything else counts days. */
function days(n: number, unit: string): string {
  const word = /sleep/.test(unit) ? "night" : "day";
  return n === 1 ? word : `${word}s`;
}

/** "with a workout" for a session goal, "at 7+ hours of sleep" otherwise. */
function qualifier(threshold: string, unit: string): string {
  return unit === "workout" && threshold === "1" ? "with a workout" : `at ${threshold}+ ${unit}`;
}

// Mirrors of the verdict reasons lib/server/agent/wearable.ts and miss.ts
// write. Pinned in receipt-summary.test.ts against those functions. Receipts
// written before the 2026-09-27 wording pass say "pool period" and "run", so
// both spellings parse.
const PASS =
  /^Your wearable shows (\d+) qualifying days \(([\d.,]+)\+ (.+?)\) inside this (?:pool period|challenge), meeting the \d+-day goal\.$/;
const NOT_MET =
  /^Your wearable shows (\d+) of (\d+) qualifying days \(([\d.,]+)\+ (.+?)\) inside this (?:pool period|challenge)\. The goal is not met yet\.$/;
const NO_SYNC = /^Your wearable is connected but has not synced any (.+?) data for this period yet\./;
const NOT_REPORTED = /^Your wearable is syncing, but it does not report (.+?) for this goal,/;
const PROVIDER_LACKS = /^This goal is measured in (.+?), which (.+?) does not report,/;
const NOT_CONNECTED = /^No wearable is connected for this wallet\./;
const PROVIDER_DOWN = /^The wearable data provider could not be reached,/;
const NO_METRIC = /^SPOTTER could not tell which wearable metric this goal maps to/;
const MISS = /and shows (.+?)\. The (?:run|challenge) is over, so the miss is recorded\.$/;

/**
 * The short form of a verdict reason: what counted, in a few words. blocked
 * is true when waiting cannot change it (the device does not measure the
 * goal), so the line must not say "yet".
 */
export function shortReasonOf(reason: string): { detail: string; blocked: boolean } {
  const text = reason.trim();
  let m = PASS.exec(text);
  if (m !== null) {
    const n = Number(m[1]);
    return { detail: `${n} ${days(n, m[3])} ${qualifier(m[2], m[3])} in the window`, blocked: false };
  }
  m = NOT_MET.exec(text);
  if (m !== null) {
    const goal = Number(m[2]);
    return {
      detail: `${m[1]} of ${goal} ${days(goal, m[4])} ${qualifier(m[3], m[4])} so far`,
      blocked: false,
    };
  }
  m = NO_SYNC.exec(text);
  if (m !== null) return { detail: `no ${m[1]} synced yet`, blocked: false };
  m = NOT_REPORTED.exec(text);
  if (m !== null) return { detail: `your device does not report ${m[1]}`, blocked: true };
  m = PROVIDER_LACKS.exec(text);
  if (m !== null) return { detail: `${m[2]} does not report ${m[1]}`, blocked: true };
  if (NOT_CONNECTED.test(text)) return { detail: "no wearable connected", blocked: false };
  if (PROVIDER_DOWN.test(text)) {
    return { detail: "the wearable provider did not answer", blocked: false };
  }
  if (NO_METRIC.test(text)) {
    return { detail: "this goal does not map to a wearable metric", blocked: true };
  }
  m = MISS.exec(text);
  if (m !== null) return { detail: m[1], blocked: true };
  return { detail: text === "" ? "" : firstSentence(text), blocked: false };
}

/** Mirror of lib/server/agent/reason.ts FIXED_RULE_PREFIX. */
const FIXED_RULE = /Checked by SPOTTER's fixed rule\.\s*/g;
/** The fixed rule's own pay note (reason.ts deterministicReason). */
const RULE_PAY = /^verified, (?:low|medium|high) confidence\. paying\.$/;

/**
 * SPOTTER's decision note with the plumbing taken out: the fixed-rule label
 * never prints, and a note that only repeats the read (the fixed rule writes
 * "not paying: <the read's reason>") says nothing new.
 */
export function decisionNoteOf(note: string, verdictReason: string | null): string | null {
  let text = note.replace(FIXED_RULE, "").trim();
  if (verdictReason !== null && verdictReason.trim() !== "") {
    const reason = verdictReason.trim();
    text = text.replace(`not paying: ${reason}`, "").replace(reason, "").trim();
  }
  if (text === "" || text === "not paying:" || RULE_PAY.test(text)) return null;
  return text;
}

function resultOf(
  verdict: VerdictEntry,
  evidenceKind: EvidenceKind,
  missRecorded: boolean,
): { result: CheckResult; blocked: boolean } {
  const short = shortReasonOf(verdict.reason);
  const detail = short.detail === "" ? "" : `: ${short.detail}`;
  if (verdict.selfReported === true || evidenceKind === "self-reported") {
    // The low-trust tier never reads as verified, whatever the read said.
    return {
      result: { tone: "self-reported", text: `Self-reported${detail}`, confidence: verdict.confidence },
      blocked: short.blocked,
    };
  }
  if (verdict.verified) {
    const lead = isEscalation(verdict) ? "Verified on a second opinion" : "Verified";
    return {
      result: { tone: "verified", text: `${lead}${detail}`, confidence: verdict.confidence },
      blocked: false,
    };
  }
  const final = missRecorded || short.blocked;
  const lead = missRecorded
    ? "Not met"
    : !final && (evidenceKind === "wearable" || verdict.confidence === "low")
      ? "Not verified yet"
      : "Not verified";
  return {
    result: { tone: "not-verified", text: `${lead}${detail}`, confidence: verdict.confidence },
    blocked: short.blocked,
  };
}

function errorsOf(segment: LedgerEntry[], isLatest: boolean): CheckError[] {
  const errors: CheckError[] = [];
  segment.forEach((entry, index) => {
    if (entry.kind !== "error") return;
    const current = isLatest && !segment.slice(index + 1).some(isProgress);
    const last = errors[errors.length - 1];
    if (last !== undefined && last.stage === entry.stage && last.message === entry.message) {
      last.count += 1;
      last.current = current;
      return;
    }
    errors.push({ stage: entry.stage, message: entry.message, count: 1, current });
  });
  return errors;
}

function checkOf(
  segment: LedgerEntry[],
  evidenceKind: EvidenceKind,
  isLatest: boolean,
): CheckSummary {
  const record = lastOf(segment, "record");
  const recordAt = record !== null ? segment.indexOf(record) : segment.length;
  // The read the decision was made on: the last one before the record.
  const decided = segment.slice(0, recordAt);
  const verdict = lastOf(decided, "verdict");
  const reason: ReasonEntry | null = lastOf(decided, "reason");
  const opening = segment.find((e) => e.kind === "verdict") ?? segment[0];
  const missRecorded = record !== null && record.verdict === false;

  let result: CheckResult | null = null;
  let decision: CheckDecision | null = null;
  if (verdict !== null) {
    const read = resultOf(verdict, evidenceKind, missRecorded);
    result = read.result;
    if (reason === null) {
      decision = { tone: "pending", text: "Deciding now", note: null };
    } else if (reason.decision === "pay") {
      decision = { tone: "pay", text: "Paying", note: decisionNoteOf(reason.note, verdict.reason) };
    } else {
      const final = missRecorded || read.blocked;
      const yet = !final && (evidenceKind === "wearable" || verdict.confidence === "low");
      decision = {
        tone: "no-pay",
        text: yet ? "Not paying yet" : "Not paying",
        note: decisionNoteOf(reason.note, verdict.reason),
      };
    }
  }

  return {
    at: opening?.at ?? null,
    result,
    decision,
    approval: lastOf(segment, "approval"),
    record,
    settle: lastOf(segment, "settle"),
    screen: lastOf(segment, "screen"),
    errors: errorsOf(segment, isLatest),
  };
}

/** The receipt as its latest check plus the earlier ones; null when the
 *  ledger is empty (no claim, nothing to show). */
export function summarizeReceipt(
  ledger: LedgerEntry[],
  evidenceKind: EvidenceKind,
): ReceiptSummary | null {
  if (ledger.length === 0) return null;
  const segments = segmentsOf(ledger);
  const checks = segments.map((segment, index) =>
    checkOf(segment, evidenceKind, index === segments.length - 1),
  );
  const latest = checks[checks.length - 1];
  return { latest, earlier: checks.slice(0, -1).reverse() };
}
