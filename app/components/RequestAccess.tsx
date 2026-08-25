"use client";

// The request-access flow for a signed-in but unapproved wallet. Three states,
// driven by the caller's `status`:
//   none     — the request form (name / email / reason / US state), submitted
//              with a wallet signature that proves the caller owns the address.
//   pending  — on the list, waiting for the admin.
//   denied   — an honest "not this time", with the door left open to ask again.
//
// SPOTTER's voice is deadpan and never over-promises: this is about a spot in
// the beta, not a verified win, so nothing here borrows the trust language the
// payout surfaces use.
//
// GEO COMPLIANCE. The self-staked pilot is not offered in every US state (see
// lib/geo-blocklist.ts). The form collects a canonical two-letter state code
// from a fixed list — never free text, so nothing silently fails open — and
// pre-checks stateBlockReason before POSTing: a blocked state is shown the
// honest reason and the request is never sent. This is convenience; the server
// (requestAccess) is the authoritative gate and refuses the same request there.

import { useState } from "react";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { fetchWithWalletAuth, authBlockReason } from "@/lib/client-auth";
import { TAP_TARGET } from "@/components/ui";
import { stateBlockReason } from "@/lib/geo-blocklist";
import type { AccessStatus } from "@/lib/useAccess";

// The 50 states plus DC, as { code, name }. A fixed list means the value sent to
// the server is always a canonical USPS code, which is what the blocklist needs
// to avoid the fail-open a misspelled free-text state would cause.
const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-6 py-10 text-center">
      {children}
    </div>
  );
}

function Otter({ pose, alt }: { pose: string; alt: string }) {
  return (
    <div className="relative w-full max-w-xs">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-6 -z-10 rounded-full bg-accent/20 blur-3xl"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/spotter/${pose}`}
        alt={alt}
        className="mx-auto aspect-square w-56 rounded-3xl border border-edge bg-surface object-cover shadow-sm"
      />
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-edge bg-surface px-4 py-3 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

export default function RequestAccess({
  status,
  onSubmitted,
}: {
  status: AccessStatus;
  onSubmitted: () => void;
}) {
  const { address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A denied user who taps "Ask again" reopens the form without leaving the page.
  const [reopen, setReopen] = useState(false);

  if (status === "pending") {
    return (
      <Shell>
        <Otter pose="spotter-watching.png" alt="SPOTTER the otter keeping watch" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            You&apos;re on the list.
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-muted">
            Andre reviews requests himself. Once you&apos;re approved this page
            turns into the app — no need to ask twice.
          </p>
        </div>
        <p className="text-sm text-muted">Watching the door so you don&apos;t have to.</p>
      </Shell>
    );
  }

  if (status === "denied" && !reopen) {
    return (
      <Shell>
        <Otter pose="spotter-neutral.png" alt="SPOTTER the otter, unimpressed" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Not this round.</h1>
          <p className="mx-auto mt-3 max-w-sm text-muted">
            The beta is small on purpose. If you think this is a mistake, ask
            again with a line on how you know Andre or Nikki.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setReopen(true);
          }}
          className={`rounded-xl border border-edge bg-surface font-semibold text-foreground hover:bg-surface-raised ${TAP_TARGET}`}
        >
          Ask again
        </button>
      </Shell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (address === null) {
      setError("Connect your wallet first.");
      return;
    }
    // A state must be picked: the server geo gate reads it, and an empty value
    // would fail open. Require a choice rather than sending a blank.
    if (state === "") {
      setError("Pick your US state so we can confirm the pilot is available there.");
      return;
    }
    // Client-side geo pre-check: block a restricted state with the honest reason
    // BEFORE spending a signature. The server refuses the same request too.
    const geoBlock = stateBlockReason(state);
    if (geoBlock !== null) {
      setError(geoBlock);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { response, auth } = await fetchWithWalletAuth(
        "/api/access/request",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address, name, email, reason, state }),
        },
        requestAuth,
      );
      if (auth.kind !== "ok") {
        setError(
          authBlockReason(auth) ??
            "This just confirms it's really you — nothing is charged.",
        );
        return;
      }
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(detail?.error ?? "Could not send your request. Try again.");
        return;
      }
      onSubmitted();
    } catch {
      setError("Could not send your request. Check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <Otter pose="spotter-greet.png" alt="SPOTTER the otter waving hello" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ask for a spot.</h1>
        <p className="mx-auto mt-3 max-w-sm text-muted">
          GoHealthMe is in a closed family-and-friends beta. Tell Andre who you
          are and he&apos;ll let you in. Play-money testnet — nothing here can
          cost you anything.
        </p>
      </div>
      <form onSubmit={submit} className="flex w-full flex-col gap-3 text-left">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Your name
          </span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane from the group chat"
            maxLength={80}
            autoComplete="name"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Email <span className="normal-case text-muted/70">(so Andre can reach you)</span>
          </span>
          <input
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            type="email"
            maxLength={160}
            autoComplete="email"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            US state <span className="normal-case text-muted/70">(where you live)</span>
          </span>
          <select
            className={inputClass}
            value={state}
            onChange={(e) => setState(e.target.value)}
            autoComplete="address-level1"
          >
            <option value="">Select your state…</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            The self-staked pilot is not yet available in every state. We check
            this so nobody stakes where they cannot.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            How do you know Andre or Nikki?
          </span>
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="We went to school together / Nikki invited me / …"
            maxLength={500}
          />
        </label>
        {error !== null ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className={`rounded-xl border border-accent/40 bg-accent/10 font-semibold text-accent-strong hover:bg-accent/15 disabled:opacity-60 ${TAP_TARGET}`}
        >
          {submitting ? "Sending…" : "Request access"}
        </button>
        <p className="text-center text-xs text-muted">
          This just confirms it&apos;s really you — nothing is charged.
        </p>
      </form>
    </Shell>
  );
}
