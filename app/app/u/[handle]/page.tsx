import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ProfilePaidWall,
  type ProfileData,
  type Win,
} from "@/components/profile-paid-wall";
import { formatUsdc } from "@/lib/contract";
import { getProfileByHandle } from "@/lib/server/social-profile";
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

/** The landing for a string that cannot be a handle at all (reserved, too
 *  short, bad characters). It can never be claimed, so the page says that and
 *  points at the feed instead of offering a claim that would dead-end. A
 *  well-formed handle nobody owns is a real 404, so /u/<anything> cannot be
 *  farmed into an endless set of 200 pages. */
function NotAHandle({ handle }: { handle: string }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-12 text-center">
      <h1 className="max-w-full break-words text-2xl font-bold tracking-tight">
        @{handle}
      </h1>
      <p className="text-sm text-muted">
        That is not a player name anyone can hold here.
      </p>
      <Link
        href="/feed"
        className="inline-flex min-h-11 items-center rounded-xl bg-accent-strong px-5 py-3 text-sm font-semibold text-background hover:bg-accent"
      >
        See who got paid
      </Link>
    </div>
  );
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const check = checkHandle(handle);
  if (!check.ok) return <NotAHandle handle={handle} />;

  const profile = await getProfileByHandle(check.handle);
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
    goalsHit: stats.goalsHit,
    // Verified-tier wins ONLY. Self-reported wins are counted separately and
    // never inflate this figure.
    verifiedWins: stats.verifiedWins,
    selfReportedWins: stats.selfReportedWins,
    usdcEarned: formatUsdc(stats.usdcEarned),
    winStreak: stats.winStreak,
    wins,
    readOk: stats.readOk,
  };

  return <ProfilePaidWall profile={data} />;
}
