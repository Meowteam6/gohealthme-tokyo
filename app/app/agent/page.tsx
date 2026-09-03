import type { Metadata } from "next";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseAddressUrl } from "@/lib/chains";
import { optionalEnv } from "@/lib/server/env";
import { NOINDEX } from "@/lib/site";
import { Card } from "@/components/ui";
import SpotterMascot from "@/components/SpotterMascot";
import SpotterSays from "@/components/SpotterSays";
import AgentFeed from "./AgentFeed";

export const metadata: Metadata = {
  title: "SPOTTER",
  description:
    "The settlement agent's on-chain identity and every claim it has touched.",
  robots: NOINDEX,
};

// Resolved at request time, not baked at build, so the page reflects the
// deployment's real settler configuration.
export const dynamic = "force-dynamic";

// SPOTTER's public identity is the settler that actually moves money on this
// deployment. On the Base pilot that is the treasury settler keyed by
// TREASURY_PRIVATE_KEY - the same account lib/server/treasury.ts signs with -
// so its address is derived here the identical way. Only the derived address (a
// public value) is ever rendered; the key never leaves the server.
//
// The Circle developer-controlled wallet (CIRCLE_*) is the V2 settlement path
// and is NOT assumed to exist here. When no settler is configured the page says
// plainly that automatic settlement is not live on this deployment yet, and it
// never leaks env-var names or provisioning steps to an end user.
function settlerAddress(): string | null {
  const key = optionalEnv("TREASURY_PRIVATE_KEY", "");
  if (key === "") return null;
  try {
    const normalized = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
    return privateKeyToAccount(normalized).address;
  } catch {
    return null;
  }
}

export default function AgentPage() {
  const address = settlerAddress();
  const configured = address !== null;

  return (
    <div className="space-y-8">
      <Card pop className="bg-dot-grid">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <p className="font-display text-xs font-bold uppercase tracking-widest text-accent-strong">
              SPOTTER — settlement agent
            </p>
            <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">
              The otter runs the money.
            </h1>
            {address !== null ? (
              <>
                {/* The hex address is real and worth showing, but it is no
                 *  longer the hero: demoted to a tactile mono chip under a
                 *  friendly label so SPOTTER is who greets you, not the key. */}
                <div className="space-y-2">
                  <p className="font-display text-xs font-semibold uppercase tracking-wide text-muted">
                    SPOTTER&apos;s wallet
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex max-w-full items-center break-all rounded-full border-2 border-edge bg-secondary px-3 py-1 font-mono text-xs text-secondary-foreground">
                      {address}
                    </span>
                    <a
                      href={baseAddressUrl(address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-accent underline"
                    >
                      View on Basescan
                    </a>
                  </div>
                  {/* Testnet play-money disclosure stays visible, but in plain
                   *  words instead of a chain id - tan, never gold. */}
                  <p className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                    Base testnet · test USDC, not real money yet
                  </p>
                </div>
                {/* Precise about whose money moves, in friendly words: no
                 *  settle(), no chain id. The reward is the sponsor's USDC
                 *  leaving the pool, never this wallet's; SPOTTER only covers
                 *  the network fee, and nobody signs it by hand. */}
                <p className="text-sm leading-relaxed text-muted">
                  The moment a goal is verified, SPOTTER releases each
                  pool&apos;s USDC straight to the people who hit it - no human
                  ever taps a button. The reward is the sponsor&apos;s money
                  leaving the pool; SPOTTER just covers the tiny network fee to
                  send it.
                </p>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-muted">
                SPOTTER is GoHealthMe&apos;s settlement agent. The moment a goal
                is verified it releases each pool&apos;s USDC to the people who
                hit it, so payouts happen without anyone signing off by hand.
                Automatic payouts are not switched on for this deployment yet.
              </p>
            )}
          </div>
          <SpotterMascot
            pose="watching"
            caption="SPOTTER"
            sublabel={configured ? "on the clock" : "standing by"}
            size="md"
            className="self-center sm:self-start"
          />
        </div>
        {/* SPOTTER speaks for himself - the deadpan agent-header line. */}
        <div className="mt-6">
          <SpotterSays surface="agent-header" state="idle" size="md" />
        </div>
      </Card>

      <AgentFeed />
    </div>
  );
}
