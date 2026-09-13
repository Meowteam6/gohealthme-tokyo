import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What GoHealthMe collects, how it is used, and who processes it. A plain-language, pre-launch testnet notice.",
  alternates: { canonical: "/privacy" },
};

const EFFECTIVE_DATE = "2026-09-06";
const CONTACT_EMAIL = "andre102599@gmail.com";

/**
 * Pre-counsel, testnet-only privacy notice. Every statement here is written to
 * match what the app actually does (see lib/server/judge.ts for the TEE
 * boundary, lib/server/junction.ts for the wearable path, lib/server/help/ask.ts
 * for the Gemini call, and contracts/src/HealthPools.sol for the on-chain
 * goalSpec). Do not add claims the app cannot keep.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      <header className="space-y-3">
        <Badge tone="warning">Testnet demo</Badge>
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted">
          Effective {EFFECTIVE_DATE}. This is a pre-launch notice for a testnet
          demo, written in plain language so you know what happens to your data
          before you try the app.
        </p>
      </header>

      <div className="mt-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed text-foreground/90">
        This is not legal advice. It is an honest, good-faith description of a
        pre-launch testnet demo, not a finished legal policy. Before any
        real-money launch it will be replaced by a policy reviewed by a lawyer.
      </div>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-muted">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            This is a testnet demo
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
            Your handle is public on purpose
          </h2>
          <p>
            Claiming a handle is optional. If you do, your @handle, the emoji
            you pick, and your public page at /u/your-handle become visible to
            anyone. That page shows your verified wins and payouts, never the
            health category behind them. Handles are stored in our database
            (Supabase) and are public by design.
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
            The Ask helper sends your question to Google
          </h2>
          <p>
            When you type a question into the in-app helper, that question is
            sent to Google&apos;s Gemini model (via Vertex AI on Google Cloud)
            so it can answer questions about how the app works. Only the text
            you type is sent. We do not send your health data, your pool
            activity, or your wallet address.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Document proof is paused while we build the verifier
          </h2>
          <p>
            Uploading a document (a lab result, a flu-shot record, a screening
            result) currently ends with &quot;could not verify&quot;. Nothing is
            stored and nothing leaves our server. We are building a confidential
            verifier so the model can read the document without us seeing it;
            until it is live we will not claim it. If you joined a document pool
            and could not be verified, your stake is refunded automatically when
            the pool&apos;s period ends. The wearable path (Junction) works today
            and is described below.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Wearable data is handled differently, and we want to be straight
            about it
          </h2>
          <p>
            There are two ways to connect a device, and they differ in who holds
            what. Through Junction (WHOOP, Oura, Fitbit, or Garmin), Junction
            holds your connection and we hold only an API key. Connecting WHOOP
            directly instead means WHOOP gives us an access token for your
            account, which we store encrypted and use only to read the metric
            your pool is measured on. Either way, the health summary we pull to
            check a streak passes through our own server (hosted on Vercel)
            before we compute the result.
          </p>
          <p>
            If you connect WHOOP directly we ask for the narrowest access that
            can answer a goal: your sleep and your workouts, nothing else. You
            can disconnect at any time from your dashboard, which revokes our
            access at WHOOP and deletes the stored token. You can also revoke it
            yourself inside the WHOOP app.
          </p>
          <p>
            So today our server does see the wearable summary it uses to run the
            check. What is true without exception is that health data is never
            written to the blockchain - only SPOTTER&apos;s yes-or-no verdict is.
            If our server handling a summary matters to you, do not connect a
            wearable until the confidential verifier is live.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Some things are public and permanent by design
          </h2>
          <p>
            GoHealthMe settles on the Base Sepolia blockchain. Wallet addresses,
            pool activity, payouts, and the goal text you write when you create
            a pool are recorded on-chain. Blockchain records are public and, by
            their nature, permanent. We cannot edit or delete them. Do not put
            anything in a goal description that you would not want to be public
            forever.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Who processes your data
          </h2>
          <p>
            We rely on the following third parties to run the demo. Each is
            named so you can read their own policies:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Dynamic (a Fireblocks company) - email sign-in and embedded wallets</li>
            <li>Circle - the agent wallet and USDC settlement</li>
            <li>Supabase - our database (handles, challenge metadata, feedback)</li>
            <li>Google Cloud / Vertex AI - the Gemini model that answers helper questions</li>
            <li>Vercel - hosting for the app and its server</li>
            <li>
              Vercel Web Analytics - anonymous page-view and referrer counts so we
              can see where the pilot gets stuck. It sets no cookies and never
              receives your wallet address or health data.
            </li>
            <li>Base Sepolia - the public blockchain where pools settle</li>
            <li>Junction - wearable summaries, only if you connect a device through Junction</li>
            <li>
              WHOOP - sleep and workout summaries, only if you connect WHOOP
              directly. We hold an encrypted access token for your WHOOP account
              until you disconnect.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            How long we keep it
          </h2>
          <p>
            We keep off-chain data (handles, challenge metadata, feedback) until
            you ask us to delete it, or until we reset the testnet. Testnet data
            may be wiped at any time. On-chain data is permanent and outside our
            control to delete.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Contact</h2>
          <p>
            This demo is operated by Meowteam6. To ask a question or request
            deletion of your off-chain data, email{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-accent underline"
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
            <Link href="/terms" className="text-accent underline">
              Terms
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
