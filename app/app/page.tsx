import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import GoalIntent from "@/components/GoalIntent";
import SpotterIntroCard from "@/components/SpotterIntroCard";
import HeroBaseCta from "@/components/HeroBaseCta";
import HeroActivityTicker from "@/components/HeroActivityTicker";
import { Badge, Button, Card } from "@/components/ui";

// Title, description and share card come from the root layout. The landing
// only pins its canonical so tracking or deploy query strings collapse to /.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// A small emerald "candy" chip that holds a step number or an icon. Kept local
// to the home surface so the numbered steps and the why-crypto cards share one
// tactile mark instead of hand-rolling a badge per block.
function IconChip({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/12 font-display text-sm font-bold text-accent-strong">
      {children}
    </span>
  );
}

// Reasons this has to be crypto, each with its own icon so the wall of text
// reads as three friendly cards. Stroke icons match the app's 24x24 set.
const reasons = [
  {
    title: "Here now",
    body: "Dare one friend, fund their goal, they get paid in USDC when they hit it. Verified in a sealed enclave - nobody sees the health data.",
    icon: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  },
  {
    title: "You vs your goal, nobody else",
    body: "You put your own USDC up on your own goal and get it back, with a cut of what the no-shows forfeited, the moment you hit it. A sponsor can fund it instead - either way you are never pitted against another person.",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
  },
  {
    title: "Where it's going",
    body: "Whole families and communities, across borders and languages, competing to show up for each other. The licensed road ahead.",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3.5 9h17M3.5 15h17M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
      </>
    ),
  },
];

const steps = [
  {
    title: "Say what you are going to do",
    body: "Sleep streak, flu shot, back in the gym. Put your own USDC behind it - the ones who show up split what the ones who don't leave on the table.",
  },
  {
    title: "SPOTTER buys the proof-check",
    body: "SPOTTER pays for the proof-check itself, per claim, out of its own budget and under a hard cap. Every cent prints on screen.",
  },
  {
    title: "Paid the second it is proven",
    body: "The verdict comes out of a confidential enclave - nobody ever sees your health data - and SPOTTER settles the pool on Base. Your stake comes back with a cut of the forfeited stakes, straight to your wallet. SPOTTER covers the gas and the proof-check. No human in the loop.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-14 py-6 sm:py-12">
      <section className="bg-dot-grid grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left: the pitch. Every functional control stays; only the layout
            goes asymmetric so SPOTTER gets to share the hero. */}
        <div className="text-center lg:text-left">
          <p className="font-display text-sm font-semibold uppercase tracking-widest text-accent-strong">
            A commitment pool for health goals
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Stake on your goal. Split what the no-shows leave behind.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted lg:mx-0">
            GoHealthMe is a commitment pool for health goals. Everyone stakes
            their own test USDC on the same goal. Show up and you get your
            stake back plus a cut of what the no-shows left on the table - paid
            the second SPOTTER verifies it. A sponsor can fund the pool instead.
            Nobody ever sees your health data.
          </p>
          {/* Phone only: the otter and the Base button, surfaced right under the
              pitch. On desktop the right column carries them; on a phone that
              column is off the bottom of the screen, so they live here instead.
              Hidden at lg, where the right column takes over. */}
          <div className="mx-auto mt-8 flex w-full max-w-sm flex-col gap-4 lg:hidden">
            <SpotterIntroCard />
            <HeroBaseCta />
          </div>
          {/* The one honest line. "Put money on it" read like a bill, and the
              only testnet disclosure in the app used to be on /pools - a
              stranger deserves to know the stakes before they type anything. */}
          <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center lg:justify-start">
            <Badge tone="muted">Base Sepolia</Badge>
            <p className="text-sm leading-relaxed text-muted">
              The USDC is test USDC. You put in nothing and nothing here can cost
              you real money.
            </p>
          </div>
          <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted">
            Testnet demo, play-money USDC. Not medical or financial advice. See{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="underline hover:text-foreground">
              Terms
            </Link>
            .
          </p>
          <GoalIntent />
          <div className="mt-6 flex flex-col items-center gap-2 lg:items-start">
            {/* Coral = the human dare, never money. A real CTA, so it wears the
                shared candy Button instead of a hand-rolled pill. */}
            <Link href="/challenge/new" className="inline-flex">
              <Button variant="coral" pop type="button">
                or dare a friend and put up a reward
                <span aria-hidden="true">-&gt;</span>
              </Button>
            </Link>
            <p className="max-w-md text-xs text-muted">
              You fund the reward, they hit the goal, they get paid. They flake,
              you get it back. Their health data stays private the whole way.
            </p>
          </div>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
            <Link
              href="/pools"
              className="py-2 text-sm font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
            >
              or browse the live pools
            </Link>
            <Link
              href="/pools/create"
              className="py-2 text-sm font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
            >
              sponsoring instead? put up a bounty
            </Link>
            <Link
              href="/feed"
              className="py-2 text-sm font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
            >
              see who got paid
            </Link>
            <Link
              href="/handle"
              className="py-2 text-sm font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
            >
              claim your handle
            </Link>
          </div>

          {/* Phone only: the live activity ticker, at the foot of the hero. On
              desktop it lives in the right column above. */}
          <div className="mx-auto mt-8 w-full max-w-sm lg:hidden">
            <HeroActivityTicker />
          </div>
        </div>

        {/* Right column, DESKTOP ONLY: SPOTTER intro over the live activity
            ticker - the whole system's real on-chain moments (joins, rewards put
            up, payouts), newest first, never invented rows. Hidden on a phone,
            where a tall pitch pushed it off the bottom of the screen; the otter +
            Base button and (below) the ticker are surfaced up front in the left
            column instead. */}
        <div className="mx-auto hidden w-full max-w-sm flex-col gap-4 lg:flex">
          <SpotterIntroCard />
          <HeroActivityTicker />
        </div>
      </section>

      {/* One heading anchors the three steps, so a reader (or an answer
          engine) has a "how does it work" section to land on. Styled as the
          same eyebrow the why-crypto section uses; the step titles sit under
          it as h3s. */}
      <section aria-labelledby="how-it-works">
        <h2
          id="how-it-works"
          className="font-display text-xs font-semibold uppercase tracking-widest text-accent-strong"
        >
          How GoHealthMe works
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <Card key={step.title}>
              <IconChip>0{i + 1}</IconChip>
              <h3 className="mt-4 font-display text-lg font-bold">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {step.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-edge bg-surface-raised p-8 sm:p-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-display text-xs font-semibold uppercase tracking-widest text-accent-strong">
              Why it has to be crypto
            </p>
            <h2 className="mt-3 max-w-2xl font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              You can&apos;t Venmo your grandma in another country to go for a
              walk. You can pay her in USDC the second she does.
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed text-muted">
              Crypto is the only rail that lets someone in one country reward
              someone in another — instantly, for a real thing they did. No
              bank, no borders, no week-long wire. Dare a friend, back a
              parent&apos;s goal, and the money lands the moment they hit it.
            </p>
          </div>
          {/* SPOTTER making the point. eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/spotter/spotter-point.png"
            alt=""
            aria-hidden="true"
            className="hidden h-36 w-auto shrink-0 self-center drop-shadow-sm lg:block"
          />
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {reasons.map((reason) => (
            <Card key={reason.title}>
              <IconChip>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  {reason.icon}
                </svg>
              </IconChip>
              <p className="mt-4 font-display text-sm font-bold">
                {reason.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {reason.body}
              </p>
            </Card>
          ))}
        </div>
        <p className="mt-8 text-xs leading-relaxed text-muted">
          Today it runs on Base Sepolia with play-money USDC while we build. Real
          cross-border payouts are the road ahead, not a claim that they are live.
        </p>
      </section>
    </div>
  );
}
