import type { Metadata } from "next";
import Link from "next/link";
import HeroActivityTicker from "@/components/HeroActivityTicker";
import SpotterSays from "@/components/SpotterSays";
import LandingCta from "@/components/game/LandingCta";
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

// The run, start to finish. A real sequence, so it is numbered.
function runSteps(human: boolean, confirm: boolean): { title: string; body: string }[] {
  return [
    {
      title: "Make your player",
      body: human
        ? "Sign in with an email, prove you are one human with World ID, pick a name, pair your wearable. Once."
        : "Sign in with an email, get your spot in the closed beta, pick a name, pair your wearable. Once.",
    },
    {
      title: "Pick a run and stake on yourself",
      body: "Sleep, steps, workouts. The lobby tells you which runs your sensor can actually measure before you put a cent down.",
    },
    {
      title: "Bank your nights",
      body: "Your sensor syncs, the board counts. 3 of 5 banked, tonight still counts, and you can see who else is still in.",
    },
    {
      title: "The Verdict",
      body: confirm
        ? "SPOTTER checks the data, asks you to confirm it is you with World ID, and pays in test USDC when the run settles. Miss it and there is no prize; your stake is credited back at settle."
        : "SPOTTER checks the data and pays in test USDC when the run settles. Miss it and there is no prize; your stake is credited back at settle.",
    },
  ];
}

export default function Home() {
  const { human, confirm } = deploymentCopy();
  const RUN = runSteps(human, confirm);
  return (
    <div className="flex flex-col gap-16 py-4 sm:py-10">
      <section className="grid gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
        <div className="space-y-6">
          <h1 className="font-display text-7xl font-black leading-[0.85] tracking-tight sm:text-8xl lg:text-9xl">
            A dare with your own money.
          </h1>
          <p className="max-w-xl text-xl leading-snug text-foreground/85">
            Stake on your own health goal. Your wearable decides. Hit it and
            SPOTTER pays you when the run settles. Miss it and you just get
            your stake back. Only the verdict goes on chain, never your health
            data.
          </p>
          <LandingCta />
          <p className="max-w-xl text-sm text-muted">
            In beta on Base Sepolia test USDC, built at ETHGlobal Tokyo 2026:
            nothing here can cost you real money. Not medical or financial
            advice.{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="underline hover:text-foreground">
              Terms
            </Link>
            .
          </p>
        </div>
        <div className="space-y-4">
          <SpotterSays
            surface="pools-header"
            state="idle"
            pose="point"
            size="md"
            say={
              confirm
                ? "I read the proof and make the call. You confirm it is you. Then I move the money."
                : "I read the proof, I make the call, I move the money."
            }
          />
          <HeroActivityTicker />
        </div>
      </section>

      <section aria-labelledby="how-a-run-goes" className="space-y-6">
        <h2 id="how-a-run-goes" className="font-display text-5xl font-black leading-none">
          How a run goes
        </h2>
        <ol className="divide-y-2 divide-foreground/10 border-y-2 border-foreground">
          {RUN.map((step, i) => (
            <li key={step.title} className="grid gap-2 py-5 sm:grid-cols-[5rem_1fr_2fr] sm:items-baseline sm:gap-6">
              <span className="font-display text-5xl font-black leading-none text-accent tabular-nums">
                {i + 1}
              </span>
              <h3 className="font-display text-3xl font-extrabold leading-tight">{step.title}</h3>
              <p className="text-base text-foreground/80">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 rounded-xl bg-board p-6 text-chalk sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div className="space-y-4">
          <h2 className="font-display text-4xl font-black leading-[0.95] sm:text-5xl">
            You cannot Venmo your grandma in another country to go for a walk.
          </h2>
          <p className="max-w-xl text-lg text-chalk/85">
            USDC can pay her when she does, with no bank and no border in the
            way. Dare a friend, back your parents, and the money lands when
            the sensor says it happened. Today it runs on test money while we
            build; real payouts are the road ahead, not a claim.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3">
          <Link
            href="/challenge/new"
            className="inline-flex min-h-12 items-center rounded-lg bg-gold px-5 font-display text-xl font-extrabold text-board hover:bg-gold-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-board"
          >
            Dare a friend
          </Link>
          <Link href="/feed" className="inline-flex min-h-11 items-center text-chalk underline underline-offset-4">
            See who got paid
          </Link>
          <Link href="/pools/create" className="inline-flex min-h-11 items-center text-chalk underline underline-offset-4">
            Put up a prize for someone else
          </Link>
        </div>
      </section>
    </div>
  );
}
