import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The rules of the GoHealthMe testnet beta: play-money, not advice, no guarantees. A plain-language, pre-launch notice.",
  alternates: { canonical: "/terms" },
};

const EFFECTIVE_DATE = "2026-09-26";
const CONTACT_EMAIL = "andre102599@gmail.com";

/**
 * Pre-counsel, testnet-only terms. The sweep rule below matches the contract:
 * HealthPools.sol sweep(poolId) returns the whole remaining pot to the pool
 * creator, not pro-rata to contributors. Keep every claim true to the app.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <header className="space-y-3">
        <Badge tone="warning">Beta, testnet</Badge>
        <h1 className="text-3xl font-bold tracking-tight">Terms of Use</h1>
        <p className="text-sm text-muted">
          Effective {EFFECTIVE_DATE}. These are the plain-language rules for
          trying a pre-launch testnet beta. By using GoHealthMe you agree to
          them.
        </p>
      </header>

      <div className="mt-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed text-foreground/90">
        This is not legal advice, and it is not medical, health, financial,
        investment, or tax advice. It is an honest description of a testnet beta,
        not a finished legal agreement. Before any real-money launch it will be
        replaced by terms reviewed by a lawyer.
      </div>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-muted">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Play money, no real value
          </h2>
          <p>
            GoHealthMe runs on Base Sepolia. Every USDC amount you see is
            test USDC with no real monetary value. Nothing here pays real money
            or costs real money, and no test token can be redeemed for anything.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            This is not advice, and your health decisions are your own
          </h2>
          <p>
            Nothing in this app is medical, health, financial, investment, tax,
            or legal advice. The goals, verdicts, and payouts are part of a
            product beta, not guidance for your life. You are responsible for
            your own health decisions. Talk to a qualified professional - a
            doctor, a financial advisor, a lawyer - before acting on anything
            you see here.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">18 and over</h2>
          <p>
            This beta is for adults. You must be at least 18 years old to use
            it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Provided as-is, with no guarantees
          </h2>
          <p>
            The app is provided as-is, with no warranty of any kind. It may be
            wrong, incomplete, or unavailable. Verification can fail, be
            delayed, or reach the wrong result. Payouts are not guaranteed. Do
            not rely on this beta for anything that matters.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            What this is: a reward, not a bet
          </h2>
          <p>
            GoHealthMe is a reward and commitment product. You, or a sponsor,
            put up USDC to reward hitting a health goal. If the goal is
            verified, the reward is released to the person who hit it. You are
            not betting against a house, and you are not wagering on an
            uncertain event for a chance to win a stranger&apos;s stake. This is
            a commitment reward, not gambling.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Challenges and the sweep rule
          </h2>
          <p>
            When you create a challenge, you fund the pot. If the person you
            challenged hits the goal, they collect the pot when the run
            settles. If they miss it, the entire remaining pot, including
            anything other people contributed, can only be taken back by you,
            the challenge creator, through the contract&apos;s sweep. It is not
            split back to contributors pro-rata, and it does not move on its
            own: until the app offers the sweep as a button, it stays in the
            pool.
          </p>
          <p>
            Anyone who chips into someone else&apos;s challenge should
            understand this before contributing: you are adding to a reward for
            the person taking the goal, not placing a refundable bet. If they
            miss, your contribution belongs to the challenge creator, not to
            you.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            We may change or end the beta at any time
          </h2>
          <p>
            This is an early beta. We may modify it, pause it, reset the
            testnet, or shut it down entirely at any time, without notice.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Privacy and public data
          </h2>
          <p>
            How we handle your data, and what becomes public and permanent
            on-chain, is described in our{" "}
            <Link href="/privacy" className="text-accent-deep underline">
              Privacy Policy
            </Link>
            . Please read it before you create a pool or a challenge.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Contact</h2>
          <p>
            This beta is operated by Meowteam6. Questions go to{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-accent-deep underline"
            >
              {CONTACT_EMAIL}
            </a>{" "}
            (contact address to be confirmed).
          </p>
        </section>

        <section className="space-y-3 border-t border-edge pt-8">
          <p className="text-xs text-muted">
            This is a pre-launch testnet notice, not legal advice, and will be
            replaced by lawyer-reviewed terms before any real-money launch.
          </p>
        </section>
      </div>
    </div>
  );
}
