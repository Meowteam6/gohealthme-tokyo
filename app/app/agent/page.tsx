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
import { Card, Fine, Stat, StatRow, Tag, TEXT_LINK } from "@/components/ui";
import SpotterSays from "@/components/SpotterSays";
import { CARD_TITLE, Notice, PAGE_COLUMN, PerchedHeader } from "@/components/night/kit";
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
      return "Before SPOTTER records a win, he asks the player who hit to confirm with World ID. No confirmation, no payout.";
    case "mock":
      return "Before SPOTTER records a win, he asks the player who hit to confirm with World ID. On this build that confirmation is mocked, not a real World ID check. No confirmation, no payout.";
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
    <div className={`${PAGE_COLUMN} [&>*+*]:mt-8`}>
      <PerchedHeader
        title="History"
        lead="Every verdict SPOTTER reached on your runs, your World ID confirmations, and what each run paid."
        pose="detective"
      >
        <AgentFeed />
      </PerchedHeader>

      <Card as="section" aria-labelledby="settler" className="[&>*+*]:mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="settler" className={CARD_TITLE}>
            The wallet SPOTTER settles from
          </h2>
          {settler.kind === "ok" ? (
            onTheClock ? <Tag>On the clock</Tag> : <Tag tone="muted">Standing by</Tag>
          ) : null}
        </div>
        <p className="m-0 text-[0.9375rem] leading-[1.5] text-muted">
          SPOTTER reads each run&apos;s result and signs the settle. The run&apos;s
          contract holds the stakes and pays the players who hit; this wallet only
          covers the network fee and buys the checks. {approvalLine(approval)}
        </p>
        {settler.kind === "ok" ? (
          <>
            <div>
              <p className="m-0 mb-1.5 text-[0.8125rem] text-haze">Address</p>
              <p className="m-0 break-all rounded-control bg-surface-deep px-3.5 py-3 font-mono text-xs text-muted shadow-[inset_0_0_0_1px_var(--border-strong)]">
                {settler.address}
              </p>
              <a
                href={baseAddressUrl(settler.address)}
                target="_blank"
                rel="noopener noreferrer"
                className={`${TEXT_LINK} text-sm`}
              >
                View on Basescan
              </a>
            </div>
            <StatRow className="border-t border-edge pt-3">
              <Stat
                label="Budget for buying checks"
                value={toUsd2(settler.balanceUsd)}
                unit="USDC"
                tone="money"
              />
            </StatRow>
            <Fine>Base Sepolia test USDC, not real money.</Fine>
            {!sweepOn ? (
              <Notice tone="limit">Scheduled settling is not switched on for this deployment yet.</Notice>
            ) : null}
          </>
        ) : settler.kind === "unreachable" ? (
          <Notice tone="limit" role="status">
            Could not reach SPOTTER&apos;s wallet right now, so its address and budget are
            not shown. Refresh in a minute.
          </Notice>
        ) : (
          <Notice tone="limit">
            Automatic payouts are not switched on for this deployment yet. Runs can
            still be joined; nobody gets paid until SPOTTER&apos;s wallet is connected.
          </Notice>
        )}
        {broke ? (
          <SpotterSays
            surface="agent-header"
            state="broke"
            bare
            say="I am out of money for checks, so checks wait until I am topped up. Your stake stays in the run's contract."
          />
        ) : (
          <SpotterSays
            surface="agent-header"
            state="idle"
            bare
            say="I buy the check, I read the result, I sign the settle. The contract pays."
          />
        )}
      </Card>
    </div>
  );
}
