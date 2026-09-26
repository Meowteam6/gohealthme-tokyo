"use client";

import { useNowSeconds } from "@/lib/game/useNowSeconds";

function describe(periodStart: bigint, periodEnd: bigint, now: number): string {
  const start = Number(periodStart);
  const end = Number(periodEnd);
  if (now < start) {
    return `Starts in ${spanLabel(start - now)}`;
  }
  if (now < end) {
    return `${spanLabel(end - now)} left`;
  }
  return "Period ended";
}

function spanLabel(seconds: number): string {
  if (seconds >= 86_400) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    return `${days}d ${hours}h`;
  }
  if (seconds >= 3_600) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

export default function Countdown({
  periodStart,
  periodEnd,
}: {
  periodStart: bigint;
  periodEnd: bigint;
}) {
  const now = useNowSeconds();

  if (now === null) {
    return <span className="text-muted">--</span>;
  }
  const ended = now >= Number(periodEnd);
  return (
    <span className={ended ? "text-muted" : "text-accent-deep"}>
      {describe(periodStart, periodEnd, now)}
    </span>
  );
}
