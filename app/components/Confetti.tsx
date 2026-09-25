"use client";

// A one-shot confetti burst for the payout moment: coral + gold + emerald
// pieces rain from the coin, then they are gone (never looping). Generated on
// the client only (mounted gate) so server and client markup agree, and it
// renders nothing at all under prefers-reduced-motion.

import { useMemo, useSyncExternalStore } from "react";

// Gold is reserved strictly for money in motion, so the celebration burst is
// never gold: coral = people, emerald = water. The gold lives only on the coin
// and the amount, which is what actually moved.
const COLORS = [
  "var(--coral)",
  "var(--coral-strong)",
  "var(--accent)",
  "var(--accent-strong)",
];

// Deterministic scatter per piece: the burst looks random, and rendering stays
// pure (no Math.random during render).
function scatter(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const noSubscription = () => () => {};

export default function Confetti({ count = 20 }: { count?: number }) {
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  const pieces = useMemo(() => {
    if (!mounted) return [];
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return [];
    }
    return Array.from({ length: count }, (_, i) => ({
      key: i,
      dx: (scatter(i, 1) - 0.5) * 340,
      dy: 130 + scatter(i, 2) * 190,
      rot: (scatter(i, 3) - 0.5) * 720,
      delay: scatter(i, 4) * 140,
      size: 6 + scatter(i, 5) * 6,
      color: COLORS[i % COLORS.length],
    }));
  }, [mounted, count]);

  if (pieces.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {pieces.map((p) => (
        <span
          key={p.key}
          className="confetti-piece"
          style={{
            left: "50%",
            top: "40%",
            width: `${p.size}px`,
            height: `${p.size * 1.6}px`,
            backgroundColor: p.color,
            animationDelay: `${p.delay}ms`,
            ["--dx" as string]: `${p.dx}px`,
            ["--dy" as string]: `${p.dy}px`,
            ["--rot" as string]: `${p.rot}deg`,
          }}
        />
      ))}
    </div>
  );
}
