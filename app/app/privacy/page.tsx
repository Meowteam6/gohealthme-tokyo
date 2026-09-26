import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What GoHealthMe collects, how it is used, and who processes it. A plain-language notice for the testnet beta.",
  alternates: { canonical: "/privacy" },
};

const EFFECTIVE_DATE = "2026-09-26";
const CONTACT_EMAIL = "andre102599@gmail.com";

/**
 * Pre-counsel, testnet-only privacy notice. Every statement here is written to
 * match what the app actually does. Sources, by section:
 *   World ID       lib/server/world/human.ts (what the binding stores),
 *                  lib/server/agent/approval*.ts (the payout confirmation)
 *   ENS names      lib/server/ens/claim.ts, lib/server/ens/write.ts
 *   Screening      lib/server/screening/intercepta.ts (address only, 1h cache)
 *   Wearables      lib/server/junction.ts, lib/server/wearable/*,
 *                  lib/server/wearable/apple-store.ts and the wearable_days
 *                  migration (daily totals; the 120-day sweep function exists
 *                  but nothing schedules it, so the copy does not promise it)
 *   Documents      app/api/evidence/submit/route.ts (bytes go to the attester
 *                  only), lib/server/proof-status.ts (on or off per build)
 *   Gemini         lib/server/help/ask.ts, lib/server/agent/reason.ts
 *   Disconnect     components/DisconnectDeviceButton.tsx on /settings
 * Do not add claims the app cannot keep.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <header className="space-y-3">
        <Badge tone="warning">Beta, testnet</Badge>
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted">
          Effective {EFFECTIVE_DATE}. This is a plain-language notice for the
          GoHealthMe beta on testnet, so you know what happens to your data
          before you try the app.
        </p>
      </header>

      <div className="mt-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed text-foreground/90">
        This is not legal advice. It is an honest, good-faith description of a
        beta that runs on test money, not a finished legal policy. Before any
        real-money launch it will be replaced by a policy reviewed by a lawyer.
      </div>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-muted">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            This is a testnet beta
          </h2>
          <p>
            GoHealthMe runs on Base Sepolia. All USDC here is test USDC with
            no real monetary value. Nothing on this site can pay you real money
            or cost you real money.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Signing in creates a wallet
          </h2>
          <p>
            When you sign in with your email, Dynamic (a Fireblocks company)
            creates an embedded wallet for you on Base. From that step we hold
            your email address and your wallet address.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Proving you are one human (World ID)
          </h2>
          <p>
            When a build asks you to prove you are one human, you scan with the
            World App. World gives us a nullifier: a number that is unique to
            you inside GoHealthMe and means nothing anywhere else. We store that
            nullifier bound to your wallet address, the time you verified, and
            the kind of check it was. We never get your name, your face, your
            iris data, or your email from World. The binding is how we keep one
            human to one wallet and one entry per run.
          </p>
          <p>
            Before SPOTTER records a win, a build may ask you to confirm the
            payout with World ID. We store whether you confirmed, declined, or
            let the window close, and when. The public History page shows that
            state next to the claim, never your identity.
          </p>
          <p>
            On a build where World ID is off, the closed-beta list decides who
            can play instead, and we hold your wallet address on that list.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Your name is public on purpose
          </h2>
          <p>
            Picking a name is optional. On a build with ENS names on, the name
            you pick becomes a subname (for example yourname.gohealthme.eth) on
            Ethereum Sepolia, pointing at your wallet address. That record is
            on a public blockchain: anyone can look it up, and like every
            on-chain record it is permanent. We cannot delete it. SPOTTER also
            writes a settlement receipt on ENS for each pool (how many people
            hit the goal and the payout transaction), with no names and no
            health data.
          </p>
          <p>
            Otherwise the name is an @handle. Your @handle, the glyph you pick,
            and your public page at /u/your-handle are visible to anyone. That
            page shows your wins and payouts, never the health goal behind
            them. Handles are stored in our database (Supabase).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Payout wallets are screened
          </h2>
          <p>
            Before SPOTTER pays a wallet, it sends that wallet address, and
            nothing else, to Web3 Antivirus (through Intercepta) to check it
            against sanction, blacklist and scam data. We keep the answer for
            about an hour so a retry does not ask again. No health data, no
            goal, and no name is sent. A wallet that is flagged, or a check
            that does not answer, holds the payout.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Challenges and feedback
          </h2>
          <p>
            If you create or accept a challenge, we store its metadata in
            Supabase: an invite token, the pool id, an optional label for who
            the challenge is for, and an optional message. If you leave
            feedback, we store your rating and your message.
          </p>
          <p>
            One thing to be clear about: the health goal text you write when you
            create a pool or a challenge (for example, &quot;lose 10 lbs&quot;)
            is written on-chain in the pool&apos;s goal description, not just in
            our database. See the on-chain section below.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            What goes to Google
          </h2>
          <p>
            When you type a question into the in-app helper, that question is
            sent to Google&apos;s Gemini model (via Vertex AI on Google Cloud)
            so it can answer questions about how the app works. Only the text
            you type is sent.
          </p>
          <p>
            When SPOTTER decides whether to pay a claim, it can also ask Gemini
            to reason over the pool&apos;s public goal text and the
            verifier&apos;s yes-or-no verdict. It never sends your wearable
            data, your document, or your wallet address.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Document proof
          </h2>
          <p>
            Some runs are checked from an uploaded document (a lab result, a
            flu-shot record). Those runs only open on a build where the
            confidential verifier is switched on; otherwise the lobby shows
            them locked. When it is on, your file goes to the Chainlink
            Confidential AI Attester, which reads it inside a sealed enclave
            and returns a verdict. The file does not go to Gemini or to any
            other model. If you joined a document run and could not be
            verified, your stake is credited back when the run settles.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Wearable data is handled differently, and we want to be straight
            about it
          </h2>
          <p>
            There are three ways to connect a device, and they differ in who
            holds what. Through Junction (WHOOP, Oura, Fitbit, or Garmin),
            Junction holds your connection and we hold only an API key.
            Connecting WHOOP directly instead means WHOOP gives us an access
            token for your account, which we store encrypted and use only to
            read the metric your run is measured on. Either way, the health
            summary we pull to check a streak passes through our own server
            (hosted on Vercel) before we compute the result.
          </p>
          <p>
            With Apple Health, our iPhone app adds up your day on the phone and
            sends us one total per day per metric (for example steps, or hours
            of sleep). Individual readings, heart-rate samples and routes never
            leave your phone. Those daily totals are stored in our database
            (Supabase) against your wallet address. No run needs a total older
            than 120 days; deleting older totals automatically is not switched
            on yet, so until it is, ask us and we delete yours.
          </p>
          <p>
            If you connect WHOOP directly we ask for the narrowest access that
            can answer a goal: your sleep and your workouts, nothing else.
          </p>
          <p>
            You can disconnect a device at any time from{" "}
            <Link href="/settings" className="text-accent-deep underline">
              your Settings page, under Your wearable
            </Link>
            . For WHOOP that revokes our access at WHOOP and deletes the stored
            token. For a Junction device the page tells you where to unlink it,
            because Junction holds that link. You can also revoke WHOOP inside
            the WHOOP app.
          </p>
          <p>
            So today our server does see the wearable summary it uses to run the
            check. What is true without exception is that health data is never
            written to the blockchain; only SPOTTER&apos;s yes-or-no verdict
            is. If our server handling a summary matters to you, do not connect
            a wearable yet.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Some things are public and permanent by design
          </h2>
          <p>
            GoHealthMe settles on the Base Sepolia blockchain and names players
            on Ethereum Sepolia. Wallet addresses, pool activity, payouts, ENS
            names, and the goal text you write when you create a pool are
            recorded on-chain. Blockchain records are public and, by their
            nature, permanent. We cannot edit or delete them. Do not put
            anything in a goal description or a name that you would not want
            to be public forever.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Who processes your data
          </h2>
          <p>
            We rely on the following third parties to run the beta. Each is
            named so you can read their own policies:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Dynamic (a Fireblocks company) - email sign-in and embedded wallets</li>
            <li>World (Tools for Humanity) - proof that you are one human, and the payout confirmation</li>
            <li>ENS on Ethereum Sepolia - public player and pool names</li>
            <li>Web3 Antivirus, through Intercepta - screening of payout wallet addresses</li>
            <li>Circle - the agent wallet and USDC settlement</li>
            <li>Chainlink Confidential AI Attester - reads uploaded documents inside an enclave, when document proof is on</li>
            <li>
              Supabase - our database (handles, challenge metadata, feedback,
              and Apple Health daily totals if you use the iPhone app)
            </li>
            <li>Upstash - our key-value store (SPOTTER&apos;s claim ledger, World ID bindings, the closed-beta list)</li>
            <li>Google Cloud / Vertex AI - the Gemini model that answers helper questions and helps SPOTTER reason over a verdict</li>
            <li>Vercel - hosting for the app and its server</li>
            <li>
              Vercel Web Analytics - anonymous page-view and referrer counts so we
              can see where the beta gets stuck. It sets no cookies and never
              receives your wallet address or health data.
            </li>
            <li>Base Sepolia - the public blockchain where pools settle</li>
            <li>Junction - wearable summaries, only if you connect a device through Junction</li>
            <li>
              WHOOP - sleep and workout summaries, only if you connect WHOOP
              directly. We hold an encrypted access token for your WHOOP account
              until you disconnect.
            </li>
            <li>Apple Health - daily totals, only if you connect through our iPhone app</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            How long we keep it
          </h2>
          <p>
            Off-chain data (handles, challenge metadata, feedback, Apple Health
            daily totals, World ID bindings, SPOTTER&apos;s claim ledger) is
            kept until you ask us to delete it, or until we reset the testnet. Testnet data may be wiped
            at any time. On-chain data, including ENS names, is permanent and
            outside our control to delete.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Contact</h2>
          <p>
            This beta is operated by Meowteam6. To ask a question or request
            deletion of your off-chain data, email{" "}
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
            replaced by a lawyer-reviewed policy before any real-money launch.
            See also our{" "}
            <Link href="/terms" className="text-accent-deep underline">
              Terms
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
