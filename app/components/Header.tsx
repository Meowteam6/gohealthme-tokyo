"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEMO_CHROME, DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDisplayNames } from "@/lib/use-display-names";
import EnsName from "@/components/ens/EnsName";
import SpotterStatusLine from "@/components/game/SpotterStatusLine";
import TestUsdcChip from "@/components/TestUsdcChip";
import { CopyAddressButton } from "@/components/FundingHelp";
import { NAV_ITEMS, SIGNED_OUT_NAV_ITEMS, type NavItem } from "@/lib/nav";
import { BrandLockup, FOCUS_RING, buttonClasses } from "@/components/ui";

// The header (docs/DESIGN.md, Night Shift chrome). Transparent over the page,
// then an opaque night bar with a blur once scrolled, so nothing (SPOTTER, the
// moon) ever shows through it. No status strip: the only thing that may sit
// under the bar is SPOTTER's outage notice, and only while checks are paused.

function isActive(pathname: string, href: string): boolean {
  if (href.startsWith("/#")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  items,
  stacked = false,
  onNavigate,
}: {
  items: readonly NavItem[];
  stacked?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`${FOCUS_RING} ${
              stacked
                ? "flex min-h-12 items-center rounded-control px-4 text-base"
                : "inline-flex min-h-11 items-center whitespace-nowrap rounded-[10px] px-3 text-[0.9375rem]"
            } font-medium no-underline ${
              active
                ? "bg-fill-quiet-hover text-foreground"
                : "text-muted hover:bg-fill-quiet hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/** How long the header waits for the wallet SDK before offering Sign in
 *  anyway. A returning player's session usually resolves well inside this;
 *  past it, a skeleton that may never resolve is worse than a working link. */
const AUTH_SETTLE_MS = 2500;

function useSettled(ms: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return settled;
}

function AuthControls() {
  const pathname = usePathname();
  const { ready, authenticated, logout } = useEmbeddedWallet();
  const settled = useSettled(AUTH_SETTLE_MS);

  if (!ready && !settled) {
    return (
      <div
        aria-hidden="true"
        className="h-11 w-24 animate-pulse rounded-control bg-surface-raised motion-reduce:animate-none"
      />
    );
  }

  if (!ready || !authenticated) {
    // One way in. Character creation owns sign-in (email makes the wallet,
    // your own wallet is a quiet link inside it). A wallet SDK still loading
    // after AUTH_SETTLE_MS lands here too, so the header never shows a
    // placeholder forever; /character waits for the SDK itself.
    const next =
      pathname === "/character" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return (
      <Link
        href={`/character${next}`}
        className={buttonClasses({ variant: "secondary", size: "sm" })}
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
      className={buttonClasses({ variant: "secondary", size: "sm" })}
    >
      Sign out
    </button>
  );
}

/**
 * The signed-in player's name and address, with a copy button (funding the
 * wallet at the faucet starts by copying the address). Renders nothing signed
 * out.
 */
function WalletNote() {
  const { authenticated, address } = useEmbeddedWallet();
  // The ENS name leads; the off-chain @handle is its fallback, then the short
  // address. Disabled until a wallet exists, so it costs nothing signed out.
  const { handleFor } = useDisplayNames(address !== null ? [address] : []);

  if (!authenticated || address === null) return null;
  const handle = handleFor(address);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link
        href="/character"
        className={`inline-flex min-h-11 min-w-0 items-center truncate rounded-md text-sm font-semibold text-foreground no-underline hover:text-muted ${FOCUS_RING}`}
      >
        <EnsName address={address} fallback={handle !== null ? `@${handle}` : undefined} />
      </Link>
      <CopyAddressButton address={address} compact />
    </div>
  );
}

function AuthOrPill() {
  if (DYNAMIC_CONFIGURED) return <AuthControls />;
  if (DEMO_CHROME) return null;
  // Real unconfigured builds keep the honest pill; DEMO_CHROME is the
  // cosmetic-only recording flag (lib/config.ts).
  return (
    <span className="inline-flex h-11 items-center rounded-control bg-fill-quiet px-3 text-[0.8125rem] font-semibold text-haze shadow-[inset_0_0_0_1px_var(--border)]">
      Sign-in is off on this build
    </span>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
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
      {open ? (
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
  );
}

export interface HeaderViewProps {
  signedIn: boolean;
  /** Sign in, Sign out, or the honest "sign-in is off" pill. */
  auth: ReactNode;
  /** The signed-in player's name and address, beside the controls from 1180px. */
  wallet?: ReactNode;
  /** The foot of the signed-in menu: name, address, the test USDC chip. */
  menuFoot?: ReactNode;
  /** The live header sticks and reads the scroll; the state gallery's copy
   *  sits in the page and can start solid. */
  sticky?: boolean;
  solid?: boolean;
}

/**
 * The header from props, so the state gallery can render it signed in
 * without a wallet. Header (below) feeds it from the wallet hooks.
 *
 * Signed out, the header is the brand, two links from 640px up, and Sign in:
 * nothing to open on a phone. Signed in, five links do not fit beside the
 * account controls below 1024px, so they collapse into a menu that also
 * carries the wallet address and the test USDC chip. The menu is open FOR a
 * path, so navigating anywhere closes it without an effect.
 */
export function HeaderView({
  signedIn,
  auth,
  wallet,
  menuFoot,
  sticky = true,
  solid: forceSolid = false,
}: HeaderViewProps) {
  const pathname = usePathname();
  const items = signedIn ? NAV_ITEMS : SIGNED_OUT_NAV_ITEMS;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuOpen = signedIn && menuFor === pathname;
  const setMenuOpen = (open: boolean) => setMenuFor(open ? pathname : null);

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!sticky) return;
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sticky]);
  const solid = forceSolid || scrolled || menuOpen;

  return (
    <header
      className={`${sticky ? "sticky top-0" : "relative"} z-40 border-b transition-[background-color,border-color] duration-[160ms] ease-out ${
        solid
          ? "border-edge bg-[var(--header-scrolled)] backdrop-blur-[14px] backdrop-saturate-[1.2]"
          : "border-transparent"
      }`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && menuOpen) setMenuOpen(false);
      }}
    >
      <div className="mx-auto flex h-14 w-full max-w-[75rem] items-center gap-4 px-gutter min-[900px]:h-16">
        <BrandLockup />
        <nav
          aria-label="Main"
          className={`ml-auto hidden items-center gap-1 ${
            signedIn ? "min-[1024px]:flex" : "min-[640px]:flex"
          }`}
        >
          <NavLinks items={items} />
        </nav>
        <div className="ml-auto flex flex-none items-center gap-2 min-[640px]:ml-0">
          {signedIn && wallet !== undefined ? (
            <div className="hidden max-w-[14rem] min-[1180px]:block">{wallet}</div>
          ) : null}
          {auth}
          {signedIn ? (
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              className={`grid size-11 place-items-center rounded-control bg-fill-quiet text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] hover:bg-fill-quiet-hover min-[1024px]:hidden ${FOCUS_RING}`}
            >
              <MenuIcon open={menuOpen} />
            </button>
          ) : null}
        </div>
      </div>
      {menuOpen ? (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-edge min-[1024px]:hidden">
          <div className="mx-auto flex w-full max-w-[75rem] flex-col gap-1 px-gutter py-3">
            <NavLinks items={items} stacked onNavigate={() => setMenuOpen(false)} />
            {menuFoot !== undefined ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-edge px-1 pt-3">
                {menuFoot}
              </div>
            ) : null}
          </div>
        </nav>
      ) : null}
      <SpotterStatusLine outageOnly />
    </header>
  );
}

export default function Header() {
  const { authenticated } = useEmbeddedWallet();
  const signedIn = DYNAMIC_CONFIGURED && authenticated;
  return (
    <HeaderView
      signedIn={signedIn}
      auth={<AuthOrPill />}
      wallet={<WalletNote />}
      menuFoot={
        <>
          <WalletNote />
          <TestUsdcChip />
        </>
      }
    />
  );
}
