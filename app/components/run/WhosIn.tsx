import type { ReactNode } from "react";
import { Card, Skeleton } from "@/components/ui";

// Who's in (docs/DESIGN.md, "Who's in"): one row per player, named by ENS
// where they have a name. Only the viewer's own row says anything about their
// night; everyone else shows "Hit" once the chain records it, and nothing
// before. Presentational; the page resolves names and results.

export interface RosterRow {
  key: string;
  /** The ENS name, handle or short address. */
  name: ReactNode;
  /** One letter for the avatar. */
  initial: string;
  you: boolean;
  /** "Hit", "You, night to play". Empty for another player without a result. */
  status: string;
  hit: boolean;
}

export default function WhosIn({
  rows,
  loading = false,
  error = null,
  copy,
  action,
}: {
  rows: RosterRow[];
  loading?: boolean;
  /** Shown in place of the rows when the players did not read, with a retry. */
  error?: ReactNode;
  /** The line under the roster: the two-player math, or the count. */
  copy?: ReactNode;
  /** Usually "Challenge a friend into this run". */
  action?: ReactNode;
}) {
  return (
    <Card as="section" aria-labelledby="who-h">
      <h2 id="who-h" className="m-0 text-[1.0625rem] font-semibold">
        Who&apos;s in
      </h2>
      {loading ? (
        <div className="mt-3 grid gap-3" aria-busy="true">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-44" />
        </div>
      ) : error !== null ? (
        <div className="mt-3">{error}</div>
      ) : (
        <ul className="m-0 mt-3 list-none p-0">
          {rows.length === 0 ? (
            <li className="flex min-h-[52px] items-center gap-3 text-[0.9375rem] text-haze">
              <span aria-hidden="true" className="size-8 flex-none rounded-full border-[1.5px] border-dashed border-edge-strong" />
              Nobody yet
            </li>
          ) : (
            rows.map((row) => (
              <li
                key={row.key}
                className="flex min-h-[52px] items-center gap-3 border-t border-edge text-[0.9375rem] first:border-t-0"
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 flex-none place-items-center rounded-full bg-moonlight/10 text-[0.8125rem] font-bold text-moonlight shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--moonlight)_45%,transparent)]"
                >
                  {row.initial}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {row.name}
                  {row.you ? <span className="sr-only"> (you)</span> : null}
                </span>
                {row.status !== "" ? (
                  <span
                    className={`num flex-none text-sm ${
                      row.hit ? "font-semibold text-moonlight" : "text-haze"
                    }`}
                  >
                    {row.status}
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      )}
      {copy !== undefined ? (
        <p className="num m-0 mb-4 mt-2.5 text-[0.9375rem] text-muted [&_b]:font-semibold [&_b]:text-foreground">
          {copy}
        </p>
      ) : null}
      {action}
    </Card>
  );
}
