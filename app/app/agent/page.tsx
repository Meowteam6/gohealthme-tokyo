import type { Metadata } from "next";
import { baseAddressUrl } from "@/lib/chains";
import { agentIsBroke } from "@/lib/agent-budget";
import { toUsd2 } from "@/lib/agent-receipt";
import { optionalEnv } from "@/lib/server/env";
import { approvalMode, type ApprovalMode } from "@/lib/server/agent/approval-provider";
import {
  getCircleClient,
  getSpotterUsdcBalance,
  getSpotterWallet,
} from "@/lib/server/agent/wallet";
import { NOINDEX } from "@/lib/site";
import { Card, Money } from "@/components/ui";
import SpotterMascot from "@/components/SpotterMascot";
import SpotterSays from "@/components/SpotterSays";
import AgentFeed from "./AgentFeed";

export const metadata: Metadata = {
  title: "History",
  description:
    "Your verdicts, World ID confirmations and payouts, everyone's claims, and the wallet SPOTTER settles from.",
  robots: NOINDEX,
};

// Resolved at request time, not baked at build, so the page reflects the
// deployment's real settler configuration and balance.
export const dynamic = "force-dynamic";

// SPOTTER's public identity is the wallet that actually signs every record and
// settle: the Circle developer-controlled wallet on Base Sepolia (lib/server/
// agent/wallet.ts, read by CIRCLE_WALLET_ID). The run and sweep routes both
// act through getCircleClient(), so a user who checks Basescan finds the
// settles under this address. The treasury key is a different account (it
// funds the faucet) and is never shown here as SPOTTER.
//
// Only public values reach the page: the address and its USDC balance. Every
// failure renders as a plain product state; env names, Circle errors and
// provisioning steps stay in the server log.

type Settler =
  | { kind: "off" }
  | { kind: "unreachable" }
  | { kind: "ok"; address: string; balanceUsd: string };

const WALLET_READ_TIMEOUT_MS = 6_000;

function circleConfigured(): boolean {
  return (
    optionalEnv("CIRCLE_API_KEY", "") !== "" &&
    optionalEnv("CIRCLE_ENTITY_SECRET", "") !== "" &&
    optionalEnv("CIRCLE_WALLET_ID", "") !== ""
  );
}

async function readSettler(): Promise<Settler> {
  if (!circleConfigured()) return { kind: "off" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = getCircleClient();
    const read = Promise.all([
      getSpotterWallet(client),
      getSpotterUsdcBalance(client),
    ]);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("SPOTTER wallet read timed out")),
        WALLET_READ_TIMEOUT_MS,
      );
    });
    const [wallet, balance] = await Promise.race([read, timeout]);
    return { kind: "ok", address: wallet.address, balanceUsd: balance.amount };
  } catch (err) {
    console.error("[agent page] SPOTTER wallet read failed", err);
    return { kind: "unreachable" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The human step on payouts, as this deployment runs it. A mode that throws
 *  is a misconfiguration the server fails closed on, so it reads as held. */
function readApproval(): ApprovalMode | "misconfigured" {
  try {
    return approvalMode();
  } catch {
    return "misconfigured";
  }
}

function approvalLine(mode: ApprovalMode | "misconfigured"): string {
  switch (mode) {
    case "world":
      return "Before SPOTTER records a win, it asks the winner to confirm with World ID. No confirmation, no payout.";
    case "mock":
      return "Before SPOTTER records a win, it asks the winner to confirm with World ID. On this build that confirmation is mocked, not a real World ID check. No confirmation, no payout.";
    case "misconfigured":
      return "Payout confirmation is not set up correctly on this deployment, so SPOTTER is holding every payout until it is fixed.";
    case "off":
      return "Nobody signs off by hand: the verdict alone decides.";
  }
}

export default async function AgentPage() {
  const settler = await readSettler();
  const approval = readApproval();
  // Without the sweep secret, the scheduled settle cannot run at all.
  const sweepOn = optionalEnv("CRON_SECRET", "") !== "";
  const broke = settler.kind === "ok" && agentIsBroke(settler.balanceUsd);
  const onTheClock = settler.kind === "ok" && sweepOn && !broke;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          History
        </h1>
        <p className="text-sm text-muted">
          Every verdict SPOTTER reached on your runs, your World ID
          confirmations, and what it paid.
        </p>
      </header>

      <AgentFeed />

      <Card pop className="bg-dot-grid">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <p className="font-display text-xs font-bold uppercase tracking-widest text-accent-deep">
              SPOTTER, settlement agent
            </p>
            <h2 className="font-display text-2xl font-bold leading-tight sm:text-3xl">
              The otter runs the money.
            </h2>
            {settler.kind === "ok" ? (
              <div className="space-y-2">
                <p className="font-display text-xs font-semibold uppercase tracking-wide text-muted">
                  SPOTTER&apos;s wallet, the one that signs every settle
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex max-w-full items-center break-all rounded-full border-2 border-edge bg-secondary px-3 py-1 font-mono text-xs text-secondary-foreground">
                    {settler.address}
                  </span>
                  <a
                    href={baseAddressUrl(settler.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-sm text-accent-deep underline"
                  >
                    View on Basescan
                  </a>
                </div>
                <p className="flex flex-wrap items-baseline gap-2 text-sm text-muted">
                  Budget for buying verifications
                  <Money usd={toUsd2(settler.balanceUsd)} size="sm" />
                  <span>test USDC</span>
                </p>
                <p className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                  Base Sepolia, test USDC, not real money
                </p>
              </div>
            ) : settler.kind === "unreachable" ? (
              <p
                role="status"
                className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground/85"
              >
                Could not reach SPOTTER&apos;s wallet right now, so its address
                and budget are not shown. Refresh in a minute.
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-muted">
                Automatic payouts are not switched on for this deployment yet.
                Runs can still be joined; nobody gets paid until SPOTTER&apos;s
                wallet is connected.
              </p>
            )}
            <p className="text-sm leading-relaxed text-muted">
              When a run settles, SPOTTER releases each pool&apos;s USDC to the
              people who hit the goal. The reward is the pool&apos;s money, not
              this wallet&apos;s; SPOTTER covers the network fee.{" "}
              {approvalLine(approval)}
            </p>
            {settler.kind === "ok" && !sweepOn ? (
              <p className="text-sm text-muted">
                Scheduled settling is not switched on for this deployment yet.
              </p>
            ) : null}
          </div>
          <SpotterMascot
            pose="watching"
            caption="SPOTTER"
            sublabel={onTheClock ? "on the clock" : "standing by"}
            size="md"
            className="self-center sm:self-start"
          />
        </div>
        <div className="mt-6">
          {broke ? (
            <SpotterSays surface="agent-header" state="broke" size="md" />
          ) : (
            <SpotterSays surface="agent-header" state="idle" size="md" />
          )}
        </div>
      </Card>
    </div>
  );
}
