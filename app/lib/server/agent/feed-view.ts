// Public projection of SPOTTER's ledger for the unauthenticated agent feed.
//
// The full ledger carries model-authored prose written about medical
// documents - verdict reasons, decision notes, escalation lines, engineer
// diagnostics. None of that belongs on a public endpoint; the product's core
// claim is that health data stays private. This view keeps only money facts
// and machine states: amounts, service labels, settlement rails, tx hashes,
// statuses, timestamps. No reason text, no notes, no goal text, no error
// prose.

import type { LedgerEntry } from "@/lib/server/agent/ledger";

// settle.periodEndIso is an optional field newer ledgers carry on deferred
// entries; widened locally so this module compiles whether or not the ledger
// type has it yet.
type SettleLedgerEntry = Extract<LedgerEntry, { kind: "settle" }> & {
  periodEndIso?: string;
};

export interface PublicFeedSpend {
  at: string;
  label: string;
  amountUsd: string;
  settlement: "prepaid" | "x402";
}

export interface PublicFeedSettle {
  at: string;
  status: "deferred" | "settled" | "already-settled" | "closed";
  paidUsd: string | null;
  txHash: string | null;
  periodEndIso: string | null;
}

/** The payout screening verdict (Intercepta): machine facts only. The trait
 *  names are the provider's enum identifiers, the reason is composed from
 *  those names, and nothing here derives from health data. */
export interface PublicFeedScreen {
  at: string;
  purpose: "record" | "settle" | "x402";
  status: "clear" | "blocked" | "unavailable";
  toxicScore: number | null;
  traits: string[];
  reason: string;
  cached: boolean;
}
// --- world-agents ---
/** The human step, as a machine state: SPOTTER asked, and what came back.
 *  No prose, no identity; the nullifier stub stays on the private receipt. */
export interface PublicFeedApproval {
  at: string;
  status: "requested" | "approved" | "declined" | "expired" | "cancelled";
  provider: "mock" | "world";
  expiresAtIso: string | null;
  /** Which World credential confirmed (a credential kind, never an identity);
   *  null until an approved world-mode row names one. */
  credential: string | null;
}
// --- end world-agents ---

export interface PublicFeedClaim {
  goalId: string;
  at: string;
  decision: "pay" | "no-pay" | null;
  spends: PublicFeedSpend[];
  recordTxs: { resultTx: string | null; registryTx: string | null } | null;
  settle: PublicFeedSettle | null;
  /** True when the claim rests on self-reported (photo/screenshot) evidence,
   *  the low-trust tier. A machine-state boolean like `decision` — it carries
   *  no health-derived prose — so the public feed may show it. The feed must
   *  never present a self-reported win as "verified". */
  selfReported: boolean;
  /** Latest payout screening row, when the claim has one. Absent (not null)
   *  on claims that were never screened, so older feed shapes are unchanged. */
  screen?: PublicFeedScreen;
  // --- world-agents ---
  /** Newest human-confirmation state, or null when SPOTTER never asked. */
  approval: PublicFeedApproval | null;
  // --- end world-agents ---
  /** Present only when SPOTTER hit an error on this claim and the claim has
   *  not settled since: the stage it stopped at (machine vocabulary: buy,
   *  attester, record, settle, approval), never the error prose. Without it a
   *  stalled claim reads as a bare "decision pay" that will never pay. */
  problem?: PublicFeedProblem;
}

export interface PublicFeedProblem {
  at: string;
  stage: string;
}

/** The error stages the ledger writes. Anything else is reported as "other"
 *  so a corrupt or future stage string can never carry prose to the feed. */
const KNOWN_STAGES = new Set(["buy", "attester", "record", "settle", "approval"]);

/** Runtime string check. The store returns whatever JSON it holds, so the
 *  redaction boundary is also the validation boundary: a corrupt field must
 *  not crash the public console or render a wrong value. */
function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Redact one claim's ledger down to what the public feed may carry. */
export function toPublicFeedClaim(
  goalId: string,
  at: string,
  ledger: LedgerEntry[],
): PublicFeedClaim {
  const spends: PublicFeedSpend[] = [];
  let decision: "pay" | "no-pay" | null = null;
  let recordTxs: PublicFeedClaim["recordTxs"] = null;
  let settle: PublicFeedSettle | null = null;
  let selfReported = false;
  let screen: PublicFeedScreen | undefined;
  let problem: PublicFeedProblem | undefined;
  // --- world-agents ---
  let approval: PublicFeedApproval | null = null;
  // --- end world-agents ---

  for (const entry of ledger) {
    // Progress after an error (a retry that got a verdict, a decision, a
    // record, a settle or a human answer) means the claim moved on.
    if (
      entry.kind === "verdict" ||
      entry.kind === "reason" ||
      entry.kind === "record" ||
      entry.kind === "settle" ||
      entry.kind === "approval"
    ) {
      problem = undefined;
    }
    switch (entry.kind) {
      case "screen":
        // The newest verdict wins: a hold that later cleared must read as
        // clear. Trait names and the composed reason are machine facts;
        // the printed rule is server-side detail the feed does not need.
        screen = {
          at: entry.at,
          purpose: entry.purpose,
          status: entry.status,
          toxicScore: typeof entry.toxicScore === "number" ? entry.toxicScore : null,
          traits: Array.isArray(entry.traits)
            ? entry.traits.filter((t): t is string => typeof t === "string")
            : [],
          reason: asString(entry.reason) ?? "",
          cached: entry.cached === true,
        };
        break;
      // --- world-agents ---
      case "approval":
        // Newest wins: the feed shows where the human step stands now.
        approval = {
          at: entry.at,
          status: entry.status,
          provider: entry.provider,
          expiresAtIso: asString(entry.expiresAtIso),
          credential: asString(entry.credential),
        };
        break;
      // --- end world-agents ---
      case "verdict":
        // Only the tier flag crosses the redaction boundary here — never the
        // verdict reason or any other prose, which stay server-side.
        if (entry.selfReported === true) selfReported = true;
        break;
      case "spend": {
        // The spend note stays server-side: it carries the escalation line.
        // A corrupt amount is dropped whole rather than crashing the feed.
        const amountUsd = asString(entry.amountUsd);
        if (amountUsd === null) break;
        spends.push({
          at: entry.at,
          label: entry.label,
          amountUsd,
          settlement: entry.settlement,
        });
        break;
      }
      case "reason":
        // The decision is a machine state; the note behind it is model prose.
        decision = entry.decision;
        break;
      case "record":
        recordTxs = {
          resultTx: entry.resultTx ?? null,
          registryTx: entry.registryTx ?? null,
        };
        break;
      case "settle": {
        // A settled entry is the claim's end state; never let a later
        // duplicate or deferred row displace it.
        if (settle?.status === "settled") break;
        const widened = entry as SettleLedgerEntry;
        settle = {
          at: entry.at,
          status: entry.status,
          paidUsd: asString(entry.paidUsd),
          txHash: asString(entry.txHash),
          periodEndIso: asString(widened.periodEndIso),
        };
        break;
      }
      case "error": {
        // The message is engineer prose and stays server-side; only the
        // stage (a fixed vocabulary) crosses, so the feed can say a claim
        // is stuck instead of implying a payout is on its way.
        const stage = asString(entry.stage);
        problem = {
          at: entry.at,
          stage: stage !== null && KNOWN_STAGES.has(stage) ? stage : "other",
        };
        break;
      }
      // plan entries carry prose (goal specs) and never leave the server.
      // verdict is handled above for its tier flag only; its reason prose is
      // likewise never copied.
      default:
        break;
    }
  }

  const claim: PublicFeedClaim = {
    goalId,
    at,
    decision,
    spends,
    recordTxs,
    settle,
    selfReported,
    // --- world-agents ---
    approval,
    // --- end world-agents ---
  };
  if (screen !== undefined) claim.screen = screen;
  // A settled claim is done; an older error on its way there is history.
  if (problem !== undefined && settle?.status !== "settled") {
    claim.problem = problem;
  }
  return claim;
}
