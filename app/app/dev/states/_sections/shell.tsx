"use client";

import { GallerySection, StateFrame, type SectionProps } from "../_kit";
import { HeaderView } from "@/components/Header";
import SiteFooter from "@/components/SiteFooter";
import { SpotterOutageBand } from "@/components/game/SpotterStatusLine";
import { Button, buttonClasses } from "@/components/ui";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import { markExternalConnectIntent } from "@/lib/wallet-connect-intent";

// Shell states for the dev gallery: the header signed out and signed in (the
// approved nav: Lobby, My runs, History, Challenges, Settings), its menu open,
// the outage band under the bar, the footer, and Dynamic's own sign-in modal.
// HeaderView is the real header from props, so no wallet is needed; the modal
// is Dynamic's real one, opened the same way "I already have a wallet" opens
// it, themed by the .dynamic-shadow-dom variables in globals.css.

const ADDRESS = "0x8a39c0ffee000000000000000000000000006141";
const MIKA = { name: "mika.gohealthme.eth", initial: "M", address: ADDRESS };

function SignedIn({
  menu = false,
  account = false,
  outage = false,
}: {
  menu?: boolean;
  account?: boolean;
  outage?: boolean;
}) {
  return (
    <HeaderView
      sticky={false}
      solid
      signedIn
      initialMenuOpen={menu}
      initialAccountOpen={account}
      status={outage ? <SpotterOutageBand /> : null}
      auth={null}
      account={MIKA}
      onSignOut={() => {}}
    />
  );
}

function OpenDynamic() {
  const { login } = useEmbeddedWallet();
  return (
    <Button
      variant="secondary"
      onClick={() => {
        markExternalConnectIntent();
        login();
      }}
    >
      Open Dynamic&apos;s sign-in
    </Button>
  );
}

export default function ShellStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <StateFrame name="header-signed-out" note="transparent over the page: Runs, How it pays, Sign in">
        <HeaderView
          sticky={false}
          signedIn={false}
          status={null}
          auth={<span className={buttonClasses({ variant: "secondary", size: "sm" })}>Sign in</span>}
        />
      </StateFrame>
      <StateFrame
        name="header-signed-in"
        note="scrolled: the solid night bar, the approved nav and one account pill (the full name from 1280px); below 1024px the pill is the avatar and the menu"
      >
        <SignedIn />
      </StateFrame>
      <StateFrame
        name="header-signed-in-account"
        note="from 1024px, the pill open: the full name, the address to copy, Sign out"
      >
        <div className="min-h-[15rem]">
          <SignedIn account />
        </div>
      </StateFrame>
      <StateFrame
        name="header-signed-in-menu"
        note="below 1024px, menu open: the five links, then the name, the address to copy and Sign out"
      >
        <SignedIn menu />
      </StateFrame>
      <StateFrame name="header-outage" note="SPOTTER's wallet is empty: the one band that may sit under the bar">
        <SignedIn outage />
      </StateFrame>
      <StateFrame name="footer" note="the deepest field: beta and test money in small print">
        <SiteFooter />
      </StateFrame>
      <StateFrame
        name="dynamic-modal"
        note="Dynamic's own modal (kept, not rebuilt), themed dark by the .dynamic-shadow-dom variables; the button opens the real one"
      >
        {DYNAMIC_CONFIGURED ? (
          <OpenDynamic />
        ) : (
          <p className="m-0 text-[0.9375rem] text-muted">Sign-in is off on this build, so there is no modal to open.</p>
        )}
      </StateFrame>
    </GallerySection>
  );
}
