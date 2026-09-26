import type { Metadata } from "next";
import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import WalletSettings from "@/components/WalletSettings";
import { EmptyState } from "@/components/ui";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Your GoHealthMe settings: wallet address, Base Sepolia balance, your name, your paired wearable and how to disconnect it, and how to back the wallet up.",
  robots: NOINDEX,
};

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <header className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Settings
          </h1>
          <p className="text-sm text-muted">
            Your wallet and where your USDC lives, the name you play under, and
            the wearable SPOTTER reads.
          </p>
        </div>
        {/* SPOTTER holding your wallet - the mascot on the money page.
            eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/spotter/spotter-wallet.webp"
          alt=""
          aria-hidden="true"
          className="hidden h-28 w-auto shrink-0 drop-shadow-sm sm:block"
        />
      </header>

      <div className="mt-6">
        {DYNAMIC_CONFIGURED ? (
          <WalletSettings />
        ) : (
          <EmptyState
            title="Sign-in is off on this build"
            detail="Without sign-in there is no wallet to show here. The home page still explains how a run works."
            action={
              <Link
                href="/"
                className="inline-flex min-h-11 items-center rounded-lg bg-accent px-6 text-sm font-semibold text-foreground hover:bg-accent-hover"
              >
                Go to the home page
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}
