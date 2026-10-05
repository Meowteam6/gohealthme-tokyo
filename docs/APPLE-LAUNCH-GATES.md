# Apple Watch launch: what only Andre and Nikki can do

Everything in code is being built. These are the gates no session can open. Nothing here is pasted into chat; keys go into the files named.

## Nikki (Apple Developer Program owner)

1. **Invite Andre to the team.** App Store Connect > Users and Access > add Andre's Apple ID with the **Admin** role (Developer is enough to build, Admin lets him create the app record and testers without waiting on you). Tell him the **Team ID** (Membership details page, 10 characters).
2. **App Store Connect API key** for unattended submits. Users and Access > Integrations > App Store Connect API > Generate, role **App Manager**. Download the `.p8` once (Apple never shows it again) and send it to Andre privately, with the **Key ID** and **Issuer ID**.
3. That is all. Everything else (bundle ID, app record, TestFlight groups) Andre does as Admin.

## Andre

Verified on this Mac 2026-10-06: Vercel CLI and MCP are logged in (env vars and deploys are the session's job), Supabase CLI is logged in and linked to gohealthme-tokyo (the migration push is the session's job). Only two things are yours:

1. **Expo account.** Create one at expo.dev if you do not have one, then on this Mac:
   `cd ~/Desktop/eth/gohealthme-tokyo-hotfix/mobile && npx eas-cli login`
   After that the session runs `eas init`, the builds and the submits.
2. **The `.p8` from Nikki** goes to `mobile/.secrets/AuthKey_<KEY_ID>.p8` (git-ignored). Then fill `mobile/.env.submit` (git-ignored), values only:
   - `EXPO_APPLE_API_KEY_PATH=` the path above
   - `EXPO_APPLE_API_KEY_ID=` from Nikki
   - `EXPO_APPLE_API_ISSUER_ID=` from Nikki

The session does the rest: bundle ID and app record (as Admin on Nikki's team, via `eas credentials`), build, submit, TestFlight internal group, prod env flags, redeploy, test-row cleanup.

**Device QA with your iPhone and Watch**, the only proof that counts: pair from the site on the phone (count the taps), allow Health, see the sync count, see the site flip to paired; sleep one night without opening the app and confirm the night landed; join a sleep challenge on prod and let SPOTTER verify it.
