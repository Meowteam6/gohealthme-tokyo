-- Coverage for the Apple Health push path, so SPOTTER can judge an Apple
-- player the way it judges a WHOOP player.
--
-- WHY. wearable_days holds one number per wallet, metric and local day. That
-- is enough to pay a hit, and not enough to record a miss: a day with no
-- workouts row means either "no workout that day" or "the phone never read
-- that day", and the miss rule (app/lib/server/agent/miss.ts) refuses to
-- forfeit a stake on absence of data. So an Apple player who missed was always
-- refunded while a WHOOP player on the same challenge lost the stake. Two
-- additions close that gap:
--
--   1. wearable_days gains the wearer's UTC offset (so the challenge window can
--      be placed on their calendar) and a partial flag (a night the phone
--      knows is incomplete, which is never a covered night).
--   2. wearable_sync_days records every LOCAL day the phone read HealthKit
--      for, data or not. A covered day with no workouts row is a real zero; an
--      uncovered day is unknown, and unknown refunds.
--
-- Additive only: no column is dropped or retyped, no row is rewritten, and the
-- RLS posture of wearable_days is unchanged. Rows written by phones built
-- before this migration carry null tz_offset_sec and no coverage, which the
-- server reads as "cannot place on the calendar", the refund-only behaviour
-- they had before.
--
-- Health data note: wearable_sync_days holds no health data. A day the phone
-- covered says nothing about what the person did that day. wearable_days is
-- still the only table here that holds health data.

-- ------------------------------------------------------------ wearable_days

-- The wearer's UTC offset in seconds at the time of the sync that wrote the
-- row. Nullable: a phone built before this migration sends none, and the
-- server then records no miss for that wallet (app/lib/server/agent/miss.ts,
-- basis tz-unknown). Bounded to the offsets that exist on Earth plus slack.
alter table public.wearable_days
  add column if not exists tz_offset_sec integer;

alter table public.wearable_days
  drop constraint if exists wearable_days_tz_offset_sec_check;
alter table public.wearable_days
  add constraint wearable_days_tz_offset_sec_check
    check (tz_offset_sec is null or (tz_offset_sec between -50400 and 50400));

-- True when the phone knows this day's value is incomplete: for sleep, a
-- night the sleep stitcher could not close (no data for part of it, or only
-- a nap). A partial night still counts toward a pass when its value clears
-- the bar; it never counts as covered for a miss.
alter table public.wearable_days
  add column if not exists partial boolean not null default false;

comment on column public.wearable_days.tz_offset_sec is
  'The wearer''s UTC offset in seconds when the phone synced this row (-50400..50400). Null from phone builds that predate coverage; a null offset means the miss rule cannot place the challenge window on the wearer''s calendar and records nothing.';
comment on column public.wearable_days.partial is
  'True when the phone knows this day''s value is incomplete (a sleep night it could not close). Counts toward a pass when the value clears the bar; never counts as a covered night for a miss.';

-- -------------------------------------------------------- wearable_sync_days

-- Every LOCAL day the paired phone read HealthKit for, whether or not any
-- metric had data that day. One row per wallet per day; a re-sync bumps
-- synced_at and refreshes the offset.
create table if not exists public.wearable_sync_days (
  address text not null,
  day date not null,
  tz_offset_sec integer,
  synced_at timestamptz not null default now(),

  constraint wearable_sync_days_pkey primary key (address, day),

  -- Lowercase 0x address, matching wearable_days.
  constraint wearable_sync_days_address_check
    check (address ~ '^0x[0-9a-f]{40}$'),

  constraint wearable_sync_days_tz_offset_sec_check
    check (tz_offset_sec is null or (tz_offset_sec between -50400 and 50400)),

  -- A phone cannot have covered a day that has not started anywhere on Earth.
  -- One day of slack for a device ahead of UTC, same as wearable_days.
  constraint wearable_sync_days_day_check
    check (day <= (now() at time zone 'utc')::date + 1)
);

-- Same posture as wearable_days: RLS on, no policies, service role is the
-- only reader and writer, behind the device token the sync route checks.
alter table public.wearable_sync_days enable row level security;

revoke all on table public.wearable_sync_days from anon, authenticated;
grant all on table public.wearable_sync_days to service_role;

comment on table public.wearable_sync_days is
  'Local days the paired iPhone read Apple Health for, data or not. One row per wallet per day. Holds no health data: a covered day says nothing about what the wearer did. Read by the miss rule to tell "no workout that day" (covered, no row) from "the phone did not sync that day" (uncovered), which refunds. Service-role only; no anon policy. Swept with wearable_days.';
comment on column public.wearable_sync_days.address is
  'Lowercase 0x wallet address. Public value (appears on chain).';
comment on column public.wearable_sync_days.day is
  'The WEARER''S LOCAL calendar day the phone covered, keyed like wearable_days.day.';
comment on column public.wearable_sync_days.tz_offset_sec is
  'The wearer''s UTC offset in seconds at that sync (-50400..50400), or null from a phone build that predates coverage.';
comment on column public.wearable_sync_days.synced_at is
  'When the phone last reported this day as covered.';

-- The read is "one wallet, a date window", which the primary key serves in
-- that column order. No second index.

-- ---------------------------------------------------------------- retention

-- The same sweep, now over both tables. Same name and signature, so the cron
-- (app/app/api/cron/wearable-retention/route.ts) needs no change; the return
-- is the total rows removed across both.
create or replace function public.sweep_wearable_days(older_than_days integer default 120)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with deleted_days as (
    delete from public.wearable_days
    where day < (now() at time zone 'utc')::date - older_than_days
    returning 1
  ),
  deleted_coverage as (
    delete from public.wearable_sync_days
    where day < (now() at time zone 'utc')::date - older_than_days
    returning 1
  )
  select (select count(*) from deleted_days)::integer
       + (select count(*) from deleted_coverage)::integer;
$$;

comment on function public.sweep_wearable_days is
  'Deletes wearable aggregates and coverage days older than the retention window (default 120 days, comfortably past the longest challenge period). Returns the number of rows removed across wearable_days and wearable_sync_days.';

revoke execute on function public.sweep_wearable_days(integer) from public, anon, authenticated;
grant execute on function public.sweep_wearable_days(integer) to service_role;
