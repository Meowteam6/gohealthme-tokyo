"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEMO_CHROME, DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDisplayNames } from "@/lib/use-display-names";
import { useEnsName } from "@/components/ens/EnsName";
import { shortAddress } from "@/lib/ens/names";
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

/** Signed out: Sign in, after a short wait for a returning session. */
function AuthControls() {
  const pathname = usePathname();
  const { ready } = useEmbeddedWallet();
  const settled = useSettled(AUTH_SETTLE_MS);

  if (!ready && !settled) {
    return (
      <div
        aria-hidden="true"
        className="h-11 w-24 animate-pulse rounded-control bg-surface-raised motion-reduce:animate-none"
      />
    );
  }

  // One way in. Character creation owns sign-in (email makes the wallet, your
  // own wallet is a quiet link inside it). A wallet SDK still loading after
  // AUTH_SETTLE_MS lands here too, so the header never shows a placeholder
  // forever; /character waits for the SDK itself.
  const next = pathname === "/character" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return (
    <Link href={`/character${next}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
      Sign in
    </Link>
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

/** Who is signed in, as the header shows it. */
export interface HeaderAccount {
  /** The full name: the ENS name, else the @handle, else the short address. */
  name: string;
  /** The avatar's letter, or null when the name is an address. */
  initial: string | null;
  /** The wallet address, for the copy button; null until the wallet exists. */
  address: string | null;
}

/** The first letter of a name the player chose; an address gets no letter. */
export function accountInitial(name: string): string | null {
  if (/^0x/i.test(name)) return null;
  const letter = name.replace(/^@/, "").match(/[a-z0-9]/i);
  return letter !== null ? letter[0].toUpperCase() : null;
}

function PersonGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
    </svg>
  );
}

function Avatar({ initial }: { initial: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 flex-none place-items-center rounded-full bg-[linear-gradient(160deg,var(--surface-hover),var(--surface-raised))] text-sm font-bold text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]"
    >
      {initial ?? <PersonGlyph />}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`text-haze transition-transform duration-[120ms] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * What the account menu holds, in the popover (from 1024px) and at the foot of
 * the menu sheet (below it): the full name, the address to copy (funding at
 * the faucet starts there), the test USDC chip, and Sign out.
 */
function AccountDetails({
  account,
  extras,
  onSignOut,
}: {
  account: HeaderAccount;
  extras?: ReactNode;
  onSignOut?: () => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar initial={account.initial} />
        <p className="m-0 min-w-0 break-words text-[0.9375rem] font-semibold leading-tight text-foreground">
          {account.name}
        </p>
      </div>
      {account.address !== null || extras !== undefined ? (
        <div className="flex flex-wrap items-center gap-2">
          {account.address !== null ? <CopyAddressButton address={account.address} compact /> : null}
          {extras}
        </div>
      ) : null}
      {onSignOut !== undefined ? (
        <button
          type="button"
          onClick={onSignOut}
          className={`${buttonClasses({ variant: "secondary", size: "sm" })} justify-self-start`}
        >
          Sign out
        </button>
      ) : null}
    </div>
  );
}

export interface HeaderViewProps {
  signedIn: boolean;
  /** Signed out: Sign in, or the honest "sign-in is off" pill. */
  auth: ReactNode;
  /** Signed in: who, for the one account pill. */
  account?: HeaderAccount;
  /** Beside the address in the account menu: the test USDC chip. */
  accountExtras?: ReactNode;
  onSignOut?: () => void;
  /** The live header sticks and reads the scroll; the state gallery's copy
   *  sits in the page and can start solid. */
  sticky?: boolean;
  solid?: boolean;
  /** What sits under the bar: SPOTTER's outage band, and only while checks
   *  are paused. The gallery passes the band itself, or null. */
  status?: ReactNode;
  /** Open the menu sheet (below 1024px) on first render (the gallery). */
  initialMenuOpen?: boolean;
  /** Open the account popover (from 1024px) on first render (the gallery). */
  initialAccountOpen?: boolean;
}

/**
 * The header from props, so the state gallery can render it signed in
 * without a wallet. Header (below) feeds it from the wallet hooks.
 *
 * Signed out, the header is the brand, two links from 640px up, and Sign in:
 * nothing to open on a phone. Signed in, one account pill stands for the
 * player, as in the approved mock. From 1024px the four links sit beside it
 * and the pill (the avatar, plus the full name from 1280px, never cut off)
 * opens a small popover with the address and Sign out. Below 1024px the links
 * do not fit, so the pill is the avatar plus the menu glyph and opens the menu
 * sheet, which carries the same account details at its foot. Both are open
 * FOR a path, so navigating anywhere closes them without an effect.
 */
export function HeaderView({
  signedIn,
  auth,
  account,
  accountExtras,
  onSignOut,
  sticky = true,
  solid: forceSolid = false,
  status = <SpotterStatusLine outageOnly />,
  initialMenuOpen = false,
  initialAccountOpen = false,
}: HeaderViewProps) {
  const pathname = usePathname();
  const items = signedIn ? NAV_ITEMS : SIGNED_OUT_NAV_ITEMS;
  const [menuFor, setMenuFor] = useState<string | null>(initialMenuOpen ? pathname : null);
  const menuOpen = signedIn && menuFor === pathname;
  const setMenuOpen = (open: boolean) => setMenuFor(open ? pathname : null);
  const [accountFor, setAccountFor] = useState<string | null>(initialAccountOpen ? pathname : null);
  const accountOpen = signedIn && accountFor === pathname;
  const setAccountOpen = (open: boolean) => setAccountFor(open ? pathname : null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  // The popover closes on a press anywhere outside it.
  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (e: PointerEvent) => {
      if (accountRef.current !== null && !accountRef.current.contains(e.target as Node)) {
        setAccountFor(null);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [accountOpen]);

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!sticky) return;
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sticky]);
  const solid = forceSolid || scrolled || menuOpen;
  const who: HeaderAccount = account ?? { name: "Your account", initial: null, address: null };

  return (
    <header
      className={`${sticky ? "sticky top-0" : "relative"} z-40 border-b transition-[background-color,border-color] duration-[160ms] ease-out ${
        solid
          ? "border-edge bg-[var(--header-scrolled)] backdrop-blur-[14px] backdrop-saturate-[1.2]"
          : "border-transparent"
      }`}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (menuOpen) setMenuOpen(false);
        if (accountOpen) {
          setAccountOpen(false);
          accountButtonRef.current?.focus();
        }
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
          {!signedIn ? auth : null}
          {signedIn ? (
            <>
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={menuOpen ? "Close menu" : `Open menu, signed in as ${who.name}`}
                aria-expanded={menuOpen}
                aria-controls="mobile-nav"
                className={`inline-flex h-11 items-center gap-2 rounded-full bg-fill-quiet py-1.5 pl-1.5 pr-3 text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] hover:bg-fill-quiet-hover min-[1024px]:hidden ${FOCUS_RING}`}
              >
                <Avatar initial={who.initial} />
                <MenuIcon open={menuOpen} />
              </button>
              <div ref={accountRef} className="relative hidden min-[1024px]:block">
                <button
                  ref={accountButtonRef}
                  type="button"
                  onClick={() => setAccountOpen(!accountOpen)}
                  aria-label={`Your account, ${who.name}`}
                  aria-expanded={accountOpen}
                  aria-controls="account-menu"
                  className={`inline-flex h-11 items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3 text-[0.875rem] font-medium shadow-[inset_0_0_0_1px_var(--border)] hover:bg-fill-quiet hover:text-foreground ${
                    accountOpen ? "bg-fill-quiet text-foreground" : "text-muted"
                  } ${FOCUS_RING}`}
                >
                  <Avatar initial={who.initial} />
                  <span className="hidden whitespace-nowrap min-[1280px]:inline">{who.name}</span>
                  <Chevron open={accountOpen} />
                </button>
                {accountOpen ? (
                  <div
                    id="account-menu"
                    className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(20rem,calc(100vw-2rem))] rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] p-4 shadow-[inset_0_1px_0_rgba(246,228,182,0.1),inset_0_0_0_1px_var(--border-strong),0_24px_48px_-20px_rgba(0,0,0,0.8)]"
                  >
                    <AccountDetails account={who} extras={accountExtras} onSignOut={onSignOut} />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
      {menuOpen ? (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-edge min-[1024px]:hidden">
          <div className="mx-auto flex w-full max-w-[75rem] flex-col gap-1 px-gutter py-3">
            <NavLinks items={items} stacked onNavigate={() => setMenuOpen(false)} />
            <div className="mt-2 border-t border-edge px-1 pt-4">
              <AccountDetails account={who} extras={accountExtras} onSignOut={onSignOut} />
            </div>
          </div>
        </nav>
      ) : null}
      {status}
    </header>
  );
}

/** The signed-in player as the header names them: ENS first, then the
 *  @handle, then the short address. */
function useHeaderAccount(): HeaderAccount | undefined {
  const { authenticated, address } = useEmbeddedWallet();
  // Disabled until a wallet exists, so it costs nothing signed out.
  const { handleFor } = useDisplayNames(address !== null ? [address] : []);
  const ens = useEnsName(address);
  if (!authenticated || address === null) return undefined;
  const handle = handleFor(address);
  const name = ens ?? (handle !== null ? `@${handle}` : shortAddress(address));
  return { name, initial: accountInitial(name), address };
}

export default function Header() {
  const { authenticated, logout } = useEmbeddedWallet();
  const signedIn = DYNAMIC_CONFIGURED && authenticated;
  const account = useHeaderAccount();
  return (
    <HeaderView
      signedIn={signedIn}
      auth={<AuthOrPill />}
      account={account}
      accountExtras={<TestUsdcChip />}
      onSignOut={() => {
        void logout();
      }}
    />
  );
}
