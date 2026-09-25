-- First-run feedback from /api/feedback (app/app/api/feedback/route.ts).
--
-- NO HEALTH DATA. An optional wallet address, a coarse rating, a free-text
-- note, and the page it came from. The route accepts nothing else.
--
-- Shapes mirror the route's validation:
--   rating   'easy' | 'confusing' | null
--   message  trimmed, <= 1000 chars, null when empty
--   address  lowercase 0x hex or null
--   page     <= 200 chars or null
--   at least one of rating / message (the route 400s otherwise)
--
-- Access model: RLS on, NO policies, no anon/authenticated grants. The
-- service role (which bypasses RLS) is the only writer; the founder reads it
-- in the Supabase dashboard. Free text from strangers must never be readable
-- with the publishable key.

create table if not exists public.feedback (
  id bigint generated always as identity,
  address text,
  rating text,
  message text,
  page text,
  created_at timestamptz not null default now(),

  constraint feedback_pkey primary key (id),
  constraint feedback_address_check
    check (address is null or address ~ '^0x[0-9a-f]{40}$'),
  constraint feedback_rating_check
    check (rating is null or rating in ('easy', 'confusing')),
  constraint feedback_message_check
    check (message is null or char_length(message) <= 1000),
  constraint feedback_page_check
    check (page is null or char_length(page) <= 200),
  constraint feedback_has_content_check
    check (rating is not null or message is not null)
);

alter table public.feedback enable row level security;

revoke all on table public.feedback from anon, authenticated;
grant all on table public.feedback to service_role;

comment on table public.feedback is
  'First-run feedback. Service-role only (RLS on, no policies, no anon grants). NO health data.';
