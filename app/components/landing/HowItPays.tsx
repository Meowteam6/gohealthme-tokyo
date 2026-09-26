"use client";

// "How a run pays" on the landing (docs/DESIGN.md, OutcomeTabs): You hit / You
// miss / Nobody hits as ARIA tabs, each with SPOTTER's pose for that outcome
// standing on the panel and the worked figure for the live run, and beside
// them who holds the money. Every sentence and figure is lib/game/landing.ts
// outcomeCopy, fed the featured run's terms; with no live run, the figures
// are left out rather than invented.

import { useRef, useState, type KeyboardEvent } from "react";
import Perch from "@/components/spotter/Perch";
import { Card } from "@/components/ui";
import { feeLine } from "@/lib/game/commitment-copy";
import { outcomeCopy, type OutcomeKey, type RunTerms } from "@/lib/game/landing";
import type { SpotterScreenState } from "@/lib/spotter-poses";

const TABS: readonly { key: OutcomeKey; label: string; state: SpotterScreenState }[] = [
  { key: "hit", label: "You hit", state: "outcome-hit" },
  { key: "miss", label: "You miss", state: "outcome-miss" },
  { key: "none", label: "Nobody hits", state: "outcome-none" },
];

function VaultIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={`flex-none text-moonlight ${className}`}>
      <rect x="2.5" y="4" width="15" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10.2" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 16.5v1.3M15 16.5v1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function HowItPays({
  terms,
  confirm,
  initial = "hit",
}: {
  /** The featured run's live terms, or null when none was read. */
  terms: RunTerms | null;
  /** SPOTTER asks the player to confirm with World ID before paying. */
  confirm: boolean;
  initial?: OutcomeKey;
}) {
  const [active, setActive] = useState<OutcomeKey>(initial);
  const refs = useRef<Record<OutcomeKey, HTMLButtonElement | null>>({ hit: null, miss: null, none: null });
  const copy = outcomeCopy(active, terms);
  const tab = TABS.find((t) => t.key === active) ?? TABS[0];
  const fee = terms !== null ? feeLine(terms.feeBps) : null;

  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    const next =
      e.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : e.key === "ArrowLeft"
          ? (index + last) % TABS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const key = TABS[next].key;
    setActive(key);
    refs.current[key]?.focus();
  }

  return (
    <div className="mt-[22px] grid gap-5 [grid-template-areas:'tabs'_'outcome'_'trust'] min-[900px]:mt-9 min-[900px]:grid-cols-[minmax(0,560px)_minmax(0,1fr)] min-[900px]:gap-x-[72px] min-[900px]:gap-y-0 min-[900px]:[grid-template-areas:'tabs_trust'_'outcome_trust']">
      <div
        role="tablist"
        aria-label="How a run pays"
        className="grid grid-cols-3 gap-1 rounded-2xl bg-fill-quiet p-1 shadow-[inset_0_0_0_1px_var(--border)] [grid-area:tabs]"
      >
        {TABS.map((t, i) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`pays-tab-${t.key}`}
              aria-selected={selected}
              aria-controls="pays-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={`h-11 rounded-xl border-0 text-[0.9375rem] font-semibold transition-[background-color,color] duration-[120ms] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
                selected
                  ? "bg-accent text-accent-foreground shadow-selected"
                  : "bg-transparent text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        id="pays-panel"
        role="tabpanel"
        aria-labelledby={`pays-tab-${active}`}
        className="[grid-area:outcome]"
      >
        {/* A fixed reserve so switching tabs never moves the page; a taller
            pose rises into the gap under the tabs instead. */}
        <Perch state={tab.state} side="right" inset={[14, 24]} reserve={[98, 118]} decorative>
          <Card className="min-h-[172px] min-[900px]:min-h-[184px]">
            <h3 className="m-0 max-w-[calc(100%-96px)] text-[1.1875rem] font-semibold leading-[1.3] min-[900px]:text-[1.3125rem]">
              {copy.heading}
            </h3>
            <p className="m-0 mt-2 text-[0.9375rem] leading-normal text-muted">{copy.body}</p>
            {copy.worked !== null ? (
              <p className="num m-0 mt-3.5 flex items-baseline justify-between gap-3 border-t border-edge pt-3 text-[0.9375rem] text-muted">
                <span>{copy.worked.label}</span>
                <b
                  className={`text-[1.375rem] font-bold tracking-[-0.01em] ${
                    copy.worked.tone === "money"
                      ? "text-gold"
                      : copy.worked.tone === "dusk"
                        ? "text-dusk"
                        : "text-foreground"
                  }`}
                >
                  {copy.worked.usd}
                </b>
              </p>
            ) : null}
          </Card>
        </Perch>
      </div>

      <div className="[grid-area:trust] min-[900px]:self-center min-[900px]:pt-10">
        <p className="m-0 flex items-start gap-3 text-[0.9375rem] leading-normal text-muted min-[900px]:gap-4 min-[900px]:font-display min-[900px]:text-[1.75rem] min-[900px]:font-medium min-[900px]:leading-[1.28] min-[900px]:tracking-[-0.01em] min-[900px]:text-foreground min-[900px]:[font-variation-settings:'SOFT'_50,'WONK'_0,'opsz'_48]">
          <VaultIcon className="mt-0.5 size-5 min-[900px]:mt-[5px] min-[900px]:size-[30px]" />
          <span>
            <b className="font-semibold text-foreground min-[900px]:font-medium">
              Your stake sits in the run&apos;s contract, not with SPOTTER.
            </b>{" "}
            {confirm
              ? "He reads your wearable's result, you confirm it's you with World ID, and the contract pays."
              : "He reads your wearable's result. The contract pays."}
          </span>
        </p>
        {fee !== null ? (
          <p className="m-0 ml-8 mt-2.5 text-sm text-haze min-[900px]:ml-[46px] min-[900px]:mt-4 min-[900px]:text-[0.9375rem]">
            {fee}
          </p>
        ) : null}
      </div>
    </div>
  );
}
