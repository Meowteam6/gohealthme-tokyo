"use client";

// "What do you wear?" (docs/DESIGN.md, WearableChips): one radio group of
// brands, driven by the capability table, with a hint that names the picked
// brand's limit and what works instead. No account needed. The landing and
// the signed-out lobby share it, and the answer is remembered on the device.

import { useId, useRef, type KeyboardEvent } from "react";
import { Chip } from "@/components/ui";
import type { Segment } from "@/lib/game/landing";
import { BRAND_LABEL, WEARABLE_BRANDS, type WearableBrand } from "@/lib/game/wearable-fit";

export default function WearableChips({
  picked,
  onPick,
  hint,
  className = "",
}: {
  picked: WearableBrand | null;
  onPick: (brand: WearableBrand) => void;
  /** The picked brand's hint, or null for the default line. */
  hint: readonly Segment[] | null;
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const questionId = useId();
  const focusIndex = picked === null ? 0 : WEARABLE_BRANDS.indexOf(picked);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const n = WEARABLE_BRANDS.length;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (index + 1) % n
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (index + n - 1) % n
          : null;
    if (next === null) return;
    e.preventDefault();
    onPick(WEARABLE_BRANDS[next]);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  return (
    <div className={className}>
      <p id={questionId} className="m-0 text-[0.9375rem] font-semibold">
        What do you wear?
      </p>
      <div ref={group} role="radiogroup" aria-labelledby={questionId} className="mt-2.5 flex flex-wrap gap-2">
        {WEARABLE_BRANDS.map((brand, i) => (
          <Chip
            key={brand}
            role="radio"
            selected={picked === brand}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onPick(brand)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {BRAND_LABEL[brand]}
          </Chip>
        ))}
      </div>
      <p aria-live="polite" className="m-0 mt-2 min-h-[21px] max-w-[60ch] text-sm leading-[1.45] text-haze">
        {hint === null
          ? "Pick yours and each challenge shows whether it can check it. No account needed."
          : hint.map((s, i) =>
              s.strong === true ? (
                <b key={i} className="font-semibold text-foreground">
                  {s.text}
                </b>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
      </p>
    </div>
  );
}
