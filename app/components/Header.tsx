"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEMO_CHROME, DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDisplayNames } from "@/lib/use-display-names";
import EnsName from "@/components/ens/EnsName";
import SpotterStatusLine from "@/components/game/SpotterStatusLine";
import TestUsdcChip from "@/components/TestUsdcChip";
import { CopyAddressButton } from "@/components/FundingHelp";
import { NAV_ITEMS } from "@/lib/nav";
import Spotter from "@/components/spotter/Spotter";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  stacked = false,
  onNavigate,
}: {
  stacked?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`${FOCUS} ${
              stacked
                ? "flex min-h-12 items-center rounded-2xl px-4 text-base"
                : "inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3.5"
            } font-bold ${
              active
                ? "bg-foreground text-background"
                : "text-foreground/75 hover:bg-surface-raised hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function AuthControls() {
  const pathname = usePathname();
  const { ready, authenticated, logout } = useEmbeddedWallet();

  if (!ready) {
    return (
      <div
        aria-hidden="true"
        className="h-11 w-24 animate-pulse rounded-[18px] bg-surface-raised motion-reduce:animate-none"
      />
    );
  }

  if (!authenticated) {
    // One way in. Character creation owns sign-in (email makes the wallet,
    // your own wallet is a quiet link inside it), so the header no longer
    // offers two competing buttons that each open a different flow.
    const next =
      pathname === "/character" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return (
      <Link
        href={`/character${next}`}
        className={`inline-flex min-h-11 items-center rounded-[18px] bg-accent px-4 text-sm font-bold text-foreground shadow-[0_3px_0_0_var(--accent-strong)] hover:bg-accent-hover active:translate-y-[3px] active:shadow-none motion-reduce:transition-none ${FOCUS}`}
      >
        Sign in
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        void logout();
      }}
      className={`min-h-11 rounded-[18px] border-2 border-foreground/20 px-3.5 py-2 text-sm font-bold text-foreground hover:border-foreground ${FOCUS}`}
    >
      Sign out
    </button>
  );
}

/**
 * Signed out this answers "what is this about to ask me for" before Dynamic's
 * modal takes over the screen. Signed in it carries the wallet address, which
 * is the first thing anyone needs: funding the wallet with test USDC at
 * the faucet starts by copying this.
 */
function WalletNote() {
  const { authenticated, address } = useEmbeddedWallet();
  // The ENS name leads; the off-chain @handle is its fallback, then the short
  // address. Disabled until a wallet exists, so it costs nothing signed out.
  const { handleFor } = useDisplayNames(address !== null ? [address] : []);

  if (!authenticated) {
    return (
      <p className="py-2 text-xs leading-relaxed text-muted">
        Sign in with an email and a wallet is made for you. No seed phrase.
      </p>
    );
  }

  if (address === null) return null;
  const handle = handleFor(address);

  return (
    <div className="flex items-center gap-2 py-1">
      <Link
        href="/character"
        className={`min-w-0 truncate rounded text-sm font-bold text-foreground hover:text-accent-deep ${FOCUS}`}
      >
        <EnsName
          address={address}
          fallback={handle !== null ? `@${handle}` : undefined}
        />
      </Link>
      <CopyAddressButton address={address} compact />
    </div>
  );
}

/**
 * The row under the header bar. It exists because the 64px bar cannot hold an
 * address, an explanation, and SPOTTER's balance at 375px without crushing the
 * nav to nothing. SPOTTER's wallet status is one line here on every screen
 * size, which replaced the out-of-budget wall on each pool. Vertical padding
 * sits on the children, so the row collapses to a hairline when every child
 * renders null.
 */
function HeaderNote() {
  return (
    <div className="border-t border-edge bg-surface/60">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 px-4">
        {DYNAMIC_CONFIGURED ? (
          <div className="flex flex-wrap items-center gap-x-3">
            <WalletNote />
            <TestUsdcChip />
          </div>
        ) : null}
        <div className="w-full sm:ml-auto sm:w-auto">
          <SpotterStatusLine />
        </div>
      </div>
    </div>
  );
}

function AuthOrPill() {
  if (DYNAMIC_CONFIGURED) return <AuthControls />;
  if (DEMO_CHROME) return null;
  // Real unconfigured builds keep the honest pill; DEMO_CHROME is the
  // cosmetic-only recording flag (lib/config.ts) and hiding operator chrome is
  // exactly its charter. The join panel's fail-closed refusal is untouched.
  return (
    <span className="rounded-full border border-edge bg-surface px-3 py-2 text-xs font-bold text-muted">
      Sign-in is off on this build
    </span>
  );
}

export default function Header() {
  // Mobile (375px) cannot fit wordmark + five links + auth on one row. Below
  // `sm` the links collapse into a tap-to-open menu (a hidden horizontal
  // scroll strip is undiscoverable on a phone and left Challenges/Wallet
  // unreachable); at `sm` and up the inline nav returns. The menu closes on
  // navigation (pathname effect) and on any link tap.
  // The menu is open FOR a path, so navigating anywhere closes it without an
  // effect that sets state after render.
  const pathname = usePathname();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuOpen = menuFor === pathname;
  const setMenuOpen = (open: boolean) => setMenuFor(open ? pathname : null);

  return (
    <header
      className="sticky top-0 z-40 border-b border-edge bg-background/90 backdrop-blur"
      onKeyDown={(e) => {
        if (e.key === "Escape" && menuOpen) setMenuOpen(false);
      }}
    >
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4 sm:gap-3">
        <Link
          href="/"
          aria-label="GoHealthMe home"
          className={`flex shrink-0 items-center gap-2 rounded-2xl pr-1 ${FOCUS}`}
        >
          <Spotter pose="portrait" size="row" decorative className="sm:hidden md:inline-flex" />
          <span className="font-display text-[1.375rem] font-extrabold tracking-display sm:text-2xl">
            GoHealthMe
          </span>
        </Link>
        {/* Desktop nav: inline, right-aligned, scrolls only if it must. */}
        <nav
          aria-label="Main"
          className="hidden min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] sm:block [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-1 py-1 text-sm sm:ml-auto">
            <NavLinks />
          </div>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:gap-2">
          <AuthOrPill />
          {/* Mobile menu toggle: only below `sm`, where the inline nav hides. */}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 border-foreground/20 text-foreground hover:border-foreground sm:hidden ${FOCUS}`}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {menuOpen ? (
                <>
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </>
              ) : (
                <>
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      {menuOpen ? (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="border-t border-edge bg-background sm:hidden"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-1 px-3 py-3">
            <NavLinks stacked onNavigate={() => setMenuOpen(false)} />
          </div>
        </nav>
      ) : null}
      <HeaderNote />
    </header>
  );
}
