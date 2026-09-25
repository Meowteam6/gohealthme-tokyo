# Database (Supabase)

V4 has its own Supabase project: ref `ecuzwwgatvqtuvsivnyi` (us-east-1, name `gohealthme-tokyo`).
Never point V4 at V3's project `lynhrbkspjsmqzywfhht`.

The chain holds pools and money. Supabase holds only the off-chain rows below.

## Tables

| Table | Used by | Holds | Anon key | Service role |
|---|---|---|---|---|
| `profiles` | `app/lib/server/social-profile.ts` | wallet address (PK), unique lowercase handle `[a-z0-9_]{3,20}`, optional emoji | SELECT only (policy `profiles are publicly readable`) | single writer, behind an EIP-191 signature (`/api/social/handle`) |
| `challenges` | `app/lib/server/challenges.ts` | dare invite token (PK), pool id, contract address, challenger, target handle, message; unique `(contract_address, pool_id)` | none | only reader and writer |
| `feedback` | `app/app/api/feedback/route.ts` | optional address, rating `easy`/`confusing`, note (<=1000), page | none | only writer; read in the dashboard |
| `wearable_days` | `app/lib/server/wearable/apple-store.ts` | one aggregate per wallet/metric/day (Apple Health). The only table with health data | none | only reader and writer |

Function: `sweep_wearable_days(older_than_days int default 120)`, security invoker, EXECUTE granted to `service_role` only. Nothing in the app calls it yet; retention is not scheduled.

## RLS posture

- RLS is enabled on every table.
- `profiles` is the only table with a policy (SELECT to `anon, authenticated`). Nothing has a write policy.
- Table privileges are explicit in each migration (`revoke all ... from anon, authenticated`, `grant ... to service_role`), so the posture does not depend on the project's Data API auto-expose setting.
- No health column exists outside `wearable_days`, and that table is unreadable with the publishable key.

Verified on 2026-09-26 against the live project through the REST API: service-role insert/select/delete round trips on `profiles`, `challenges`, `feedback`; anon SELECT on `profiles` works; anon insert/update on every table and anon RPC to the sweep are refused with `42501`; a second wallet claiming a taken handle gets `23505`.

## Migrations

`supabase/migrations/`, applied in filename order:

1. `20260908_wearable_days.sql`
2. `20260926095900_challenges.sql`
3. `20260926100000_profiles.sql`
4. `20260926100100_feedback.sql`

Use 14-digit prefixes for new files. An 8-digit prefix sorts after a 14-digit one from the same day, because `_` sorts after digits.

## Re-apply or apply a new migration

Run from the repo root. The DB password is `SUPABASE_DB_PASSWORD` in `app/.env.local`.

```bash
supabase link --project-ref ecuzwwgatvqtuvsivnyi -p "$SUPABASE_DB_PASSWORD"
cat supabase/.temp/project-ref          # must print ecuzwwgatvqtuvsivnyi
supabase db push --linked --dry-run -p "$SUPABASE_DB_PASSWORD"
supabase db push --linked -p "$SUPABASE_DB_PASSWORD"
supabase migration list --linked -p "$SUPABASE_DB_PASSWORD"
```

Check the link before every push: `supabase/.temp` is gitignored and a clone can still be linked to V3.

## App env

`scripts/v4-env-import.py` pulls the URL and keys for this project from the CLI. Locally, `app/.env.local` carries `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is server-only and must never get a `NEXT_PUBLIC_` name.
