import Link from "next/link";
import type { ReactNode } from "react";
import { FOCUS_RING } from "@/components/ui";

// The run page grid (docs/DESIGN.md, "Layout"): on a phone the hero, the stake
// card, then everything else; from 960px the stake card is the right column,
// 420px and sticky under the header, while the hero and the cards below it
// share the left. Server-safe; the page and the state gallery both use it.

export function BackLink({ href = "/pools", label = "Open challenges" }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      className={`-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-[0.9375rem] font-semibold text-muted no-underline hover:text-foreground ${FOCUS_RING}`}
    >
      <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" className="rotate-180">
        <path
          d="M6 3.5 10.5 8 6 12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </Link>
  );
}

export default function RunLayout({
  hero,
  stake,
  children,
  back = true,
}: {
  /** Usually <RunHero>; it places itself in the hero area. */
  hero: ReactNode;
  /** The stake card, or the verdict once the run is over. */
  stake: ReactNode;
  /** Your night, Who's in, Also open and anything secondary, in order. */
  children?: ReactNode;
  back?: boolean;
}) {
  return (
    // -mt-4 lifts the back link to the mock's line under the header: the
    // run page opens tighter than the shared main padding.
    <div className="-mt-4 pb-6 min-[960px]:pb-16">
      {back ? <BackLink /> : null}
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-y-4 [grid-template-areas:'hero'_'stake'_'main'] min-[960px]:mt-3 min-[960px]:grid-cols-[minmax(0,1fr)_420px] min-[960px]:grid-rows-[auto_auto_1fr] min-[960px]:items-start min-[960px]:gap-x-12 min-[960px]:gap-y-5 min-[960px]:[grid-template-areas:'hero_stake'_'main_stake'_'._stake']">
        {hero}
        <div className="min-w-0 [grid-area:stake] min-[960px]:sticky min-[960px]:top-[88px] min-[960px]:mt-2">
          {stake}
        </div>
        <div className="grid min-w-0 content-start gap-4 [grid-area:main] min-[960px]:gap-5">{children}</div>
      </div>
    </div>
  );
}
