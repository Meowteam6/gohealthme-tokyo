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
import { Button } from "@/components/ui";
import Spotter from "@/components/spotter/Spotter";
import type { SpotterPose } from "@/lib/spotter-poses";
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

// Lives inside character creation's step 2, under the riverbank scene, so it
// is a left-aligned step body with SPOTTER at row size, not a second hero.
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-col gap-4">{children}</div>;
}

function Otter({ pose, alt }: { pose: SpotterPose; alt: string }) {
  return <Spotter pose={pose} size="xs" alt={alt} />;
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="break-words font-display text-[1.75rem] font-extrabold leading-display tracking-display">
      {children}
    </h2>
  );
}

const inputClass =
  "min-h-12 w-full rounded-2xl border-2 border-edge bg-surface px-4 py-3 text-base text-foreground placeholder:text-muted focus:border-foreground focus:outline-none";

const labelClass = "text-sm font-bold text-foreground";

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
        <div className="flex items-end gap-3">
          <Otter pose="watching" alt="SPOTTER keeping watch" />
          <Heading>You&apos;re on the list.</Heading>
        </div>
        <p className="text-base text-foreground/85">
          Andre reviews requests himself. Once you&apos;re approved this page
          turns into the app. No need to ask twice.
        </p>
        <p className="text-sm text-muted">Watching the door so you don&apos;t have to.</p>
      </Shell>
    );
  }

  if (status === "denied" && !reopen) {
    return (
      <Shell>
        <div className="flex items-end gap-3">
          <Otter pose="neutral" alt="SPOTTER, unimpressed" />
          <Heading>Not this round.</Heading>
        </div>
        <p className="text-base text-foreground/85">
          The beta is small on purpose. If you think this is a mistake, ask
          again with a line on how you know Andre or Nikki.
        </p>
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setError(null);
            setReopen(true);
          }}
        >
          Ask again
        </Button>
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
            "This just confirms it's really you. Nothing is charged.",
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
      <div className="flex items-end gap-3">
        <Otter pose="greet" alt="SPOTTER waving hello" />
        <Heading>Ask for a spot.</Heading>
      </div>
      <p className="text-base text-foreground/85">
        GoHealthMe is in a closed family-and-friends beta. Tell Andre who you
        are and he&apos;ll let you in. Base Sepolia test money, so nothing here
        can cost you anything.
      </p>
      <form onSubmit={submit} className="flex w-full flex-col gap-4 text-left">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>
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
          <span className={labelClass}>
            Email <span className="font-normal text-muted">(so Andre can reach you)</span>
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
          <span className={labelClass}>
            US state <span className="font-normal text-muted">(where you live)</span>
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
          <span className={labelClass}>
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
          <p role="alert" className="rounded-2xl border border-danger/40 bg-danger/5 p-3 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Sending your request" : "Ask for my spot"}
        </Button>
        <p className="text-sm text-muted">
          You sign once to prove the wallet is yours. Nothing is charged.
        </p>
      </form>
    </Shell>
  );
}
