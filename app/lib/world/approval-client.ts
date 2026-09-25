// Browser side of the human approval step (World ID for Agents, ETHGlobal
// Tokyo 2026). Framework-free so every decision here is unit-testable under
// vitest's node environment; HumanApprovalCard.tsx is the thin React binding.
//
// WHY THE MOCK PROOF KIND IS MIRRORED, NOT IMPORTED: the server's value lives
// in lib/server/agent/approval-provider.ts, and server modules stay out of the
// client bundle (the same rule client-auth.ts follows for the wallet message).
// A test imports both and fails the suite if they drift.

export type ApprovalOutcome = "approved" | "declined" | "expired" | "cancelled";

export type ApprovalProviderName = "mock" | "world";

/** Mirror of lib/server/agent/approval-provider.ts MOCK_PROOF_KIND. Wire format. */
export const CLIENT_MOCK_PROOF_KIND = "gohealthme-mock-approval";

/** What POST /api/agent/approval/request returns. */
export interface OpenApprovalRequest {
  requestId: string;
  expiresAt: string;
  status: "pending" | ApprovalOutcome;
  attempt: number;
  action: string;
  provider: ApprovalProviderName;
  mocked: boolean;
  world?: {
    appId: `app_${string}`;
    rpContext: {
      rp_id: string;
      nonce: string;
      created_at: number;
      expires_at: number;
      signature: string;
    };
    environment: "production" | "staging" | "sandbox";
    allowLegacyProofs: boolean;
  };
}

/** What GET /api/agent/approval/status returns. */
export interface ApprovalStatusResponse {
  status: "none" | "pending" | ApprovalOutcome;
  requestId?: string;
  expiresAt?: string;
}

/** The event-mode proof: bound to the action the server issued, carrying no
 *  identity. The server refuses any other shape. Never production. */
export function mockApprovalProof(action: string): {
  kind: typeof CLIENT_MOCK_PROOF_KIND;
  action: string;
  approve: true;
} {
  return { kind: CLIENT_MOCK_PROOF_KIND, action, approve: true };
}

/** Whole seconds left before `expiresAt`, never negative. */
export function secondsLeft(expiresAt: string, nowMs: number): number {
  const ms = Date.parse(expiresAt) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 1000);
}

/** "1:30" style countdown for the card. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Runtime check on the request route's JSON: the card must not render a
 *  half-shaped request as if it were real. */
export function parseOpenRequest(value: unknown): OpenApprovalRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.requestId !== "string" ||
    typeof v.expiresAt !== "string" ||
    typeof v.action !== "string" ||
    typeof v.attempt !== "number" ||
    (v.provider !== "mock" && v.provider !== "world") ||
    typeof v.mocked !== "boolean" ||
    !isRequestStatus(v.status)
  ) {
    return null;
  }
  const world =
    typeof v.world === "object" && v.world !== null
      ? (v.world as OpenApprovalRequest["world"])
      : undefined;
  if (v.provider === "world" && v.status === "pending" && world === undefined) {
    return null;
  }
  return {
    requestId: v.requestId,
    expiresAt: v.expiresAt,
    status: v.status,
    attempt: v.attempt,
    action: v.action,
    provider: v.provider,
    mocked: v.mocked,
    ...(world === undefined ? {} : { world }),
  };
}

function isRequestStatus(value: unknown): value is OpenApprovalRequest["status"] {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "declined" ||
    value === "expired" ||
    value === "cancelled"
  );
}

export function parseStatus(value: unknown): ApprovalStatusResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.status !== "none" && !isRequestStatus(v.status)) return null;
  return {
    status: v.status as ApprovalStatusResponse["status"],
    ...(typeof v.requestId === "string" ? { requestId: v.requestId } : {}),
    ...(typeof v.expiresAt === "string" ? { expiresAt: v.expiresAt } : {}),
  };
}

/** Copy for each terminal state. Lives here so the card and any other
 *  surface say the same true thing, and so the wording is testable. */
export function outcomeCopy(outcome: ApprovalOutcome): {
  headline: string;
  detail: string;
  askAgain: boolean;
} {
  switch (outcome) {
    case "approved":
      return {
        headline: "confirmed.",
        detail:
          "SPOTTER is recording the result on-chain and settles the moment the pool closes. Your data stayed off-chain; only your consent and the verdict travel.",
        askAgain: false,
      };
    case "declined":
      return {
        headline: "you said no. nothing moved.",
        detail:
          "SPOTTER wrote nothing on-chain and will not pay this claim. Your stake comes back when the pool closes.",
        askAgain: true,
      };
    case "expired":
      return {
        headline: "the window closed before you answered. nothing moved.",
        detail:
          "SPOTTER does not pay without a live yes. Ask again and you get a fresh 90-second window.",
        askAgain: true,
      };
    case "cancelled":
      return {
        headline: "the pool settled before you confirmed. nothing moved.",
        detail:
          "This payout can no longer happen: settle is one-shot. Your stake comes back with the pool's refund of everyone the oracle never adjudicated.",
        askAgain: false,
      };
  }
}
