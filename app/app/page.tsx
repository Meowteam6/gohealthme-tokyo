import type { Metadata } from "next";
import Link from "next/link";
import HeroActivityTicker from "@/components/HeroActivityTicker";
import LandingCta from "@/components/game/LandingCta";
import Spotter, { SpotterBubble } from "@/components/spotter/Spotter";
import { SPOTTER_BACKDROP_SRC, type SpotterPose } from "@/lib/spotter-poses";
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
        ? "SPOTTER checks the data, asks you to confirm it is you with World ID, and pays in test USDC when the run settles. Miss it and there is no prize; your stake is credited back at settle."
        : "SPOTTER checks the data and pays in test USDC when the run settles. Miss it and there is no prize; your stake is credited back at settle.",
      pose: "detective",
    },
  ];
}

export default function Home() {
  const { human, confirm } = deploymentCopy();
  const RUN = runSteps(human, confirm);
  return (
    <div className="flex flex-col gap-14 pb-4 sm:gap-20">
      {/* The poster. SPOTTER holds the coin; the page says what the coin is
          for; one coral action. Full bleed on a phone. */}
      <section
        aria-labelledby="poster-title"
        className="relative -mx-4 -mt-8 overflow-hidden bg-surface-raised sm:mx-0 sm:mt-0 sm:rounded-3xl sm:border sm:border-edge"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={SPOTTER_BACKDROP_SRC}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-bottom"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-3/5 bg-gradient-to-b from-background/90 via-background/60 to-transparent lg:inset-y-0 lg:left-0 lg:h-full lg:w-3/5 lg:bg-gradient-to-r"
        />

        <div className="relative grid min-h-[calc(100svh-8.5rem)] grid-rows-[auto_1fr_auto] px-4 pt-7 sm:px-10 sm:pt-10 lg:min-h-[36rem] lg:grid-cols-[1.1fr_0.9fr] lg:grid-rows-1 lg:items-end lg:gap-6">
          <div className="max-w-xl lg:self-center lg:pb-10">
            <h1
              id="poster-title"
              className="font-display text-[2.5rem] font-extrabold leading-display tracking-display sm:text-[4rem]"
            >
              Put money on yourself.
            </h1>
            <p className="mt-3 max-w-md text-base leading-snug text-foreground sm:mt-4 sm:text-xl">
              Stake test USDC on your own health goal. Your wearable decides,
              and SPOTTER pays when the run settles. Only the verdict goes on
              chain, never your health data.
            </p>
            <div className="mt-5 hidden lg:block">
              <LandingCta />
            </div>
          </div>

          <div className="relative flex min-h-0 items-end justify-center lg:justify-end">
            <div className="absolute left-0 top-3 z-10 hidden sm:block lg:left-auto lg:right-[62%] lg:top-10">
              <SpotterBubble line="Hand it over. I'll hold it until your wearable says otherwise." />
            </div>
            <Spotter
              pose="payday"
              size="hero"
              priority
              alt="SPOTTER holding up a gold coin, your stake"
              className="-mb-1 [&_img]:h-[min(34svh,20rem)] sm:[&_img]:h-[min(46svh,28rem)] lg:[&_img]:h-[32rem]"
            />
          </div>

          {/* pb-20 on a phone keeps the action clear of the floating helper
              button (HelperWidget, fixed bottom-right). */}
          <div className="-mx-4 border-t border-edge bg-background/95 px-4 pb-20 pt-4 backdrop-blur sm:-mx-10 sm:px-10 sm:pb-6 lg:hidden">
            <LandingCta />
          </div>
        </div>
      </section>

      <p className="-mt-8 max-w-2xl text-sm text-muted sm:-mt-12">
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
          On the riverbank right now
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
            className="inline-flex min-h-12 items-center justify-center rounded-[18px] border-2 border-foreground px-5 py-3 text-base font-bold text-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
