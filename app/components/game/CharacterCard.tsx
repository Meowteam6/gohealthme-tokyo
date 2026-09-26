"use client";

// The character card: name, human stamp, sensor and what it can measure. Every
// game screen reads the same card, so a limit shows up here once instead of at
// every pool. `strip` is the one-line lobby header version.

import Link from "next/link";
import { useState } from "react";
import EnsName from "@/components/ens/EnsName";
import { TAP_TARGET } from "@/components/ui";
import { measurableGoalsOf } from "@/lib/game/character";
import { countsLineFor } from "@/lib/game/sensor-copy";
import type { CharacterView } from "@/lib/game/useCharacter";

function HumanStamp({ verified, mode }: { verified: boolean; mode: "world" | "allowlist" }) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border-2 border-accent-deep px-2.5 py-0.5 text-xs font-bold text-accent-deep">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        {mode === "world" ? "One human" : "On the list"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border-2 border-dashed border-muted px-2.5 py-0.5 text-xs font-bold text-muted">
      Human not proven
    </span>
  );
}

function SensorLine({ view }: { view: CharacterView }) {
  const [declined, setDeclined] = useState(false);
  const sensor = view.sensor;
  switch (sensor.kind) {
    case "loading":
      return <p className="text-sm text-muted">Looking at your wearable</p>;
    case "paired":
      return (
        <p className="text-sm">
          <span className="font-semibold">{sensor.device.label}.</span>{" "}
          {countsLineFor(sensor.device.metrics)}
        </p>
      );
    case "none":
      return (
        <p className="text-sm">
          <span className="text-muted">No wearable paired. </span>
          <Link href="/character?step=sensor" className="font-semibold text-accent-deep underline underline-offset-2">
            Pair one
          </Link>
        </p>
      );
    case "unreadable":
      return (
        <p className="text-sm text-warning">
          {sensor.label} is linked and I cannot read it right now.
        </p>
      );
    case "unavailable":
      return <p className="text-sm text-muted">Wearable check is not answering right now.</p>;
    case "unchecked":
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted">
            {declined ? "Still not checked. " : "Not checked this visit. "}
          </span>
          <button
            type="button"
            disabled={view.checkingSensor}
            onClick={() => {
              void view.checkSensor().then((ok) => setDeclined(!ok));
            }}
            className="min-h-11 font-semibold text-accent-deep underline underline-offset-2 disabled:opacity-60"
          >
            {view.checkingSensor ? "Waiting for your signature" : "Check my wearable (free, no transaction)"}
          </button>
        </div>
      );
  }
}

export default function CharacterCard({
  view,
  variant = "card",
}: {
  view: CharacterView;
  variant?: "card" | "strip";
}) {
  const c = view.character;
  if (c === null) return null;
  const verified = c.human === "verified";
  const nameNode =
    c.name !== null ? (
      <span>{c.name}</span>
    ) : (
      <EnsName address={c.address} />
    );

  if (variant === "strip") {
    return (
      <section
        aria-label="Your character"
        className="flex flex-col gap-2 rounded-3xl border border-edge bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-display text-xl font-extrabold tracking-display">{nameNode}</span>
          <HumanStamp verified={verified} mode={view.humanMode} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <SensorLine view={view} />
          <Link href="/character" className="text-sm font-semibold text-muted underline underline-offset-2 hover:text-foreground">
            Edit
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Your character"
      className="overflow-hidden rounded-3xl border border-edge bg-surface"
    >
      <div className="bg-board px-5 py-4 text-chalk">
        <p className="text-xs font-semibold text-chalk/70">Player</p>
        <p className="mt-1 break-all font-display text-[2rem] font-extrabold leading-display tracking-display sm:text-[2.5rem]">
          {nameNode}
        </p>
      </div>
      <dl className="divide-y divide-edge">
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <dt className="text-sm text-muted">Human</dt>
          <dd>
            <HumanStamp verified={verified} mode={view.humanMode} />
          </dd>
        </div>
        <div className="px-5 py-3">
          <dt className="text-sm text-muted">Wearable</dt>
          <dd className="mt-1">
            <SensorLine view={view} />
          </dd>
        </div>
        {c.device !== null ? (
          <div className="px-5 py-3">
            <dt className="text-sm text-muted">Runs you can play</dt>
            <dd className="mt-1 text-sm">
              Goals scored on {measurableGoalsOf(c.device).join(", ")}. Anything
              else shows as locked in the lobby, with the reason.
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="border-t border-edge px-5 py-3">
        <Link href="/pools" className={`-ml-4 font-semibold text-accent-deep ${TAP_TARGET}`}>
          Go to the lobby
        </Link>
      </div>
    </section>
  );
}
