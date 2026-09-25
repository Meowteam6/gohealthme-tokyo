-- Social profiles: the public identity a wallet claims. A wallet address, a
-- handle, an optional avatar glyph. Read by app/lib/server/social-profile.ts.
--
-- NO HEALTH DATA. There is no health column in this table and none may be
-- added: every row is readable by anyone holding the anon key, by design,
-- because /u/<handle> and every display name in the feed resolve from here.
-- On-chain stats (wins, USDC) are derived live, never stored here.
--
-- Shapes mirror app/lib/social.ts, which validates before any write:
--   address  lowercase 0x hex, the primary key (upsert onConflict: "address")
--   handle   lowercase [a-z0-9_]{3,20}, unique. claimHandle() maps the 23505
--            unique_violation on this constraint to "That handle is already
--            taken", so handle must be the ONLY unique besides the key.
--   emoji    nullable, <= 16 code points (JS [...s].length == char_length)
-- Reserved handles are enforced in the app only (RESERVED_HANDLES).
--
-- Access model:
--   - anon / authenticated: SELECT only (policy below). No write policy and
--     no write grant, so the publishable key can never insert or edit.
--   - service_role: the single writer, used only behind an EIP-191 signature
--     that proves control of the address being written (/api/social/handle).

create table if not exists public.profiles (
  address text not null,
  handle text not null,
  emoji text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_pkey primary key (address),
  constraint profiles_handle_key unique (handle),
  constraint profiles_address_check check (address ~ '^0x[0-9a-f]{40}$'),
  constraint profiles_handle_check
    check (handle = lower(handle) and handle ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_emoji_check
    check (emoji is null or char_length(emoji) <= 16)
);

alter table public.profiles enable row level security;

-- Table privileges are explicit rather than inherited from project defaults,
-- so the posture does not depend on the Data API "auto-expose" setting.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant all on table public.profiles to service_role;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

comment on table public.profiles is
  'Public wallet identity: address, handle, avatar glyph. Anon SELECT only; service role is the single writer behind an EIP-191 signature. NO health data.';
comment on column public.profiles.handle is
  'Canonical lowercase handle, unique across wallets. Also minted as <handle>.gohealthme.eth on ENSv2 Sepolia (best effort); this row is the cache.';
