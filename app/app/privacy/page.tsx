import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { openBeta } from "@/lib/open-beta";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What GoHealthMe collects, how it is used, and who processes it. A plain-language notice for the V4 beta on testnet.",
  alternates: { canonical: "/privacy" },
};

const LAST_UPDATED = "2026-09-26";
const CONTACT_EMAIL = "andre102599@gmail.com";

/**
 * Pre-counsel, testnet-only privacy notice for V4. Every statement here is
 * written to match what the app does today. Sources, by section:
 *   Sign-in        lib/server/access.ts (the sign-in email never reaches the
 *                  server; the access request stores name, email, reason and
 *                  US state), lib/geo-blocklist.ts. The request form and the
 *                  list are off the player's path when the open-beta switch
 *                  is on (lib/open-beta.ts), and the page says so
 *   World ID       lib/server/world/human.ts, nullifier.ts, verify.ts (the
 *                  proof is bound to the wallet address as its signal),
 *                  config.ts (action "prove-human"),
 *                  lib/server/agent/approval.ts (action "settle", signal
 *                  goalId:attempt, per-payout one-shot nullifier key)
 *   ENS names      lib/server/ens/claim.ts, write.ts, receipt.ts (four
 *                  gohealthme.settle.* text records), link.ts (own names
 *                  re-checked once the last check is an hour old),
 *                  human-gate.ts
 *   Gas drip       lib/server/gas-drip.ts, app/api/gas/drip/route.ts
 *   Screening      lib/server/screening/intercepta.ts (address only, 1h cache)
 *   Wearables      lib/server/junction.ts (wallet address is the Junction
 *                  client_user_id), lib/server/wearable/whoop.ts (scopes
 *                  read:sleep read:workout offline), tokens.ts (AES-256-GCM),
 *                  whoop-seats.ts, index.ts (only the paired provider is
 *                  stored), apple.ts (APPLE_APP_AVAILABLE), apple-store.ts,
 *                  app/api/cron/wearable-retention (daily, 120 days,
 *                  scheduled in vercel.json)
 *   History        app/api/agent/feed/route.ts, lib/server/agent/feed-view.ts
 *   Documents      app/api/evidence/submit/route.ts, lib/server/judge.ts
 *   Gemini         lib/server/help/ask.ts, lib/server/agent/reason.ts
 *   Feedback       supabase/migrations/20260926100100_feedback.sql
 *   Disconnect     components/DisconnectDeviceButton.tsx on /settings
 * Do not add claims the app cannot keep.
 */
export default function PrivacyPage() {
  // Read at render on the server, the same as app/terms/page.tsx, so the two
  // legal pages never disagree about whether World ID is optional.
  const open = openBeta();
  return (
    <div className="mx-auto w-full max-w-[46rem]">
      {/* REVIEW: Nikki and counsel to confirm this notice before any
          real-money launch, including whether US state health-data laws
          (for example Washington's My Health My Data Act) apply to the
          wearable summaries our server reads. */}
      <header className="[&>*+*]:mt-3">
        <Badge tone="muted">Beta, testnet</Badge>
        <h1 className="type-title text-[2.5rem] min-[900px]:text-[3.25rem]">Privacy Policy</h1>
        <p className="max-w-[60ch] text-[1.0625rem] leading-[1.5] text-muted text-pretty">
          Last updated {LAST_UPDATED}. This covers GoHealthMe V4, the beta
          built at ETHGlobal Tokyo 2026 on Base Sepolia test money. It says
          what happens to your data before you try the app.
        </p>
      </header>

      <section
        aria-labelledby="privacy-summary"
        className="relative mt-8 rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] px-4 py-[18px] text-[0.9375rem] leading-[1.6] shadow-card min-[960px]:p-6"
      >
        <h2 id="privacy-summary" className="text-lg font-semibold leading-tight text-foreground">
          The short version
        </h2>
        <ul className="mt-3 list-disc pl-5 text-muted marker:text-haze [&>*+*]:mt-2.5 [&_strong]:font-semibold [&_strong]:text-foreground">
          <li>
            <strong>Health data never goes on chain.</strong> Our server reads
            daily summaries from your wearable to check your goal; only
            SPOTTER&apos;s yes-or-no verdict is written to the blockchain.
          </li>
          <li>
            <strong>World ID tells us you are one human, not who you are.</strong>{" "}
            We keep a World nullifier bound to your wallet. No face, iris,
            name or email reaches us from World.
          </li>
          <li>
            <strong>Some things are public for good:</strong> your wallet
            address, the challenges you join, payouts, the goal text of a
            challenge, and any ENS name you pick.
          </li>
          <li>
            <strong>Apple Health daily totals are deleted after 120 days</strong>{" "}
            by a daily job. You can disconnect a wearable from Settings at any
            time.
          </li>
          <li>
            <strong>Test money only.</strong> Base Sepolia test USDC has no
            monetary value. Email us to delete your off-chain data.
          </li>
        </ul>
      </section>

      <div className="mt-6 rounded-control bg-surface-raised p-4 text-[0.9375rem] leading-[1.55] text-muted shadow-[inset_0_0_0_1px_var(--border-strong)] [&_strong]:font-semibold [&_strong]:text-foreground">
        This is not legal advice. It is an honest, good-faith description of a
        beta that uses test money only, not a finished legal policy. Before any
        real-money launch it will be replaced by a policy reviewed by a lawyer.
      </div>

      <div className="mt-10 text-base leading-[1.65] text-muted [&>*+*]:mt-10 [&_strong]:font-semibold [&_strong]:text-foreground">
        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            This is a testnet beta
          </h2>
          <p>
            GoHealthMe V4 is built on Base Sepolia, a test network. All USDC here
            is test USDC with no monetary value. Nothing on this site can pay
            you real money or cost you real money.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Signing in creates a wallet
          </h2>
          <p>
            When you sign in with your email, Dynamic (a Fireblocks company)
            creates an embedded wallet for you on Base. Dynamic holds your
            email; our server never receives it. What we see is your wallet
            address, and every record we keep about you is keyed to it.
          </p>
          {open ? null : (
            <p>
              If you ask to join the closed beta instead of proving you are
              human with World ID, the request form stores what you type: a
              name, an email, a reason, and your US state. We use it only to
              decide the request. Some US states are not admitted to the beta,
              and the form tells you so before you send it.
            </p>
          )}
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Proving you are one human (World ID)
          </h2>
          {open ? (
            <p>
              If you verify with World ID, you scan with the World App. The
              proof is tied to your wallet address, and we check it with
              World. World gives us a nullifier: a number that is unique to you
              inside GoHealthMe and means nothing anywhere else. We store that
              nullifier bound to your wallet address, the time you verified, and
              the kind of World credential that verified you (for example Orb or
              passport). We never get your name, your face, your iris data, or
              your email from World, and no biometric data reaches us. The
              binding is how we keep one human to one wallet and one entry per
              challenge. If you skip World ID, nothing is sent to World and we
              hold no binding for you.
            </p>
          ) : (
            <p>
              To play, you prove you are one human by scanning with the World
              App. The proof is tied to your wallet address, and we check it with
              World. World gives us a nullifier: a number that is unique to you
              inside GoHealthMe and means nothing anywhere else. We store that
              nullifier bound to your wallet address, the time you verified, and
              the kind of World credential that verified you (for example Orb or
              passport). We never get your name, your face, your iris data, or
              your email from World, and no biometric data reaches us. The
              binding is how we keep one human to one wallet and one entry per
              challenge, and one human to one GoHealthMe name.
            </p>
          )}
          <p>
            Before the settle pays a win, SPOTTER can ask you to confirm the
            payout with World ID. That proof is made for that one payout. We store
            whether you confirmed, declined, or let the window close, when,
            the nullifier, and the credential kind. The public History page
            shows only the state and the credential kind, never your identity.
          </p>
          {open ? (
            <p>
              On a test build the World step can be simulated. Then nothing is
              sent to World and no human is actually proven. During the beta
              World ID is optional; nobody is held on a list.
            </p>
          ) : (
            <p>
              On a test build the World step can be simulated. Then nothing is
              sent to World and no human is actually proven. On a build where
              World ID is off, the closed-beta list decides who can play, and we
              hold your wallet address on that list.
            </p>
          )}
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Your name is public on purpose
          </h2>
          <p>
            Picking a name is optional. The name you pick becomes a subname
            (for example yourname.gohealthme.eth) on Ethereum Sepolia that
            resolves to your wallet address. That record is on a public
            blockchain: anyone can look it up, and like every on-chain record
            it is permanent. We cannot delete it.
          </p>
          <p>
            You can link an ENS name you already own instead. We check that it
            resolves to your wallet, and check again whenever it is shown and
            the last check is more than an hour old. If it no longer points at
            your wallet, we drop the link.
          </p>
          <p>
            When SPOTTER settles a challenge, it writes a receipt on that
            challenge&apos;s ENS name: the settle transaction, when it happened, which agent
            wrote it, and how many people hit the goal. No player names and no
            health data.
          </p>
          <p>
            Your @handle, the glyph you pick, and your public page at
            /u/your-handle are visible to anyone. That page shows your wins and
            payouts, never the health goal behind them. Handles are stored in
            our database (Supabase).
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Test gas for your wallet
          </h2>
          <p>
            A new wallet holds no test ETH, so it cannot pay the network fee to
            join a challenge. When that happens, our treasury sends a small amount of
            Base Sepolia test ETH to your wallet address. To keep the drip
            fair we count drips per wallet address per day. Test ETH has no
            monetary value.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Payout wallets are screened
          </h2>
          <p>
            Before the settle pays a wallet, SPOTTER sends that wallet
            address, and nothing else, to Web3 Antivirus (through Intercepta) to check it
            against sanction, blacklist and scam data. We keep the answer for
            about an hour so a retry does not ask again. No health data, no
            goal, and no name is sent. A wallet that is flagged, or a check
            that does not answer, holds the payout.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            SPOTTER&apos;s receipts and History
          </h2>
          <p>
            SPOTTER keeps a private ledger for each claim: its verdict, a short
            reason (which can describe the result of your check, for example
            hours slept against the goal), the payout steps and the screening
            answer. That ledger is not public.
          </p>
          <p>
            The public History page shows a redacted view: the goal id, the
            decision (pay or no pay), payout amounts, transaction hashes, the
            screening result, and the World confirmation state. No reason
            text, no goal text and no health data. A goal id is derived from
            the challenge and your wallet address, which are already public on
            chain.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Challenges and feedback
          </h2>
          <p>
            If you create or accept a challenge, we store its metadata in
            Supabase: an invite token, the challenge&apos;s on-chain id, your wallet address, an
            optional handle for who the challenge is for, and an optional
            message. If you leave feedback, we store your rating, your message,
            the page you were on, and your wallet address if you were signed
            in. The feedback table holds no health data.
          </p>
          <p>
            One thing to be clear about: the health goal text of a challenge
            (for example, &quot;sleep 7 hours&quot;) is written on-chain in the
            challenge&apos;s goal description, not just in our database. See the
            on-chain section below.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            What goes to Google
          </h2>
          <p>
            When you type a question into the in-app helper, that question is
            sent to Google&apos;s Gemini model (via Vertex AI on Google Cloud)
            so it can answer questions about how the app works. Only the text
            you type is sent.
          </p>
          <p>
            When SPOTTER decides whether a claim should be paid, it can also ask Gemini
            to reason over the challenge&apos;s public goal text and the
            verifier&apos;s yes-or-no verdict. It never sends your wearable
            data, your document, or your wallet address.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Document proof
          </h2>
          <p>
            Some challenges are checked from an uploaded document or photo (a
            lab result, a flu-shot record). Those challenges only open on a
            build where
            the confidential verifier is switched on; otherwise the lobby shows
            them locked. When it is on, your file goes to the Chainlink
            Confidential AI Attester, which reads it inside a sealed enclave
            and returns a verdict. We do not keep the file, and it does not go
            to Gemini or to any other model. If you joined a document challenge
            and could not be verified, your stake is credited back when the
            challenge settles.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Wearable data, and what our server sees
          </h2>
          <p>
            We use daily summaries only, for the one metric your challenge measures
            (for example hours of sleep, sleep score, or steps). We never write
            health data to the blockchain. We store which wearable you paired,
            but not the readings we pull from Junction or WHOOP: our server
            (hosted on Vercel) reads the summary, checks the goal, and keeps
            SPOTTER&apos;s verdict.
          </p>
          <p>
            <strong className="text-foreground">Junction</strong> (WHOOP, Oura,
            Fitbit, Garmin and others). Junction holds your device connection.
            We give Junction your wallet address as the id for your account
            there, and hold one API key for our app.
          </p>
          <p>
            <strong className="text-foreground">WHOOP, connected directly.</strong>{" "}
            WHOOP gives us an access token for your account. We ask for the
            narrowest access that can answer a goal: your sleep and your
            workouts, nothing else. The token is stored encrypted (AES-256-GCM)
            and used only to read the metric your challenge measures. WHOOP limits
            how many people our app can connect while it is in review, so
            direct seats go first come, first served, and we keep a list of the
            wallet addresses holding a seat. When the seats are gone, WHOOP
            straps connect through Junction instead.
          </p>
          <p>
            <strong className="text-foreground">Apple Health</strong> is
            offered through the GoHealthMe iPhone app (TestFlight during the
            beta). The app adds up your day on the phone and sends us one
            total per day per metric, plus which days it read and your time
            zone offset so a missed day can be judged fairly. Individual
            readings, heart-rate samples, sleep stages and routes never leave
            your phone. Those daily totals are stored in our database
            (Supabase) against your wallet address, and a daily job deletes
            any total older than 120 days.
          </p>
          <p>
            You can disconnect a wearable at any time from{" "}
            <Link href="/settings" className="font-semibold text-foreground underline decoration-muted/40 underline-offset-4 hover:decoration-foreground">
              your Settings page, under Your wearable
            </Link>
            . For WHOOP that revokes our access at WHOOP and deletes the stored
            token. For a Junction device the page tells you where to unlink it,
            because Junction holds that link. You can also revoke WHOOP inside
            the WHOOP app. For Apple Health it deletes every daily total and
            covered day we hold; to stop the iPhone app from sending new ones,
            turn off GoHealthMe under Health access in your iPhone&apos;s
            Settings, or delete the app.
          </p>
          <p>
            So our server does see the wearable summary it uses for the
            check. If that matters to you, do not connect a wearable yet.
          </p>
          <p>
            In a challenge where you staked on yourself, SPOTTER also reads
            every player&apos;s wearable summary once after the challenge ends,
            a few hours
            after the last night, without you opening the app. That read is
            what lets it record a miss, and it only does so when your wearable
            synced every day of the challenge and shows the goal was not met. If the
            data is missing or partial, nothing is recorded and your stake
            comes back. The read is the same daily summary as above; only the
            yes-or-no result goes on chain.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Some things are public and permanent by design
          </h2>
          <p>
            GoHealthMe settles on the Base Sepolia blockchain and names players
            on Ethereum Sepolia. Wallet addresses, the challenges you join,
            payouts, ENS names and settlement receipts, and the goal text of
            every challenge are recorded on-chain. Blockchain records are public and, by their
            nature, permanent. We cannot edit or delete them. Do not put
            anything in a goal description or a name that you would not want
            to be public forever.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            Who processes your data
          </h2>
          <p>
            We rely on the following third parties to operate the beta. Each is
            named so you can read their own policies:
          </p>
          <ul className="list-disc pl-5 marker:text-haze [&>*+*]:mt-1.5">
            <li>Dynamic (a Fireblocks company) - email sign-in and embedded wallets</li>
            <li>World (Tools for Humanity) - proof that you are one human, and the payout confirmation</li>
            <li>ENS on Ethereum Sepolia - public player and challenge names, and settlement receipts</li>
            <li>Web3 Antivirus, through Intercepta - screening of payout wallet addresses</li>
            <li>Circle - SPOTTER&apos;s agent wallet</li>
            <li>Chainlink Confidential AI Attester - reads uploaded documents inside an enclave, when document proof is on</li>
            <li>
              Supabase - our database (handles, challenge metadata, feedback,
              and Apple Health daily totals from the iPhone app)
            </li>
            <li>
              Upstash - our key-value store (SPOTTER&apos;s ledger, World ID
              bindings and payout confirmations, linked ENS names, encrypted
              WHOOP tokens, the closed-beta list and requests)
            </li>
            <li>Google Cloud / Vertex AI - the Gemini model that answers helper questions and helps SPOTTER reason over a verdict</li>
            <li>Vercel - hosting for the app and its server</li>
            <li>
              Vercel Web Analytics - anonymous page-view and referrer counts so we
              can see where the beta gets stuck. It sets no cookies and never
              receives your wallet address or health data.
            </li>
            <li>Base Sepolia - the public test network where challenges settle</li>
            <li>Junction - wearable summaries, only if you connect a device through Junction</li>
            <li>WHOOP - sleep and workout summaries, only if you connect WHOOP directly</li>
            <li>Apple Health - daily totals, only through our iPhone app</li>
          </ul>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">
            How long we keep it
          </h2>
          {/* REVIEW: no automated deletion exists for anything except Apple
              Health daily totals (120 days). Nikki to confirm the retention
              promise for the key-value store (World bindings, SPOTTER's
              ledger, access requests, WHOOP tokens) and Supabase tables. */}
          <p>
            Apple Health daily totals are deleted automatically after 120 days.
            Other off-chain data (handles, challenge metadata, feedback, access
            requests, World ID bindings and payout confirmations, linked names,
            SPOTTER&apos;s ledger) is kept until you ask us to delete it, or
            until we reset the testnet. A WHOOP token is deleted when you
            disconnect. Testnet data may be wiped at any time. On-chain data,
            including ENS names, is permanent and outside our control to
            delete.
          </p>
        </section>

        <section className="[&>*+*]:mt-3">
          <h2 className="type-heading text-[1.5rem] leading-tight text-foreground">Contact</h2>
          {/* REVIEW: the contact address is a personal inbox placeholder.
              Confirm the operator entity (Meowteam6 vs Chuabio Labs) and a
              team address before launch. */}
          <p>
            This beta is operated by Meowteam6. To ask a question or request
            deletion of your off-chain data, email{" "}
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
            Sepolia test money. This notice is not legal advice and will
            be replaced by a lawyer-reviewed policy before any real-money
            launch. See also our{" "}
            <Link href="/terms" className="font-semibold text-foreground underline decoration-muted/40 underline-offset-4 hover:decoration-foreground">
              Terms
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
