"use client";

// The character card: name, human stamp, sensor and what it can measure. Every
// game screen reads the same card, so a limit shows up here once instead of at
// every pool. `strip` is the one-line lobby header version.

import Link from "next/link";
import { useState } from "react";
import EnsName from "@/components/ens/EnsName";
import { ChevronLink, TEXT_LINK } from "@/components/ui";
import { measurableGoalsOf } from "@/lib/game/character";
import { countsLineFor } from "@/lib/game/sensor-copy";
import type { CharacterView } from "@/lib/game/useCharacter";

function HumanStamp({ verified, mode }: { verified: boolean; mode: "world" | "allowlist" }) {
  if (verified) {
    return (
      <span className="inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-tag bg-moonlight/10 px-2.5 text-[0.8125rem] font-semibold text-moonlight">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        {mode === "world" ? "One human" : "On the list"}
      </span>
    );
  }
  return (
    <span className="inline-flex h-[26px] items-center whitespace-nowrap rounded-tag bg-fill-quiet px-2.5 text-[0.8125rem] font-semibold text-haze shadow-[inset_0_0_0_1px_var(--border-strong)]">
      Human not proven
    </span>
  );
}

function SensorLine({ view }: { view: CharacterView }) {
  const [declined, setDeclined] = useState(false);
  const sensor = view.sensor;
  switch (sensor.kind) {
    case "loading":
      return <p className="m-0 text-sm text-haze">Looking at your wearable</p>;
    case "paired":
      return (
        <p className="m-0 text-[0.9375rem] text-muted">
          <span className="font-semibold text-foreground">{sensor.device.label}.</span>{" "}
          {countsLineFor(sensor.device.metrics)}
        </p>
      );
    case "none":
      return (
        <p className="m-0 flex flex-wrap items-center gap-x-2 text-[0.9375rem]">
          <span className="text-muted">No wearable paired.</span>
          <Link href="/character?step=sensor" className={TEXT_LINK}>
            Pair one
          </Link>
        </p>
      );
    case "unreadable":
      return (
        <p className="m-0 text-[0.9375rem] text-warning">
          {sensor.label} is linked and I cannot read it right now.
        </p>
      );
    case "unavailable":
      return <p className="m-0 text-[0.9375rem] text-muted">Wearable check is not answering right now.</p>;
    case "unchecked":
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem]">
          <span className="text-muted">
            {declined ? "Still not checked. " : "Not checked this visit. "}
          </span>
          <button
            type="button"
            disabled={view.checkingSensor}
            onClick={() => {
              void view.checkSensor().then((ok) => setDeclined(!ok));
            }}
            className={`${TEXT_LINK} text-left disabled:opacity-60`}
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
        className="flex flex-col gap-2 rounded-card bg-surface px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="type-heading truncate text-[1.375rem]">{nameNode}</span>
          <HumanStamp verified={verified} mode={view.humanMode} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <SensorLine view={view} />
          <Link href="/character" className={`${TEXT_LINK} text-sm`}>
            Edit
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Your character"
      className="overflow-hidden rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] shadow-card-hero"
    >
      <div className="px-5 pb-4 pt-5">
        <p className="m-0 text-[0.8125rem] font-medium text-haze">Player</p>
        <p className="type-heading m-0 mt-1 break-all text-[1.875rem] min-[900px]:text-[2.25rem]">
          {nameNode}
        </p>
      </div>
      <dl className="m-0 divide-y divide-edge border-t border-edge">
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <dt className="text-sm text-haze">Human</dt>
          <dd className="m-0">
            <HumanStamp verified={verified} mode={view.humanMode} />
          </dd>
        </div>
        <div className="px-5 py-3">
          <dt className="text-sm text-haze">Wearable</dt>
          <dd className="m-0 mt-1">
            <SensorLine view={view} />
          </dd>
        </div>
        {c.device !== null ? (
          <div className="px-5 py-3">
            <dt className="text-sm text-haze">Runs you can play</dt>
            <dd className="m-0 mt-1 text-[0.9375rem] text-muted">
              Goals scored on {measurableGoalsOf(c.device).join(", ")}. Anything
              else shows as locked in the lobby, with the reason.
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="border-t border-edge px-5 py-1">
        <ChevronLink href="/pools">Go to the lobby</ChevronLink>
      </div>
    </section>
  );
}
