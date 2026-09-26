import type { Metadata } from "next";
import PoolDetail from "@/components/PoolDetail";
import { displayGoalSpec, fetchPool } from "@/lib/contract";
import { NOINDEX } from "@/lib/site";

// Tab titles carry the pool's goal text so shared links read as the goal,
// not as a bare app name. The root layout appends " - GoHealthMe" to every
// title below; the fallback is absolute so a failure never reads
// "GoHealthMe - GoHealthMe". Metadata failures (bad id, RPC hiccup) fall back
// to the app title rather than failing the page.
const FALLBACK_TITLE = { absolute: "GoHealthMe" };
// A fallback is not a page worth a canonical. Dropping the one inherited from
// app/pools/layout.tsx keeps a bad id from claiming to be the pool list.
const NO_CANONICAL = { canonical: null };
// A challenge is a private, person-aimed dare on a health-adjacent goal. Its
// goal text must never reach a tab title, a link-preview card, or crawlable
// metadata - pool ids are sequential, so anyone can walk /pools/<n>. The goal
// lives only on the gated page below, never here.
const PRIVATE_CHALLENGE_TITLE = "Private challenge";
const TITLE_MAX = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const poolId = BigInt(id);
    if (poolId <= 0n) {
      return { title: FALLBACK_TITLE, alternates: NO_CANONICAL };
    }
    const pool = await fetchPool(poolId);
    if (pool.initiative === "challenge") {
      // Person-aimed and walkable by id: never indexed, never a canonical.
      return {
        title: PRIVATE_CHALLENGE_TITLE,
        robots: NOINDEX,
        alternates: NO_CANONICAL,
      };
    }
    const goal = displayGoalSpec(pool.goalSpec).trim();
    if (goal === "") return { title: FALLBACK_TITLE, alternates: NO_CANONICAL };
    const trimmed =
      goal.length > TITLE_MAX
        ? `${goal.slice(0, TITLE_MAX - 3).trimEnd()}...`
        : goal;
    return {
      title: trimmed,
      description: `${trimmed}. A GoHealthMe challenge: put test USDC on yourself, your wearable proves it. Beta on Base Sepolia testnet, no real money.`,
      alternates: { canonical: `/pools/${poolId}` },
    };
  } catch {
    return { title: FALLBACK_TITLE, alternates: NO_CANONICAL };
  }
}

export default async function PoolPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PoolDetail id={id} />;
}
