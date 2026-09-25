import type { Metadata } from "next";
import Link from "next/link";
import HeroActivityTicker from "@/components/HeroActivityTicker";
import SpotterSays from "@/components/SpotterSays";
import LandingCta from "@/components/game/LandingCta";

// Title, description and share card come from the root layout. The landing
// only pins its canonical so tracking or deploy query strings collapse to /.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// The run, start to finish. A real sequence, so it is numbered.
const RUN: { title: string; body: string }[] = [
  {
    title: "Make your player",
    body: "Sign in with an email, prove you are one human, pick a name, pair your wearable. Once.",
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
    body: "SPOTTER checks the data, asks you to confirm it is you, and pays in USDC the second it clears. Miss it and the run pays nothing.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-16 py-4 sm:py-10">
      <section className="grid gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
        <div className="space-y-6">
          <h1 className="font-display text-7xl font-black leading-[0.85] tracking-tight sm:text-8xl lg:text-9xl">
            A dare with your own money.
          </h1>
          <p className="max-w-xl text-xl leading-snug text-foreground/85">
            Stake on your own health goal. Your wearable decides. SPOTTER pays
            you the second it checks out, or it does not. Nobody ever sees your
            health data, only the verdict goes on chain.
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
            say="I buy the proof, I make the call, I move the money. No human in the loop."
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
            USDC can pay her the second she does, with no bank and no border in
            the way. Dare a friend, back your parents, and the money lands when
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
