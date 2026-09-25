import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ProfilePaidWall,
  type ProfileData,
  type Win,
} from "@/components/profile-paid-wall";
import { formatUsdc } from "@/lib/contract";
import { getProfileByHandle, ProfileLookupError } from "@/lib/server/social-profile";
import { errorMessage, newCorrelationId } from "@/lib/server/http";
import { getSocialStats } from "@/lib/server/social-stats";
import { NOINDEX } from "@/lib/site";
import { checkHandle } from "@/lib/social";

// Live on-chain stats and a Supabase lookup on every view, so never prerender.
export const dynamic = "force-dynamic";

/** Avatar glyph: the claimed one, or a plain monogram from the handle. No
 *  emoji literal lives in code - an absent glyph falls back to a letter. */
function avatarGlyph(handle: string, emoji: string | null): string {
  if (emoji !== null && emoji.trim() !== "") return emoji;
  const first = handle.trim().charAt(0).toUpperCase();
  return first === "" ? "?" : first;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  // Profiles are for the people who share them, never for a search result:
  // both branches are noindex. Titles are absolute so the root template does
  // not append a second " - GoHealthMe".
  const { handle } = await params;
  const check = checkHandle(handle);
  if (!check.ok) return { title: { absolute: "GoHealthMe" }, robots: NOINDEX };
  return {
    title: { absolute: `@${check.handle} on GoHealthMe` },
    description: "Health-goal wins and USDC payouts. No health category is ever shown.",
    robots: NOINDEX,
  };
}

/** The landing for a string that cannot be a handle at all: a growth loop,
 *  not a dead end. A well-formed handle nobody owns is a real 404 instead,
 *  so /u/<anything> cannot be farmed into an endless set of 200 pages. */
function Unclaimed({ handle }: { handle: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-16 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">@{handle}</h1>
        <p className="text-sm text-muted">
          Nobody has claimed this handle yet.
        </p>
        <Link
          href="/handle"
          className="rounded-xl bg-accent-strong px-5 py-3 text-sm font-semibold text-background hover:bg-accent"
        >
          Claim your handle
        </Link>
      </div>
    </main>
  );
}

/** The profile store did not answer. Not a 404: the handle may well exist. */
function LookupFailed({ handle, reference }: { handle: string; reference: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-16 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">@{handle}</h1>
        <p role="alert" className="text-sm text-muted">
          This profile could not be loaded right now. That is a problem on our
          side, not a missing page. Reference {reference}.
        </p>
        <Link
          href={`/u/${handle}`}
          className="rounded-xl bg-accent-strong px-5 py-3 text-sm font-semibold text-background hover:bg-accent"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const check = checkHandle(handle);
  if (!check.ok) return <Unclaimed handle={handle} />;

  let profile: Awaited<ReturnType<typeof getProfileByHandle>>;
  try {
    profile = await getProfileByHandle(check.handle);
  } catch (err) {
    // The store could not answer: a real, shared profile must not read as
    // "this page does not exist". Say it is a read problem and offer a retry.
    if (!(err instanceof ProfileLookupError)) throw err;
    const cid = newCorrelationId("profile");
    console.error(`[${cid}] ${errorMessage(err)}`, err);
    return <LookupFailed handle={check.handle} reference={cid} />;
  }
  if (profile === null) notFound();

  const stats = await getSocialStats(profile.address);

  const wins: Win[] = stats.recentWins.map((win, index) => ({
    id: `${win.txHash}-${index}`,
    at: win.at,
    amountUsd: win.amountUsd,
    txHash: win.txHash,
    role: win.role,
    tier: win.tier,
  }));

  const data: ProfileData = {
    handle: profile.handle,
    emoji: avatarGlyph(profile.handle, profile.emoji),
    address: profile.address,
    // Verified-tier wins ONLY. Self-reported wins are counted separately and
    // never inflate this figure.
    verifiedWins: stats.verifiedWins,
    selfReportedWins: stats.selfReportedWins,
    usdcEarned: formatUsdc(stats.usdcEarned),
    winStreak: stats.winStreak,
    wins,
    statsUnavailable: !stats.readable,
  };

  return <ProfilePaidWall profile={data} />;
}
