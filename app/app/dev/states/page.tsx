import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SECTIONS } from "./_sections";

// Dev-only state gallery (docs/DESIGN.md, "State gallery"). Renders the shared
// primitives and every stateful screen component with fixture props, so each
// state can be screenshotted at 360, 390 and 1440 without a wallet, a chain or
// a live run. It never exists on a deployment: any production build (Vercel
// preview included, which also runs NODE_ENV=production) answers 404.
//
//   /dev/states                  every section
//   /dev/states?only=run         one section
//   /dev/states?only=run#run-zero-balance   one state
//
// Run locally with the open-beta switch on (lib/open-beta.ts; it is the
// product's switch, not a gate bypass) so the page is not behind character
// creation:
//   NEXT_PUBLIC_ACCESS_GATE_DISABLED=1 npx next dev -p <port>

export const metadata: Metadata = {
  title: "State gallery",
  robots: { index: false, follow: false },
};

export default async function StatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const only = (await searchParams).only;
  const pick = typeof only === "string" ? only : null;
  const sections = pick === null ? SECTIONS : SECTIONS.filter((s) => s.meta.id === pick);

  return (
    <div className="grid gap-12 pb-16">
      <header>
        <h1 className="type-display m-0 text-[2.75rem] min-[900px]:text-[4rem]">State gallery</h1>
        <p className="m-0 mt-3 max-w-[64ch] text-[1.0625rem] text-muted">
          Dev only. Every primitive and screen state with fixture props. Numbers
          come from lib/commitment.ts. Nothing here reads a wallet or the chain.
        </p>
        <nav aria-label="Sections" className="mt-4 flex flex-wrap gap-x-4">
          <a href="?" className="inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-muted hover:text-foreground">
            All
          </a>
          {SECTIONS.map(({ meta }) => (
            <a
              key={meta.id}
              href={`?only=${meta.id}`}
              aria-current={pick === meta.id ? "page" : undefined}
              className="inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-muted hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:underline-offset-4"
            >
              {meta.title}
            </a>
          ))}
        </nav>
      </header>
      {sections.length === 0 ? (
        <p className="m-0 text-muted">No section called “{pick}”.</p>
      ) : (
        sections.map(({ meta, Component }) => <Component key={meta.id} meta={meta} />)
      )}
    </div>
  );
}
