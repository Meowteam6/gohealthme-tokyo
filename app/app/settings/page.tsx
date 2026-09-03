import type { Metadata } from "next";
import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import WalletSettings from "@/components/WalletSettings";
import { EmptyState } from "@/components/ui";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Wallet",
  description:
    "Your GoHealthMe wallet: address, Base Sepolia balance, whether it is the wallet we made for you or one you connected, and how to back it up.",
  robots: NOINDEX,
};

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <header className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Wallet
          </h1>
          <p className="text-sm text-muted">
            Where your USDC lives and how to look after it.
          </p>
        </div>
        {/* SPOTTER holding your wallet - the mascot on the money page.
            eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/spotter/spotter-wallet.png"
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
            title="Sign-in is not configured"
            detail="Set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID to enable embedded wallets and this page."
            action={
              <Link
                href="/pools"
                className="inline-block rounded-xl bg-accent-strong px-6 py-3 text-sm font-semibold text-background hover:bg-accent"
              >
                Browse pools instead
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}
