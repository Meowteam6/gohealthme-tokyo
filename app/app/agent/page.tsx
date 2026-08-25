import type { Metadata } from "next";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseAddressUrl } from "@/lib/chains";
import { optionalEnv } from "@/lib/server/env";
import AgentFeed from "./AgentFeed";

export const metadata: Metadata = {
  title: "SPOTTER — GoHealthMe",
  description:
    "The settlement agent's on-chain identity and every claim it has touched.",
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
      <section className="rounded-2xl border border-edge bg-surface p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">
              SPOTTER — settlement agent
            </p>
            {address !== null ? (
              <>
                <p className="mt-4 break-all font-mono text-2xl font-semibold leading-tight sm:text-3xl">
                  {address}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <span className="text-xs uppercase tracking-wide text-muted">
                    Base Sepolia · chain id 84532
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
                {/* Precise about whose money moves. settle() pays achievers out
                 *  of the pool balance held by HealthPools - the reward is the
                 *  sponsor's USDC leaving the pool, never this wallet's. This
                 *  wallet signs the settlement and covers the gas; nobody signs
                 *  it by hand. */}
                <p className="mt-4 text-sm text-muted">
                  SPOTTER settles payouts on Base. The moment a goal is verified
                  it signs the settle() that releases each pool&apos;s USDC to
                  the achievers - the reward is the pool&apos;s own funds leaving
                  the pool, and this wallet covers the gas, not the payout.
                  Nobody signs it by hand.
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-muted">
                SPOTTER is GoHealthMe&apos;s settlement agent. The moment a goal
                is verified it releases each pool&apos;s USDC to the achievers,
                so payouts happen without anyone signing off by hand. Automatic
                settlement is not live on this deployment yet.
              </p>
            )}
          </div>
          <div className="shrink-0 self-center sm:self-start">
            <div className="otter-float w-36 overflow-hidden rounded-2xl border border-edge bg-surface-raised sm:w-44">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/spotter/spotter-watching.png"
                alt="SPOTTER, the otter, watching the ledger"
                className="aspect-square w-full object-cover"
              />
            </div>
            <p className="mt-2 text-center text-xs uppercase tracking-wide text-muted">
              {configured ? "on the clock" : "standing by"}
            </p>
          </div>
        </div>
      </section>

      <AgentFeed />
    </div>
  );
}
