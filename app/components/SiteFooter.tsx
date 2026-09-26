import Link from "next/link";
import { BrandLockup, FOCUS_RING } from "@/components/ui";

// The site footer (docs/DESIGN.md). The deepest field on the page. Test money
// and beta are said here, in small print, as well as under every money action.
// Below 640px its foot keeps the helper button's lane clear (52px, its 1rem
// inset and 1rem of air), so no link or disclaimer ever sits under it.

const LINKS: readonly { href: string; label: string }[] = [
  { href: "/pools", label: "Challenges" },
  { href: "/#how", label: "How it pays" },
  { href: "/agent", label: "About SPOTTER" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-edge bg-surface-deep pb-[calc(52px+2rem+env(safe-area-inset-bottom))] pt-8 sm:pb-[calc(32px+env(safe-area-inset-bottom))]">
      <div className="mx-auto grid w-full max-w-[75rem] gap-[18px] px-gutter min-[900px]:grid-cols-[1fr_auto] min-[900px]:items-start">
        <div>
          <BrandLockup />
          <p className="m-0 mt-3 max-w-[62ch] text-[0.8125rem] leading-[1.55] text-haze">
            Beta on Base Sepolia with test USDC, so no real money moves. Your
            wearable&apos;s numbers stay private; only the result of each
            challenge is recorded. Not medical or financial advice.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="m-0 flex list-none flex-wrap gap-x-4 p-0">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`inline-flex min-h-11 items-center rounded-md text-[0.9375rem] font-medium text-muted no-underline hover:text-foreground ${FOCUS_RING}`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
