-- Per-wallet, per-day wearable aggregates for providers that push from a
-- device instead of being pulled from a vendor API. Apple Health today.
--
-- THIS IS THE ONLY TABLE IN THIS DATABASE THAT HOLDS HEALTH DATA. Every other
-- table here carries a deliberate "no health data" comment, so this one states
-- plainly what it holds and what it does not.
--
-- What lands here: one number per wallet, per calendar day, per metric. Steps
-- walked, hours slept. That is what a pool's verdict is computed from.
--
-- What NEVER lands here: raw HealthKit samples. The phone aggregates on device
-- and posts only the daily number, so individual heart-rate readings, workout
-- routes, GPS traces and sleep stage timings never leave the device at all.
--
-- Applied to the GoHealthMe Supabase project on 2026-09-08. Committed here so
-- the schema is reviewable: app/app/api/wearable/apple/sync/route.ts cites the
-- metric constraint below as its second line of defence, and a reader could
-- not previously verify that claim from the repo.

create table if not exists public.wearable_days (
  address text not null,
  metric text not null,
  day date not null,
  value numeric not null,
  source text not null default 'apple',
  updated_at timestamptz not null default now(),

  constraint wearable_days_pkey primary key (address, metric, day),

  -- Lowercase 0x address, matching every other table here.
  constraint wearable_days_address_check
    check (address ~ '^0x[0-9a-f]{40}$'),

  -- Mirrors the WearableMetric union in app/lib/wearable-goal.ts. A metric the
  -- app does not know about must not be storable, or a verdict could be
  -- computed from something nothing validates.
  --
  -- sleep_score and sleep_efficiency are DIFFERENT metrics measuring different
  -- things. Apple reports efficiency because Apple publishes no proprietary
  -- score, and a pool threshold does not mean the same thing to both.
  constraint wearable_days_metric_check
    check (metric in (
      'steps', 'sleep_hours', 'sleep_score', 'sleep_efficiency',
      'active_calories', 'distance_km', 'workouts'
    )),

  -- No negative day. A device reporting one is malfunctioning or lying, and a
  -- negative would silently drag a threshold comparison the wrong way.
  constraint wearable_days_value_check check (value >= 0),

  -- Which device path produced the row, so a future pushed provider does not
  -- get silently mixed in with Apple's numbers.
  constraint wearable_days_source_check check (source in ('apple')),

  -- A day far in the future is a clock bug or a forged post, and it would let
  -- someone pre-satisfy a pool window that has not happened yet.
  constraint wearable_days_day_check
    check (day <= (now() at time zone 'utc')::date + 1)
);

-- Service-role writes only, no policies. Same posture as every other table
-- here: the service role bypasses RLS and is used exclusively behind an
-- EIP-191 signature proving the caller controls the wallet being written.
-- Anon gets no read policy, so health data is never publicly readable.
alter table public.wearable_days enable row level security;

comment on table public.wearable_days is
  'Daily wearable aggregates per wallet, pushed from a device (Apple Health). THE ONLY TABLE HERE THAT HOLDS HEALTH DATA. One number per wallet/metric/day, never a raw sample: the phone aggregates on device and posts only the daily total. Service-role-write only after an EIP-191 signature proving wallet control; no anon read policy. Retention: rows are swept once no open pool window can reference them.';

comment on column public.wearable_days.address is
  'Lowercase 0x wallet address. Public value (appears on chain).';
comment on column public.wearable_days.metric is
  'One of the WearableMetric union values in app/lib/wearable-goal.ts. Constrained so an unknown metric cannot be stored. Note sleep_score and sleep_efficiency are DIFFERENT metrics measuring different things; Apple reports efficiency because Apple publishes no proprietary score.';
comment on column public.wearable_days.day is
  'The WEARER''S LOCAL calendar day, matching the keying app/lib/server/wearable/streak.ts uses and the calendar_date Junction reports. Not UTC: two providers keying days differently would pay differently for the same week.';
comment on column public.wearable_days.value is
  'The aggregate for that day in the metric base unit: steps count, hours, percent, kcal, km, sessions.';
comment on column public.wearable_days.source is
  'The device path that produced this row. Apple Health today.';

-- The read is always "one wallet, one metric, a date window", which the
-- primary key already serves in that exact column order. No second index: an
-- unused index is write amplification on the hot push path for nothing.

-- Retention sweep. Nothing here is needed once no pool window can reference
-- it; keeping health data longer than it is useful is a liability, not a
-- feature. Call from the same cron that sweeps due pools.
create or replace function public.sweep_wearable_days(older_than_days integer default 120)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with deleted as (
    delete from public.wearable_days
    where day < (now() at time zone 'utc')::date - older_than_days
    returning 1
  )
  select count(*)::integer from deleted;
$$;

comment on function public.sweep_wearable_days is
  'Deletes wearable aggregates older than the retention window (default 120 days, comfortably past the longest pool period). Returns the number of rows removed.';
