import type { Metadata } from "next";
import Link from "next/link";
import HeroActivityTicker from "@/components/HeroActivityTicker";
import { CommitmentBeats } from "@/components/CommitmentTerms";
import LandingCta from "@/components/game/LandingCta";
import Spotter from "@/components/spotter/Spotter";
import Perch from "@/components/spotter/Perch";
import Moon from "@/components/spotter/Moon";
import { Card, Fine, buttonClasses } from "@/components/ui";
import type { SpotterPose } from "@/lib/spotter-poses";
import { approvalMode } from "@/lib/server/agent/approval-provider";
import { worldSetup } from "@/lib/server/world/config";

// Title, description and share card come from the root layout. The landing
// only pins its canonical so tracking or deploy query strings collapse to /.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// The landing describes THIS deployment, not the roadmap: whether the human
// step is World ID or the closed-beta list, and whether SPOTTER asks the
// winner to confirm before it pays, both depend on config. A misconfigured
// approval mode fails closed on the server (every payout holds), so the copy
// treats it as "confirmation on".
function deploymentCopy(): { human: boolean; confirm: boolean } {
  const human = worldSetup().mode !== "off";
  let confirm = true;
  try {
    confirm = approvalMode() !== "off";
  } catch {
    confirm = true;
  }
  return { human, confirm };
}

interface RunStep {
  title: string;
  body: string;
  pose: SpotterPose;
}

// The run, start to finish. A real sequence, so it is numbered, and each step
// is SPOTTER doing that step's job.
function runSteps(human: boolean, confirm: boolean): RunStep[] {
  return [
    {
      title: "Make your player",
      body: human
        ? "Sign in with an email, prove you are one human with World ID, pick a name, pair your wearable. Once."
        : "Sign in with an email, get your spot in the closed beta, pick a name, pair your wearable. Once.",
      pose: "wave",
    },
    {
      title: "Pick a run and stake on yourself",
      body: "Sleep, steps, workouts. The lobby tells you which runs your wearable can actually measure before you put a cent down.",
      pose: "wearable",
    },
    {
      title: "Bank your nights",
      body: "Your wearable syncs, the board counts. 3 of 5 banked, tonight still counts, and you can see who else is still in.",
      pose: "sleep",
    },
    {
      title: "The verdict",
      body: confirm
        ? "SPOTTER checks the data, asks you to confirm it is you with World ID, and settles in test USDC: your stake back and your share if you hit, your stake to the players who hit if you miss."
        : "SPOTTER checks the data and settles in test USDC: your stake back and your share if you hit, your stake to the players who hit if you miss.",
      pose: "detective",
    },
  ];
}

export default function Home() {
  const { human, confirm } = deploymentCopy();
  const RUN = runSteps(human, confirm);
  return (
    <div className="flex flex-col gap-14 pb-4 sm:gap-20">
      {/* The night stage (docs/DESIGN.md): the headline, then the moon behind
          the card and SPOTTER asleep on its top edge. The card carries the one
          action. */}
      <section
        aria-labelledby="poster-title"
        className="relative isolate max-[899px]:-mx-[var(--gutter)] max-[899px]:overflow-x-clip max-[899px]:px-[var(--gutter)] min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,500px)] min-[900px]:items-center min-[900px]:gap-x-14 min-[900px]:pb-10"
      >
        <div>
          <h1 id="poster-title" className="type-display m-0 text-[2.75rem] min-[900px]:text-[5rem] min-[900px]:leading-[0.98]">
            Put money on yourself.
          </h1>
          <p className="m-0 mt-3 text-[1.0625rem] leading-[1.45] text-muted min-[900px]:mt-[22px] min-[900px]:text-[1.3125rem]">
            <span className="block">Stake on your sleep or workouts.</span>
            <span className="block">Your wearable decides.</span>
          </p>
        </div>

        <div className="relative mt-[18px] min-[900px]:mt-0">
          <Moon className="absolute left-[calc(50%-16px)] top-0.5 z-0 min-[900px]:left-auto min-[900px]:right-[-8px] min-[900px]:top-[-18px]" />
          <Perch state="landing-hero" side="left" inset={[6, 18]} priority decorative>
            <Card variant="hero" className="z-[2]">
              <p className="m-0 text-[1.25rem] font-semibold leading-tight tracking-[-0.01em] min-[900px]:text-[1.375rem]">
                Sleep and workout runs, checked by your wearable
              </p>
              <p className="m-0 mt-2 text-sm leading-[1.45] text-muted">
                Everyone stakes the same. Hit your goal and your stake comes
                back with a share. Your health data stays private.
              </p>
              <div className="mt-3.5">
                <LandingCta />
              </div>
              <Fine className="mt-2 text-center">Test USDC during beta.</Fine>
            </Card>
          </Perch>
        </div>
      </section>

      <p className="-mt-6 max-w-2xl text-sm text-muted sm:-mt-10">
        In beta on Base Sepolia test USDC, built at ETHGlobal Tokyo 2026:
        nothing here can cost you real money. Not medical or financial advice.{" "}
        <Link href="/privacy" className="text-accent-deep underline underline-offset-2 hover:text-foreground">
          Privacy
        </Link>{" "}
        and{" "}
        <Link href="/terms" className="text-accent-deep underline underline-offset-2 hover:text-foreground">
          Terms
        </Link>
        .
      </p>

      <section id="how" aria-labelledby="how-it-works" className="scroll-mt-20 space-y-5">
        <h2
          id="how-it-works"
          className="font-display text-[2rem] font-extrabold leading-display tracking-display sm:text-[2.5rem]"
        >
          How it works
        </h2>
        <CommitmentBeats />
      </section>

      <section aria-labelledby="how-a-run-goes" className="space-y-6">
        <h2
          id="how-a-run-goes"
          className="font-display text-[2rem] font-extrabold leading-display tracking-display sm:text-[2.5rem]"
        >
          How a run goes
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2">
          {RUN.map((step, i) => (
            <li
              key={step.title}
              className="flex items-start gap-4 rounded-3xl border border-edge bg-surface p-5"
            >
              <Spotter pose={step.pose} size="xs" decorative />
              <div className="min-w-0">
                <h3 className="font-display text-xl font-bold leading-tight">
                  <span className="tabular-nums text-accent-deep">{i + 1}.</span>{" "}
                  {step.title}
                </h3>
                <p className="mt-1.5 text-base text-foreground/85">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="whats-happening" className="space-y-4">
        <h2
          id="whats-happening"
          className="font-display text-[1.75rem] font-extrabold leading-display tracking-display"
        >
          Happening right now
        </h2>
        <HeroActivityTicker />
      </section>

      <section className="grid gap-6 rounded-3xl border border-edge bg-surface p-6 sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div className="space-y-4">
          <h2 className="font-display text-[1.75rem] font-extrabold leading-display tracking-display sm:text-[2.5rem]">
            You cannot Venmo your grandma in another country to go for a walk.
          </h2>
          <p className="max-w-xl text-lg text-foreground/85">
            USDC can pay her when she does, with no bank and no border in the
            way. Challenge a friend, back your parents, and the money lands when
            the wearable says it happened. Today it runs on test money while we
            build; real payouts are the road ahead, not a claim.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <Link
            href="/challenge/new"
            className={`${buttonClasses({ variant: "secondary" })}`}
          >
            Challenge a friend
          </Link>
          <Link
            href="/feed"
            className="inline-flex min-h-11 items-center font-bold text-accent-deep underline underline-offset-4 hover:text-foreground"
          >
            See who got paid
          </Link>
          <Link
            href="/pools/create"
            className="inline-flex min-h-11 items-center font-bold text-accent-deep underline underline-offset-4 hover:text-foreground"
          >
            Put up a prize for someone else
          </Link>
        </div>
      </section>
    </div>
  );
}
