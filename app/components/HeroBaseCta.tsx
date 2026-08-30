"use client";

// The explicit "Sign in or create a wallet with Base" button for the PHONE hero.
// On desktop the header carries this button; below `sm` the header hides it to
// keep room for the nav toggle, so on a phone the Base Account path had no
// visible entry on the landing page at all. This surfaces it right under the
// SPOTTER card. Same connect handler as Header/SignInPanel (useBaseAccountConnect)
// - shown only when signed out, and only when Dynamic is configured.

import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useBaseAccountConnect } from "@/lib/useBaseAccountConnect";

function HeroBaseCtaInner() {
  const { ready, authenticated } = useEmbeddedWallet();
  const { connectBase, baseBusy } = useBaseAccountConnect();

  // Signed in (or auth still resolving) → the wallet already exists, so a
  // "create a wallet" CTA would be wrong. Render nothing.
  if (!ready || authenticated) return null;

  return (
    <div>
      <button
        type="button"
        disabled={baseBusy}
        aria-busy={baseBusy}
        onClick={() => {
          void connectBase();
        }}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-foreground/20 bg-surface px-4 py-3 text-base font-bold text-foreground shadow-[var(--shadow-pop-edge)] transition hover:-translate-y-0.5 hover:border-foreground/35 hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 rounded-[2px] bg-[#0000FF]"
        />
        {baseBusy ? "Opening Base..." : "Sign in or create a wallet with Base"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">
        Face or fingerprint - no seed phrase, nothing to install.
      </p>
    </div>
  );
}

export default function HeroBaseCta() {
  if (!DYNAMIC_CONFIGURED) return null;
  return <HeroBaseCtaInner />;
}
