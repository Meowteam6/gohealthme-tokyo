"use client";

// Character creation step 2: prove you're one human.
//
// Lane contract (docs/LANES.md): `{ address, onVerified({ nullifierHash }),
// onFailed?(reason) }`. onVerified fires only after POST /api/world/verify
// said ok; the server is the only judge. Every failure, cancel and refusal
// lands in a real screen with a retry, and onFailed carries its plain reason.
//
// Three deployment modes, read from GET /api/world/rp-context (docs/WORLD.md):
//
//   live  The IDKit widget (IdkitWidgetHost, client-only) opens on tap with a
//         freshly signed rp_context. handleVerify posts the payload, with the
//         wallet signature, to the server and THROWS on a refusal so the
//         widget shows the failure; the refusal is then rendered here with the
//         server's reason (a 409 names the wallet the person verified with).
//   mock  EVENT MODE. ETHGlobal Tokyo 2026 mocks World proofs. No QR: the
//         person types an identity, the card builds an IDKit-shaped payload
//         (lib/world/mock-proof.ts) and the server verifies its wallet binding
//         and derives a deterministic nullifier, so the same identity on a
//         second wallet is refused with the same 409 a real World ID would
//         get. The card says, in so many words, that this is not a real check.
//   off   Prove-human is not enabled on this deployment. Said plainly; the
//         closed-beta allowlist keeps working, so nobody is stuck here.
//
// In open beta (lib/open-beta.ts) the step is optional, so the heading and
// the lead offer the one human, one entry badge instead of stating the rule.
//
// Nothing about the person is shown or stored beyond the wallet address and
// World's nullifier; the nullifier is never rendered.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { IDKitErrorCodes, IDKitResult } from "@worldcoin/idkit";
import { Badge, Button, ErrorNote, TAP_TARGET } from "@/components/ui";
import { useWalletAuth } from "@/lib/useWalletAuth";
import {
  fetchWorldConfig,
  mintRpContext,
  signatureBlockReason,
  submitProof,
  type BindConflict,
  type RpContext,
  type VerifyOutcome,
  type WorldClientConfig,
} from "@/lib/world/api";
import {
  credentialLabel,
  shouldFallBackToLegacy,
  type WorldRequestStage,
} from "@/lib/world/credentials";
import { idkitErrorView } from "@/lib/world/idkit-errors";
import { buildMockProof } from "@/lib/world/mock-proof";
import { openBeta } from "@/lib/open-beta";

// The only import of @worldcoin/idkit lives in the host; it pulls the SDK's
// WASM and must never render on the server.
const IdkitWidgetHost = dynamic(
  () => import("@/components/world/IdkitWidgetHost"),
  { ssr: false },
);

export interface ProveHumanResult {
  nullifierHash: string;
}

export interface ProveHumanProps {
  address: string;
  onVerified: (result: ProveHumanResult) => void;
  onFailed?: (reason: string) => void;
}

interface Failure {
  title: string;
  detail: string;
  retryable: boolean;
  cancelled: boolean;
  conflict?: BindConflict;
  otherWallet?: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "unavailable"; detail: string }
  | { kind: "off"; problem: string | null }
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "widget"; rpContext: RpContext; stage: WorldRequestStage }
  | { kind: "verified"; mode: "live" | "mock"; credential: string | null }
  | { kind: "failed"; failure: Failure };

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** The card's reading of a server refusal. */
function failureFromOutcome(outcome: Exclude<VerifyOutcome, { ok: true }>): Failure {
  if (outcome.conflict === "human-has-other-wallet") {
    return {
      title: "SPOTTER already knows you.",
      detail: outcome.reason,
      retryable: true,
      cancelled: false,
      conflict: outcome.conflict,
      otherWallet: outcome.otherWallet,
    };
  }
  if (outcome.conflict === "wallet-has-other-human") {
    return {
      title: "This wallet is taken.",
      detail: outcome.reason,
      retryable: true,
      cancelled: false,
      conflict: outcome.conflict,
    };
  }
  return {
    title: outcome.status === 0 ? "Could not send the proof." : "Could not verify.",
    detail: outcome.reason,
    retryable: true,
    cancelled: false,
  };
}

export default function ProveHuman({ address, onVerified, onFailed }: ProveHumanProps) {
  const requestAuth = useWalletAuth();
  const [config, setConfig] = useState<WorldClientConfig | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [identity, setIdentity] = useState("");
  const [configNonce, setConfigNonce] = useState(0);
  // The server's verdict for the payload the widget is currently holding, so
  // onError can show the real reason instead of a generic "failed" line.
  const lastOutcome = useRef<VerifyOutcome | null>(null);
  // Set once a widget attempt has a result (either way), so a close event
  // that follows it is not mistaken for a cancel.
  const settled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchWorldConfig()
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setPhase(
          next.mode === "off" ? { kind: "off", problem: next.problem } : { kind: "idle" },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setPhase({
          kind: "unavailable",
          detail: "Could not reach GoHealthMe to see whether the World ID step is available here.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [configNonce]);

  const fail = useCallback(
    (failure: Failure) => {
      setPhase({ kind: "failed", failure });
      onFailed?.(failure.detail);
    },
    [onFailed],
  );

  const succeed = useCallback(
    (outcome: Extract<VerifyOutcome, { ok: true }>) => {
      setPhase({ kind: "verified", mode: outcome.mode, credential: outcome.credential });
      onVerified({ nullifierHash: outcome.nullifierHash });
    },
    [onVerified],
  );

  // ------------------------------------------------------------- live path

  // `stage` is "v4" from the button. "legacy" is only reached from
  // handleError, when World App says World ID 4.0 is not available on this
  // account yet (lib/world/credentials.ts): the check reopens with a fresh
  // rp_context on the 3.0 request instead of failing the person.
  async function startLive(stage: WorldRequestStage = "v4") {
    setPhase({ kind: "starting" });
    lastOutcome.current = null;
    // Get the wallet signature BEFORE World's modal opens. handleVerify needs
    // it to post the proof, and a signing prompt raised while IDKit's modal is
    // on screen renders behind it: live on 2026-09-26 the phone said success
    // and the page sat on "Transmitting verification to host app" forever.
    // The signature is cached for its freshness window, so handleVerify then
    // posts without prompting.
    const auth = await requestAuth();
    if (auth.kind !== "ok") {
      fail({
        title: "Sign with your wallet first.",
        detail: signatureBlockReason(auth),
        retryable: true,
        cancelled: false,
      });
      return;
    }
    try {
      const fresh = await mintRpContext();
      if (fresh.mode !== "live" || fresh.rp_context === undefined) {
        // The deployment changed under us; re-read and render what it says.
        setConfig(fresh);
        setPhase(fresh.mode === "off" ? { kind: "off", problem: fresh.problem } : { kind: "idle" });
        return;
      }
      setConfig(fresh);
      // Reset only now: a close event from the previous widget (the v4 stage
      // that just failed over) must not read as a cancel of this one.
      settled.current = false;
      setPhase({ kind: "widget", rpContext: fresh.rp_context, stage });
    } catch {
      fail({
        title: "Could not start the check.",
        detail: "GoHealthMe could not sign a World ID request just now. Try again.",
        retryable: true,
        cancelled: false,
      });
    }
  }

  async function handleVerify(result: IDKitResult): Promise<void> {
    const outcome = await submitProof({ address, proof: result, requestAuth });
    lastOutcome.current = outcome;
    if (!outcome.ok) {
      // Throwing is how the widget learns the host refused the proof; the
      // reason itself is rendered by onError below from lastOutcome.
      throw new Error(outcome.reason);
    }
  }

  function handleSuccess() {
    settled.current = true;
    const outcome = lastOutcome.current;
    if (outcome !== null && outcome.ok) {
      succeed(outcome);
      return;
    }
    // The widget reported success without a server ok. Never trust it.
    fail({
      title: "Could not verify.",
      detail: "The World check finished but GoHealthMe never confirmed it. Try again.",
      retryable: true,
      cancelled: false,
    });
  }

  function handleError(code: IDKitErrorCodes) {
    settled.current = true;
    const outcome = lastOutcome.current;
    if (outcome !== null && !outcome.ok) {
      fail(failureFromOutcome(outcome));
      return;
    }
    if (
      phase.kind === "widget" &&
      shouldFallBackToLegacy(String(code), phase.stage)
    ) {
      void startLive("legacy");
      return;
    }
    const view = idkitErrorView(code);
    fail({
      title: view.title,
      detail: view.detail,
      retryable: view.retryable,
      cancelled: view.cancelled,
    });
  }

  function handleOpenChange(open: boolean) {
    if (open || settled.current) return;
    if (phase.kind !== "widget") return;
    // Closed by the person before any result: a choice, shown as one.
    const view = idkitErrorView("cancelled");
    settled.current = true;
    fail({
      title: view.title,
      detail: view.detail,
      retryable: true,
      cancelled: true,
    });
  }

  // ------------------------------------------------------------- mock path

  async function startMock(action: string) {
    const trimmed = identity.trim();
    if (trimmed === "") {
      fail({
        title: "Pick a mock identity.",
        detail: "Type any name to stand in for your World ID. Nothing was checked.",
        retryable: true,
        cancelled: false,
      });
      return;
    }
    setPhase({ kind: "starting" });
    const proof = buildMockProof({ address, identity: trimmed, action });
    const outcome = await submitProof({ address, proof, requestAuth });
    if (outcome.ok) succeed(outcome);
    else fail(failureFromOutcome(outcome));
  }

  // ---------------------------------------------------------------- render

  const mode = config?.mode ?? "unknown";

  return (
    <section
      data-lane="world-idkit"
      data-phase={phase.kind}
      data-mode={mode}
      className="rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] px-4 py-[18px] shadow-card min-[960px]:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Open beta (lib/open-beta.ts): a player who skips still plays, so
            the card offers the badge and never states the rule as the rule. */}
        <h2 className="type-heading m-0 text-[1.75rem] text-balance">
          {openBeta() ? "Add World ID." : "Prove you're one human."}
        </h2>
        {/* A player sees a chip only when the proof is not the real thing:
            mocked on a dev or preview build, or World's test network. The
            real World ID needs no label. */}
        {mode === "mock" ? (
          <Badge tone="warning">Event mode: mocked proofs</Badge>
        ) : mode === "live" && config?.mode === "live" && config.environment === "staging" ? (
          <Badge tone="muted">World ID test mode</Badge>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-muted">
        {openBeta() ? "The one human, one entry badge. " : "One human, one entry. "}
        World ID checks that you are a person, not who you are. GoHealthMe never
        sees your name, and World never sees your health data.
      </p>

      {phase.kind === "loading" ? (
        <p className="mt-4 text-sm text-muted">Getting World ID ready…</p>
      ) : null}

      {phase.kind === "unavailable" ? (
        <div className="mt-4">
          <ErrorNote
            title="Could not load the World ID step."
            detail={phase.detail}
            onRetry={() => {
              setPhase({ kind: "loading" });
              setConfigNonce((n) => n + 1);
            }}
          />
        </div>
      ) : null}

      {phase.kind === "off" ? (
        <div className="mt-4 rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
          <p className="text-sm font-semibold">
            Prove-human is not enabled on this deployment.
          </p>
          <p className="mt-1 text-sm text-muted">
            {phase.problem ??
              (openBeta()
                ? "It is not switched on for this build, so this step is skipped."
                : "It is not switched on for this build, so this step is skipped and the closed-beta list decides who can play.")}
          </p>
        </div>
      ) : null}

      {phase.kind === "verified" ? (
        <div
          role="status"
          className="mt-4 rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]"
        >
          <p className="text-base font-semibold text-moonlight">
            Verified: one human.
          </p>
          <p className="mt-1 text-sm text-muted">
            {phase.mode === "mock"
              ? "Recorded in event mode with a mocked proof. This is not a real World ID verification and would not count outside the hackathon build."
              : `World verified you${
                  phase.credential !== null
                    ? ` with ${credentialLabel(phase.credential)}`
                    : ""
                }. SPOTTER has you down as one person, one entry.`}
          </p>
        </div>
      ) : null}

      {phase.kind === "failed" ? (
        <div className="mt-4">
          <ErrorNote
            title={phase.failure.title}
            detail={phase.failure.detail}
            onRetry={
              phase.failure.retryable
                ? () => {
                    lastOutcome.current = null;
                    settled.current = false;
                    setPhase({ kind: "idle" });
                  }
                : undefined
            }
          />
          {phase.failure.conflict === "human-has-other-wallet" &&
          phase.failure.otherWallet !== undefined ? (
            <p className="mt-3 text-sm text-muted">
              Sign out, then sign in with{" "}
              <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-xs">
                {shortAddress(phase.failure.otherWallet)}
              </code>{" "}
              to keep playing as the human you already proved. Nothing was staked
              from this wallet.
            </p>
          ) : null}
        </div>
      ) : null}

      {(phase.kind === "idle" || phase.kind === "starting" || phase.kind === "widget") &&
      config?.mode === "live" ? (
        <div className="mt-4 flex flex-col gap-3">
          <Button
            type="button"
            pop
            disabled={phase.kind !== "idle"}
            onClick={() => void startLive("v4")}
          >
            {phase.kind === "idle" ? "Verify with World App" : "Opening World App…"}
          </Button>
          <p className="text-xs text-muted">
            {config.environment === "staging"
              ? "Staging: scan the QR with World App on staging or the simulator at simulator.worldcoin.org."
              : "Scan the QR with World App. Any World ID works; if you are new, World App walks you through a quick selfie check."}
          </p>
        </div>
      ) : null}

      {(phase.kind === "idle" || phase.kind === "starting") && config?.mode === "mock" ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void startMock(config.action);
          }}
        >
          <p className="text-sm text-muted">
            ETHGlobal Tokyo mocks World proofs, so there is no QR here. Type an
            identity to stand in for your World ID. The same identity on a second
            wallet is refused; that is the rule this step enforces. This is not a
            real proof of personhood.
          </p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Mock identity
            <input
              type="text"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder="e.g. andre"
              autoComplete="off"
              className={`rounded-control bg-surface-deep px-3.5 text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] placeholder:text-haze ${TAP_TARGET} justify-start font-normal`}
            />
          </label>
          <Button type="submit" pop disabled={phase.kind !== "idle"}>
            {phase.kind === "idle" ? "Prove (mocked)" : "Checking…"}
          </Button>
        </form>
      ) : null}

      {phase.kind === "widget" && config?.mode === "live" ? (
        <IdkitWidgetHost
          open
          onOpenChange={handleOpenChange}
          appId={config.app_id}
          action={config.action}
          environment={config.environment}
          rpContext={phase.rpContext}
          stage={phase.stage}
          signalAddress={address}
          handleVerify={handleVerify}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      ) : null}
    </section>
  );
}
