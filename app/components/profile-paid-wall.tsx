// Public "paid wall" for a claimed handle. Renders a wallet's wins and USDC
// payouts WITHOUT ever revealing the health category behind any goal.
//
// THE REDACTION RULE IS STRUCTURAL HERE: ProfileData has no field that can
// carry an initiative, a goalSpec, or any health label - only a handle, an
// avatar glyph, an address, counts, USDC amounts, and settlement tx hashes. A
// win row shows a role and its trust tier ("Verified win" / "Self-reported
// win"), never what the goal was.
//
// THE HONESTY RULE: a self-reported win (a photo/screenshot we cannot confirm
// is real, recent, or theirs) is a real win paid at 1x, but it must NEVER carry
// a check/shield or read "Verified". The trust tier is resolved upstream in
// lib/server/social-stats (the facet bitmap, or SPOTTER's ledger verdict on an
// oracle-only pool). When the chain read fails, readOk is false and the page
// says so instead of rendering zeros as fact.

import { arcTxUrl } from "@/lib/chains";
import { profileWinPresentation, type ProofTier } from "@/lib/proof-tier";
import { Card, FOCUS_RING, Fine, Money, Stat, StatRow } from "@/components/ui";
import { CARD_TITLE, Notice, PAGE_COLUMN, PerchedHeader } from "@/components/night/kit";

export interface Win {
  id: string;
  at: string; // ISO timestamp
  amountUsd: string; // "40.00" - two decimals, exactly as the ledger recorded it
  txHash: string; // settlement tx hash -> Arcscan link
  role: "achiever";
  /** Trust tier of an achiever win. A "self-reported" win never renders as
   *  verified. */
  tier: ProofTier | null;
}

export interface ProfileData {
  handle: string;
  emoji: string; // avatar glyph (render as-is, it is user data)
  address: string;
  goalsHit: number; // every achiever win, all tiers
  verifiedWins: number; // verified-tier only; excludes self-reported
  selfReportedWins: number; // real wins, counted separately, never "verified"
  usdcEarned: string; // "1240.00"
  winStreak: number;
  wins: Win[]; // most recent first
  /** False when the chain could not be read; the figures above are then
   *  placeholders and are not rendered. */
  readOk: boolean;
}

const PRIVACY_COPY = "The health goal behind a win is never shown.";

/* ---------- inline SVG icons (no icon library, no emoji) ---------- */

function ShieldLockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <rect x="9.25" y="11" width="5.5" height="4.5" rx="1" />
      <path d="M10.5 11V9.75a1.5 1.5 0 013 0V11" />
    </svg>
  );
}

function CheckBadgeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2.5l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.7 2.6.7 2.6-2.3 1.4-1 2.5-2.7-.2L12 21.5l-2.2-1.6-2.7.2-1-2.5-2.3-1.4.7-2.6-.7-2.6 2.3-1.4 1-2.5 2.7.2L12 2.5z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M14 5h5v5" />
      <path d="M19 5l-7 7" />
      <path d="M19 13v4a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h4" />
    </svg>
  );
}

/* ---------- privacy line ---------- */

function PrivacyLine({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-[0.8125rem] text-haze ${className}`}>
      <ShieldLockIcon className="size-3.5 shrink-0" />
      <span className="text-pretty">{PRIVACY_COPY}</span>
    </p>
  );
}

/* ---------- helpers ---------- */

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const sec = Math.max(0, Math.floor(diff / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const wk = Math.floor(day / 7);
  if (sec < 60) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 7) return `${day}d ago`;
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

/* ---------- win row ---------- */

// Icon tones per trust tier. Self-reported and unknown wins carry NO check
// badge: a self-reported photo cannot be presented as verified.
const WIN_ICON_TONE: Record<"accent" | "warning" | "muted", string> = {
  accent: "bg-moonlight/10 text-moonlight",
  warning: "bg-fill-quiet text-warning shadow-[inset_0_0_0_1px_var(--border-strong)]",
  muted: "bg-fill-quiet text-haze",
};

function WinRow({ win }: { win: Win }) {
  const { label, tone, showCheck, sublabel } = profileWinPresentation(win.tier);
  return (
    <li className="flex items-center gap-3 border-t border-edge py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${WIN_ICON_TONE[tone]}`}
      >
        {showCheck ? (
          <CheckBadgeIcon className="size-5" />
        ) : tone === "warning" ? (
          <AlertIcon className="size-5" />
        ) : (
          <span aria-hidden="true" className="size-2 rounded-full bg-current" />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[0.9375rem] font-semibold text-foreground">{label}</span>
          {sublabel !== null ? (
            <span className="text-[0.8125rem] text-warning">{sublabel}</span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 text-[0.8125rem] text-haze">
          <span>{relativeTime(win.at)}</span>
          <a
            href={arcTxUrl(win.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex min-h-11 items-center gap-1 text-muted underline decoration-muted/35 underline-offset-4 hover:text-foreground ${FOCUS_RING}`}
          >
            Basescan
            <ExternalLinkIcon className="size-3" />
          </a>
        </span>
      </div>

      <Money usd={win.amountUsd} size="md" />
    </li>
  );
}

/* ---------- main component ---------- */

export function ProfilePaidWall({ profile }: { profile: ProfileData }) {
  // One pose, on the stat card: pleased when there are runs hit, calm when
  // there are none yet, thinking when the chain did not answer.
  const pose = !profile.readOk ? "thinking" : profile.goalsHit > 0 ? "thumbsup" : "meditate";
  return (
    <div className={`${PAGE_COLUMN} [&>*+*]:mt-8`}>
      <PerchedHeader
        above={
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-raised text-2xl leading-none text-moonlight shadow-[inset_0_0_0_1px_var(--border-strong)]"
            >
              {profile.emoji}
            </span>
            <span className="truncate font-mono text-[0.8125rem] text-haze" title={profile.address}>
              {truncateAddress(profile.address)}
            </span>
          </span>
        }
        title={`@${profile.handle}`}
        lead="Goals hit and what they paid, in test USDC on Base Sepolia."
        pose={pose}
      >
        {/* A failed chain read replaces the figures with a plain note: zeros
            here would be a false statement. */}
        {!profile.readOk ? (
          <Card>
            <Notice tone="limit" role="status" title="Could not read this player's challenges from the chain right now">
              Refresh in a minute to try again.
            </Notice>
          </Card>
        ) : (
          <Card>
            <StatRow>
              <Stat
                label="USDC earned"
                value={profile.usdcEarned}
                tone={Number(profile.usdcEarned) > 0 ? "money" : "dusk"}
                size="lg"
              />
              <Stat label="Goals hit" value={profile.goalsHit} size="lg" />
              <Stat label="Hit streak" value={profile.winStreak} size="lg" />
            </StatRow>
            {/* The tier split. Only wins proven verified carry the check;
                self-reported wins are counted separately and never folded in. */}
            <div className="mt-4 border-t border-edge pt-3 [&>*+*]:mt-2">
              {profile.verifiedWins > 0 ? (
                <p className="flex items-center gap-1.5 text-[0.8125rem] text-moonlight">
                  <CheckBadgeIcon className="size-3.5 shrink-0" />
                  <span>{profile.verifiedWins} verified by a wearable or a record</span>
                </p>
              ) : null}
              {profile.selfReportedWins > 0 ? (
                <p className="flex items-center gap-1.5 text-[0.8125rem] text-warning">
                  <AlertIcon className="size-3.5 shrink-0" />
                  <span>
                    Plus {profile.selfReportedWins} self-reported{" "}
                    {profile.selfReportedWins === 1 ? "win" : "wins"}, not verified
                  </span>
                </p>
              ) : null}
              <PrivacyLine />
            </div>
          </Card>
        )}
      </PerchedHeader>

      {/* Each row carries its own trust tier, so a self-reported win reads as
          self-reported, never verified. */}
      <Card as="section" aria-labelledby="wins-heading">
        <h2 id="wins-heading" className={CARD_TITLE}>
          Goals hit
        </h2>
        <div className="mt-4">
          {!profile.readOk ? (
            <p className="text-[0.9375rem] text-muted">They show here once the chain answers.</p>
          ) : profile.wins.length === 0 ? (
            <p className="text-[0.9375rem] text-muted">No goals hit yet.</p>
          ) : (
            <ul className="list-none">
              {profile.wins.map((win) => (
                <WinRow key={win.id} win={win} />
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Fine className="text-center">
        GoHealthMe: stake on your own health goal and get paid in test USDC when the
        challenge settles.
      </Fine>
    </div>
  );
}

export default ProfilePaidWall;
