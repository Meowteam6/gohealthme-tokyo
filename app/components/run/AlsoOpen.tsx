import Link from "next/link";
import { Card, FOCUS_RING } from "@/components/ui";
import { Glyph } from "@/components/run/glyphs";

// Also open (docs/DESIGN.md): other live runs, filtered to the ones the
// viewer's wearable can check, so nothing here leads to a lock. Renders
// nothing when there is nothing to offer.

export interface AlsoOpenRow {
  href: string;
  title: string;
  ends: string;
  stake: string;
  pot: string;
}

export default function AlsoOpen({ rows, sub }: { rows: AlsoOpenRow[]; sub: string }) {
  if (rows.length === 0) return null;
  return (
    <Card as="section" aria-labelledby="also-h">
      <h2 id="also-h" className="m-0 text-[1.0625rem] font-semibold">
        Also open
      </h2>
      <p className="m-0 mt-0.5 text-sm text-haze">{sub}</p>
      <ul className="m-0 mt-2.5 grid list-none gap-2 p-0">
        {rows.map((row) => (
          <li key={row.href}>
            <Link
              href={row.href}
              className={`flex min-h-16 items-center justify-between gap-3 rounded-control bg-fill-quiet px-3.5 py-2.5 no-underline shadow-[inset_0_0_0_1px_var(--border)] transition-colors duration-[120ms] hover:bg-fill-quiet-hover ${FOCUS_RING}`}
            >
              <span className="min-w-0">
                <span className="block text-[0.9375rem] font-semibold leading-[1.3]">{row.title}</span>
                <span className="num flex flex-wrap gap-x-3 text-[0.8125rem] text-haze">
                  <span>Ends {row.ends}</span>
                  <span>Stake {row.stake}</span>
                  <span className="font-semibold text-gold">Pot {row.pot}</span>
                </span>
              </span>
              <Glyph name="chev" className="text-haze" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
