import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { openBeta } from "@/lib/open-beta";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The rules of the GoHealthMe V4 beta on testnet: test money, who can play, how a challenge pays out, no guarantees. A plain-language, pre-launch notice.",
  alternates: { canonical: "/terms" },
};

const LAST_UPDATED = "2026-09-26";
const CONTACT_EMAIL = "andre102599@gmail.com";

/**
 * Pre-counsel, testnet-only terms for V4. Every rule below matches the code:
 *   Commitment runs   lib/commitment.ts and HealthPoolsV3._settleCommitment
 *                     (bountyModel 2: equal stake, equal split among hitters,
 *                     nobody hits = every recorded stake refunded, fee only on
 *                     missed stakes via commitmentFeeBps, 0 on the Tokyo
 *                     deployment per DEPLOYMENTS.md; integer dust stays)
 *   Sponsored runs    components/CreatePool.tsx offers bountyModel 0 (fixed
 *                     bounty) and 1 (pro-rata split); a missed stake there
 *                     stays in the pool
 *   No verdict        HealthPoolsV3.settle pass 1 (B-2): an unadjudicated
 *                     stake is refunded to its owner
 *   Cancel / sweep    cancelPool + claimRefund (B-1); sweep() returns the
 *                     pool's remaining balance to the creator, offered in the
 *                     app by components/SweepLeftover.tsx
 *   Payouts           settle credits owed[]; the player claims with
 *                     withdraw() (components/ClaimPayout.tsx)
 *   One human         lib/server/world/require-human.ts, world/human.ts
 *   Confirmation      lib/server/agent/approval.ts (a run that settles
 *                     before the player confirms refunds the stake)
 *   Closed beta       lib/server/access.ts, lib/geo-blocklist.ts; off the
 *                     player's path when the open-beta switch is on
 *                     (lib/open-beta.ts), and the page says so
 * Voice: docs/DESIGN.md. Never bet, wager, odds or gamble in visible copy.
 */
export default function TermsPage() {
  // Read at render on the server; NEXT_PUBLIC_ is also inlined into the
  // browser bundle, so both agree after a redeploy.
  const open = openBeta();
  return (
    <div className="mx-auto w-full max-w-[46rem]">
      {/* REVIEW: counsel to add governing law, dispute resolution and a
          limitation-of-liability clause; none exist in these terms. */}
      <header className="[&>*+*]:mt-3">
        <Badge tone="muted">Beta, testnet</Badge>
        <h1 className="type-title text-[2.5rem] min-[900px]:text-[3.25rem]">Terms of Use</h1>
        <p className="max-w-[60ch] text-[1.0625rem] leading-[1.5] text-muted text-pretty">
          Last updated {LAST_UPDATED}. These are the plain-language rules for
          GoHealthMe V4, the beta built at ETHGlobal Tokyo 2026 on Base
          Sepolia test money. By using GoHealthMe you agree to them.
        </p>
      </header>

      <section
        aria-labelledby="terms-summary"
        className="relative mt-8 rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] px-4 py-[18px] text-[0.9375rem] leading-[1.6] shadow-card min-[960px]:p-6"
      >
        <h2 id="terms-summary" className="text-lg font-semibold leading-tight text-foreground">
          The short version
        </h2>
        <ul className="mt-3 list-disc pl-5 text-muted marker:text-haze [&>*+*]:mt-2.5 [&_strong]:font-semibold [&_strong]:text-foreground">
          <li>
            <strong>Test money only.</strong> Every USDC here is Base Sepolia
            test USDC with no monetary value. This is a beta, not a financial
            product.
          </li>
          <li>
            <strong>You put money on yourself.</strong> Everyone in a
            challenge stakes the same amount, and only your own verified effort
            decides your result.
          </li>
          <li>
            <strong>Hit the goal:</strong> your stake back plus an equal share
            of the missed stakes and any extra in the pot.{" "}
            <strong>Miss it:</strong> your stake goes to the players who hit,
            on a challenge that can record a miss; the challenge page says
            before you stake whether it can, and every other challenge refunds
            a miss.{" "}
            <strong>Nobody hits:</strong> everyone gets their stake back. V4
            takes no fee.
          </li>
          {open ? (
            <li>
              <strong>One human, one entry, if you choose it.</strong> World ID
              is optional during the beta, and you must be 18 or older.
            </li>
          ) : (
            <li>
              <strong>One human, one entry.</strong> You prove you are one human
              with World ID, and you must be 18 or older.
            </li>
          )}
          <li>
            <strong>Not advice, no guarantees.</strong> The app can be wrong or
            down, and we can reset the testnet at any time.
          </li>
        </ul>
      </section>

      <div className="mt-6 rounded-control bg-surface-raised p-4 text-[0.9375rem] leading-[1.55] text-muted shadow-[inset_0_0_0_1px_var(--border-strong)] [&_strong]:font-semibold [&_strong]:text-foreground">
        This is not legal advice, and it is not medical, health, financial,
        investment, or tax advice. It is an honest description of a testnet
        beta, not a finished legal agreement. Before any real-money launch it
        will be replaced by terms reviewed by a lawyer.
      </div>

      <div className="mt-10 text-base leading-[1.65] text-muted [&>*+*]:mt-10 [&_strong]:font-semibold [&_strong]:text-foreground">
        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Test money, no real value
          </h2>
          <p>
            GoHealthMe is built on Base Sepolia, a test network. Every USDC amount
            you see is test USDC with no monetary value, and the test ETH we
            may send your wallet for network fees has none either. Nothing here
            pays real money or costs real money, and no test token can be
            redeemed for anything. GoHealthMe is a beta, not a financial
            product, and nothing in it is an investment.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            This is not advice, and your health decisions are your own
          </h2>
          <p>
            Nothing in this app is medical, health, financial, investment, tax,
            or legal advice. The goals, verdicts, and payouts are part of a
            product beta, not guidance for your life. You are responsible for
            your own health decisions. Talk to a qualified professional - a
            doctor, a financial advisor, a lawyer - before acting on anything
            you see here. Do not push past what is safe for you to hit a goal.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">18 and over</h2>
          {/* REVIEW: nothing in the product checks age. World ID proves one
              human, not an age. Nikki to decide whether an age attestation
              belongs in character creation. */}
          <p>
            This beta is for adults. You must be at least 18 years old to use
            it.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            One human, one entry
          </h2>
          {open ? (
            <p>
              To play, you sign in (which creates a wallet). If you verify with
              World ID, one human is bound to one wallet and one wallet gets one
              entry per challenge. During the beta World ID is optional: a
              player who skips it still plays and is paid on the verdict alone.
            </p>
          ) : (
            <p>
              To play, you sign in (which creates a wallet) and prove you are one
              human with World ID. One human is bound to one wallet, and one
              wallet gets one entry per challenge. SPOTTER will not check a wallet, or
              settle a payout to it, until it has proven it is one human. On a build where World
              ID is off, the closed-beta list decides who can play instead.
            </p>
          )}
          {/* REVIEW: the closed-beta request form refuses residents of 14 US
              states (lib/geo-blocklist.ts), but a wallet approved through
              World ID never passes that check. Nikki and counsel to decide
              whether the World path needs the same geo gate. */}
          {/* REVIEW (2026-10-07): open-beta wording and the dropped US-state
              line are Nikki's to approve; the geo gate in lib/geo-blocklist.ts
              is no longer on any player path. */}
          {open ? (
            <p>
              Do not use another person&apos;s wallet or World ID, and do not
              try to enter a challenge twice.
            </p>
          ) : (
            <p>
              Some US states are not admitted to the closed beta, and the
              request form says so before you send it. Do not use another
              person&apos;s wallet or World ID, and do not try to enter a
              challenge twice.
            </p>
          )}
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            How a challenge pays out
          </h2>
          {/* REVIEW: the page avoids the words the design voice forbids. Counsel
              to decide whether the terms need an explicit statement on the
              legal classification of a self-staked commitment run. */}
          <p>
            A challenge is a commitment you make to your own health goal.
            Everyone in the challenge puts up the same stake. Your result
            depends only on your own verified effort, checked by your wearable
            or your document and decided by SPOTTER, never on chance and never
            on how anyone else does. When the challenge settles:
          </p>
          <ul className="list-disc pl-5 marker:text-haze [&>*+*]:mt-1.5">
            <li>
              If you hit the goal, you get your own stake back plus an equal
              share of the stakes of players whose miss was recorded and of
              any extra money in the pot.
            </li>
            <li>
              If you miss the goal, your stake goes to the players who hit it,
              on a challenge that can record a miss (see below). On every other
              challenge a miss is refunded.
            </li>
            <li>
              If nobody hits the goal, every stake is refunded in full.
            </li>
            <li>
              V4 takes no fee. The contract can take a fee from missed stakes
              only, and on V4 that fee is set to zero.
            </li>
          </ul>
          <p>
            Amounts are split in whole units of test USDC, so a tiny remainder
            can stay in the contract. Your payout is credited in the contract
            when the challenge settles, and you claim it to your wallet from the
            challenge page.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Staking on yourself: hit, miss, and no data
          </h2>
          <p>
            In a challenge where every player stakes on their own goal, the
            result decides where each stake goes when the challenge settles:
          </p>
          <ul className="list-disc pl-5 marker:text-haze [&>*+*]:mt-1.5">
            {open ? (
              <li>
                Hit the goal: you get your stake back plus an equal share of the
                missed stakes and anything else in the pot, once your hit is
                recorded. If you verified with World ID, SPOTTER records a hit
                only after you confirm it with World ID, and only before the
                challenge settles. If you did not, SPOTTER records your hit on
                your wearable&apos;s verdict, with no confirmation step.
              </li>
            ) : (
              <li>
                Hit the goal: you get your stake back plus an equal share of the
                missed stakes and anything else in the pot, once your hit is
                recorded. If you joined with World ID, SPOTTER records a hit
                only after you open the challenge and confirm it with World ID,
                and only before the challenge settles; a hit that is not
                confirmed by then gets its stake back without a share. If you
                were approved through the closed-beta list, SPOTTER records your
                hit on your wearable&apos;s verdict, with no confirmation step.
              </li>
            )}
            <li>
              Miss it, with your wearable showing the miss: your stake goes to
              the players who hit. This applies only on challenges that can
              record a miss: proven by wearable alone, measuring sleep or
              workouts, with a goal SPOTTER can read one way, and opened after
              this rule started. The challenge page says before you stake
              whether it can. On every other challenge a miss is refunded at
              settle.
            </li>
            <li>
              No wearable data for the challenge: SPOTTER records a miss only
              when your wearable synced every day of the challenge. If it did
              not, or the
              data provider could not be read, nothing is recorded and your
              stake comes back.
            </li>
            <li>Nobody hits: every player&apos;s stake comes back.</li>
            <li>
              The challenge&apos;s creator can cancel it any time before it
              settles, including after SPOTTER has recorded results. A
              cancelled challenge pays no share and every stake, a recorded
              miss included, can be claimed back.
            </li>
          </ul>
          <p>
            SPOTTER takes its last look a few hours after the challenge ends and then
            records a miss on its own. A late sync still counts until that last
            look. A missing result never counts as a miss.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            When SPOTTER cannot decide, or you do not confirm
          </h2>
          <p>
            If SPOTTER never records a result for you (for example the wearable
            or the verifier did not answer in time), your stake is refunded
            when the challenge settles. A missing result never counts as a miss.
          </p>
          {open ? (
            <p>
              If you verified with World ID, SPOTTER may ask you to confirm the
              payout with World ID before a win is paid. If you decline or let
              the window close, the win is not paid until you confirm. If the
              challenge settles before you confirm, your stake comes back to you
              as a refund, not as a win.
            </p>
          ) : (
            <p>
              Before a win is paid, SPOTTER may ask you to confirm the payout
              with World ID. If you decline or let the window close, the win is
              not paid until you confirm. If the challenge settles before you confirm,
              your stake comes back to you as a refund, not as a win.
            </p>
          )}
          <p>
            A cancelled challenge refunds every stake, and each player claims
            their refund from the challenge page.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Challenges with a friend, sponsors, and the leftover rule
          </h2>
          {/* REVIEW: sponsored runs made at /pools/create can use a fixed
              reward or a pro-rata split (bountyModel 0 or 1), where a missed
              stake stays in the pool and can be taken back by the creator.
              Nikki to confirm those models belong in the V4 beta at all. */}
          <p>
            In a challenge with a friend, you both stake the same amount. If
            one of you hits and the other&apos;s miss is recorded, the one who
            hit gets their stake back plus the other&apos;s stake. If you both
            hit, you both get your own stake back. If nobody hits, every stake
            is refunded.
          </p>
          <p>
            Anyone can add extra money to a challenge&apos;s pot: a sponsor, a
            friend backing you, or whoever started it. In a challenge where
            everyone stakes the same, that extra is shared equally among the
            players who hit the goal; if everyone hits, each gets their stake
            back plus an equal share of the extra. If nobody hits, the stakes
            are refunded and the extra stays in the contract for whoever
            started the challenge.
          </p>
          <p>
            Some sponsored challenges pay differently, and the challenge page
            names the payout before you join. A fixed-reward challenge pays each
            player who hits a set amount, and whatever it does not pay out,
            missed stakes included, stays in the contract. A split-the-pot
            challenge shares the whole pot among the players who hit, in
            proportion to their results. In either kind, if nobody hits, missed
            stakes stay in the contract; only a stake with no recorded result is
            refunded.
          </p>
          <p>
            Whatever is left in a challenge after it settles, including extra
            money nobody won and any missed stakes that stayed in the contract,
            can only be taken back by the person who created the challenge,
            through the
            contract&apos;s sweep. It is not split back to contributors. If you
            add to someone else&apos;s challenge, your contribution rewards the
            players who hit, and if nobody hits it belongs to the challenge&apos;s
            creator, not to you. On a cancelled challenge the creator can take back
            only what is left after every player has claimed their refund.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Provided as-is, with no guarantees
          </h2>
          <p>
            The app is provided as-is, with no warranty of any kind. It may be
            wrong, incomplete, or unavailable. Wearables, World ID, and the
            verifier can fail, be delayed, or reach the wrong result. Payouts
            are not guaranteed. Do not rely on this beta for anything that
            matters.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            We may change or end the beta at any time
          </h2>
          <p>
            This is an early beta. We may modify it, pause it, reset the
            testnet, or shut it down entirely at any time, without notice.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Privacy and public data
          </h2>
          <p>
            How we handle your data, and what becomes public and permanent
            on-chain (your wallet activity, challenge goal text, payouts, and any ENS
            name you pick), is described in our{" "}
            <Link href="/privacy" className="font-semibold text-foreground underline decoration-muted/40 underline-offset-4 hover:decoration-foreground">
              Privacy Policy
            </Link>
            . Please read it before you create or join a challenge.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">Contact</h2>
          <p>
            This beta is operated by Meowteam6. Questions go to{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-semibold text-foreground underline decoration-muted/40 underline-offset-4 hover:decoration-foreground"
            >
              {CONTACT_EMAIL}
            </a>{" "}
            (contact address to be confirmed).
          </p>
        </section>

        <section className="border-t border-edge pt-8 [&>*+*]:mt-3">
          <p className="text-[0.8125rem] text-haze">
            GoHealthMe V4 is a beta built at ETHGlobal Tokyo 2026 on Base
            Sepolia test money. These terms are not legal advice and will
            be replaced by lawyer-reviewed terms before any real-money launch.
          </p>
        </section>
      </div>
    </div>
  );
}
