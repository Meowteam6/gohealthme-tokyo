import type { Metadata } from "next";
import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import WalletSettings from "@/components/WalletSettings";
import Spotter from "@/components/spotter/Spotter";
import { EmptyState, buttonClasses } from "@/components/ui";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Your GoHealthMe settings: wallet address, Base Sepolia balance, your name, your paired wearable and how to disconnect it, and how to back the wallet up.",
  robots: NOINDEX,
};

const LINK_PRIMARY =
  `${buttonClasses()}`;

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words font-display text-[1.75rem] font-extrabold leading-display tracking-display sm:text-[2.5rem]">
            Settings
          </h1>
          <p className="text-base text-muted">
            Your wallet and where your USDC lives, the name you play under, and
            the wearable SPOTTER reads.
          </p>
        </div>
        {/* SPOTTER holding your wallet: the mascot on the money page. */}
        <div className="hidden shrink-0 sm:block">
          <Spotter state="settings" decorative />
        </div>
        <div className="shrink-0 sm:hidden">
          <Spotter state="settings" size="xs" decorative />
        </div>
      </header>

      <div className="mt-6">
        {DYNAMIC_CONFIGURED ? (
          <WalletSettings />
        ) : (
          <EmptyState
            title="Sign-in is off on this build"
            detail="Without sign-in there is no wallet to show here. The home page still explains how a run works."
            line="No sign-in, no wallet. I checked."
            action={
              <Link href="/" className={LINK_PRIMARY}>
                Go to the home page
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}
