"use client";

// The character card: name, human stamp, sensor and what it can measure. Every
// game screen reads the same card, so a limit shows up here once instead of at
// every pool. `strip` is the one-line lobby header version.

import Link from "next/link";
import { useState } from "react";
import EnsName from "@/components/ens/EnsName";
import { ChevronLink, TEXT_LINK } from "@/components/ui";
import { runName } from "@/lib/game/landing";
import { useOpenRuns } from "@/lib/game/useOpenRuns";
import { humanStampOf, type Character, type HumanMode } from "@/lib/game/character";
import type { CharacterView } from "@/lib/game/useCharacter";
import type { AccessSource } from "@/lib/useAccess";

/** The checked chip: the One human stamp, and (Nikki, 2026-09-27) the paired
 *  wearable on the lobby strip, so both read as the same kind of fact. */
function CheckChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-tag bg-moonlight/10 px-2.5 text-[0.8125rem] font-semibold text-moonlight">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      {children}
    </span>
  );
}

/**
 * The stamp beside the player's name, or null when unproven. "One human" for a
 * World ID binding, "On the list" for the list and the admins, so a list
 * player on a World-on build is never stamped as World-verified.
 *
 * While KILL_WORLD_ID pauses World the lane reads off, the mode is
 * "allowlist" and the character's proof reads "list" for everyone approved,
 * which stamped World-verified players "On the list". The server's access
 * `source` still says "world" for a binding World already made, so it decides
 * the stamp whether or not World is paused right now.
 *
 * In open beta (2026-10-07) an unproven player is not told "Human not
 * proven": World ID is optional, so HumanStamp offers it with a link to step
 * 2 instead. A World binding keeps its "One human" stamp.
 */
export function characterStampOf(
  character: Character,
  mode: HumanMode,
  source: AccessSource | undefined,
): string | null {
  if (character.human !== "verified") return null;
  if (source === "world") return "One human";
  return humanStampOf(character, mode);
}

const QUIET_CHIP =
  "inline-flex h-[26px] items-center whitespace-nowrap rounded-tag bg-fill-quiet px-2.5 text-[0.8125rem] font-semibold text-haze shadow-[inset_0_0_0_1px_var(--border-strong)]";

function HumanStamp({ view, character }: { view: CharacterView; character: Character }) {
  const stamp = characterStampOf(character, view.humanMode, view.access.source);
  if (stamp !== null) {
    return <CheckChip>{stamp}</CheckChip>;
  }
  if (view.openBeta === true) {
    return (
      <Link href="/character?step=human" className={QUIET_CHIP}>
        World ID optional
      </Link>
    );
  }
  return <span className={QUIET_CHIP}>Human not proven</span>;
}

function SensorLine({ view }: { view: CharacterView }) {
  const [declined, setDeclined] = useState(false);
  const sensor = view.sensor;
  switch (sensor.kind) {
    case "loading":
      return <p className="m-0 text-sm text-haze">Looking at your wearable</p>;
    case "paired":
      return (
        <p className="m-0 text-[0.9375rem] font-semibold text-foreground">{sensor.device.label}</p>
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
          <HumanStamp view={view} character={c} />
          {view.sensor.kind === "paired" ? <CheckChip>{view.sensor.device.label}</CheckChip> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {view.sensor.kind === "paired" ? null : <SensorLine view={view} />}
          <Link href="/character" className={`${TEXT_LINK} text-sm`}>
            Edit
          </Link>
        </div>
      </section>
    );
  }

  return <PlayerCard view={view} nameNode={nameNode} />;
}

/** The full card on /character: the name with the human stamp beside it, the
 *  challenges this player can join, and the way into the lobby. The wearable
 *  already shows on step 4 above, so it only appears here when nothing is
 *  paired (Nikki's cleanup, 2026-09-27). */
function PlayerCard({
  view,
  nameNode,
}: {
  view: CharacterView;
  nameNode: React.ReactNode;
}) {
  const c = view.character;
  const open = useOpenRuns();
  if (c === null) return null;
  const joinable = open.runs.slice(0, 3);
  const unpaired = view.sensor.kind !== "paired";
  return (
    <section
      aria-label="Your character"
      className="overflow-hidden rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] shadow-card-hero"
    >
      <div className="px-5 pb-4 pt-5">
        <p className="m-0 text-[0.8125rem] font-medium text-haze">Player</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="type-heading m-0 break-all text-[1.875rem] min-[900px]:text-[2.25rem]">
            {nameNode}
          </p>
          <HumanStamp view={view} character={c} />
        </div>
      </div>
      <dl className="m-0 divide-y divide-edge border-t border-edge">
        {unpaired ? (
          <div className="px-5 py-3">
            <dt className="text-sm text-haze">Wearable</dt>
            <dd className="m-0 mt-1">
              <SensorLine view={view} />
            </dd>
          </div>
        ) : null}
        {c.device !== null && joinable.length > 0 ? (
          <div className="px-5 py-3">
            <dt className="text-sm text-haze">Challenges you can join</dt>
            <dd className="m-0 mt-1">
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {joinable.map((run) => (
                  <li key={run.pool.id.toString()}>
                    <Link href={`/pools/${run.pool.id.toString()}`} className={`${TEXT_LINK} text-[0.9375rem]`}>
                      {runName(run.pool)}
                    </Link>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="border-t border-edge px-5 py-1">
        <ChevronLink href="/pools">See all challenges</ChevronLink>
      </div>
    </section>
  );
}
