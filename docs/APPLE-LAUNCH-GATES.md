# Apple Watch launch: what only Andre and Nikki can do

Everything in code is being built. These are the gates no session can open. Nothing here is pasted into chat; keys go into the files named.

## Nikki (Apple Developer Program owner)

1. **Invite Andre to the team.** App Store Connect > Users and Access > add Andre's Apple ID with the **Admin** role (Developer is enough to build, Admin lets him create the app record and testers without waiting on you). Tell him the **Team ID** (Membership details page, 10 characters).
2. **App Store Connect API key** for unattended submits. Users and Access > Integrations > App Store Connect API > Generate, role **App Manager**. Download the `.p8` once (Apple never shows it again) and send it to Andre privately, with the **Key ID** and **Issuer ID**.
3. That is all. Everything else (bundle ID, app record, TestFlight groups) Andre does as Admin.

## Andre

Verified on this Mac 2026-10-06: Vercel CLI and MCP logged in; Supabase CLI logged in and linked to gohealthme-tokyo; Xcode 26.6 with the iOS 26.5 SDK, CocoaPods 1.17 and Apple's upload tool (`xcrun altool`) all present. The app builds and uploads from this Mac with no Expo cloud account. Only one thing is yours:

1. **The `.p8` from Nikki** goes to `mobile/.secrets/AuthKey_<KEY_ID>.p8` (git-ignored). Then fill `mobile/.env.submit` (git-ignored), values only:
   - `APPLE_TEAM_ID=` from Nikki
   - `APPLE_API_KEY_ID=` from Nikki
   - `APPLE_API_ISSUER_ID=` from Nikki
   The key path is derived from the Key ID.

The session does the rest, locally: `expo prebuild`, `xcodebuild archive` signed with Nikki's team (automatic signing with the API key, no Apple ID login in Xcode), `xcodebuild -exportArchive` for App Store, `xcrun altool --upload-app` with the same key, then App Store Connect: app record, internal TestFlight group, public link; prod env flags, redeploy, test-row cleanup. `scripts/apple-build.sh` in `mobile/` runs that chain end to end.

**Device QA with your iPhone and Watch**, the only proof that counts: pair from the site on the phone (count the taps), allow Health, see the sync count, see the site flip to paired; sleep one night without opening the app and confirm the night landed; join a sleep challenge on prod and let SPOTTER verify it.
