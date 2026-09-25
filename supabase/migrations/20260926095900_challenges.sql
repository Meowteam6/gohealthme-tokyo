-- Peer challenges ("dares"): the one off-chain row that makes an on-chain pool
-- "aimed at a person". An unguessable invite token, the challenger's framing
-- message and an optional target handle, keyed to the pool it belongs to.
--
-- NO HEALTH DATA. The goal ("lose 10 lbs") lives on-chain in the pool goalSpec
-- and is read live from the chain by the /c/<token> landing. It is never copied
-- here. message is the challenger's own text; target_handle is a display label.
--
-- WHY contract_address. V3 created this table keyed on pool_id alone, with
-- pool_id unique. Pool ids are per contract and restart at 1 on every
-- HealthPoolsV3 deploy, so the same database serving two contracts (V3's pilot
-- pool and V4's Tokyo pool) would collide on pool N, hand a V3 invite token to
-- a V4 pool, and 409 a V4 dare whose money already moved. Every row now names
-- the contract it belongs to, uniqueness is (contract_address, pool_id), and
-- app/lib/server/challenges.ts scopes every read and write to the configured
-- HEALTH_POOLS_ADDRESS.
--
-- Safe on either target:
--   - a fresh Supabase project: creates the table with the V4 shape.
--   - a project that already has V3's table (lynhrbkspjsmqzywfhht): adds the
--     column, tags every existing row as V3's (they were all written against
--     the V3 pool), and swaps unique(pool_id) for unique(contract_address,
--     pool_id). The column default is the V3 address so the frozen V3 app,
--     which inserts without the column, keeps writing correctly-tagged rows.
--     V4 always writes contract_address explicitly and never relies on it.
--     Prefer V4's own project: V3's frozen reads are not scoped, so once V4
--     rows share its table, V3's pool-id lookup can meet two rows for pool N.
--
-- Security posture is unchanged from V3: RLS on, no policies. The service role
-- (which bypasses RLS) is the only reader and writer, and it is used only
-- behind an EIP-191 signature (writes) or the exact invite token (reads). Anon
-- cannot enumerate the table.
--
-- Committed 2026-09-26. NOT applied by the session that wrote it: apply with
-- `supabase db push` or the SQL editor against the project V4 points at.

create table if not exists public.challenges (
  invite_token text not null,
  pool_id bigint not null,
  challenger_address text not null,
  target_handle text,
  message text,
  created_at timestamptz not null default now(),

  constraint challenges_pkey primary key (invite_token),
  constraint challenges_invite_token_check
    check (invite_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  constraint challenges_pool_id_check check (pool_id > 0),
  constraint challenges_challenger_address_check
    check (challenger_address ~ '^0x[0-9a-f]{40}$'),
  constraint challenges_target_handle_check
    check (target_handle is null or char_length(target_handle) <= 40),
  constraint challenges_message_check
    check (message is null or char_length(message) <= 280)
);

-- The contract the pool lives on. Lowercase 0x hex, like every address here.
-- Default = the V3 Base Sepolia HealthPoolsV3, which is also the correct tag
-- for every row that predates this column.
alter table public.challenges
  add column if not exists contract_address text not null
  default '0x66815e3ac541eb18d01d2aed25d0d9779583d832';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'challenges_contract_address_check'
      and conrelid = 'public.challenges'::regclass
  ) then
    alter table public.challenges
      add constraint challenges_contract_address_check
      check (contract_address ~ '^0x[0-9a-f]{40}$');
  end if;
end
$$;

-- Drop any unique constraint on pool_id ALONE (V3's name is not guaranteed, so
-- it is found by shape rather than by name), then key on the pair.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.challenges'::regclass
      and con.contype = 'u'
      and array_length(con.conkey, 1) = 1
      and con.conkey[1] = (
        select attnum from pg_attribute
        where attrelid = 'public.challenges'::regclass and attname = 'pool_id'
      )
  loop
    execute format('alter table public.challenges drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'challenges_contract_address_pool_id_key'
      and conrelid = 'public.challenges'::regclass
  ) then
    alter table public.challenges
      add constraint challenges_contract_address_pool_id_key
      unique (contract_address, pool_id);
  end if;
end
$$;

-- "Invited to you" looks rows up by target handle within one contract.
create index if not exists challenges_contract_target_idx
  on public.challenges (contract_address, target_handle)
  where target_handle is not null;

alter table public.challenges enable row level security;

-- Explicit privileges: service role is the only reader and writer.
revoke all on table public.challenges from anon, authenticated;
grant all on table public.challenges to service_role;

comment on table public.challenges is
  'Peer challenges: one row per challenge pool, keyed (contract_address, pool_id). Invite token is a bearer capability for the /c/<token> landing. NO health data: the goal lives on-chain. Service-role only (RLS on, no policies).';
comment on column public.challenges.contract_address is
  'Lowercase HealthPoolsV3 address the pool lives on. Pool ids restart per deploy, so this is half of the key. The app scopes every read and write to its configured HEALTH_POOLS_ADDRESS.';
comment on column public.challenges.invite_token is
  'Unguessable URL-safe token (192 bits). Possession grants the read; never exposed on a public path.';
comment on column public.challenges.target_handle is
  'Optional canonical @handle (no @, lowercase) the dare was aimed at. Display label only.';
comment on column public.challenges.message is
  'The challenger''s own framing text, rendered as-is on the landing. Never a copy of the goal.';
