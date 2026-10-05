# Apple Watch launch: what only Andre and Nikki can do

Everything in code is being built. These are the gates no session can open. Nothing here is pasted into chat; keys go into the files named.

## Nikki (Apple Developer Program owner)

1. **Invite Andre to the team.** App Store Connect > Users and Access > add Andre's Apple ID with the **Admin** role (Developer is enough to build, Admin lets him create the app record and testers without waiting on you). Tell him the **Team ID** (Membership details page, 10 characters).
2. **App Store Connect API key** for unattended submits. Users and Access > Integrations > App Store Connect API > Generate, role **App Manager**. Download the `.p8` once (Apple never shows it again) and send it to Andre privately, with the **Key ID** and **Issuer ID**.
3. That is all. Everything else (bundle ID, app record, TestFlight groups) Andre does as Admin.

## Andre

1. **Expo account.** Create one at expo.dev if you do not have one, then on this Mac:
   `cd ~/Desktop/eth/gohealthme-tokyo-hotfix/mobile && npx eas-cli login`
2. **Link the project.** Same folder: `npx eas-cli init` (creates the EAS project and writes `extra.eas.projectId` into `app.json`; commit that).
3. **Apple side, once Nikki's invite lands.** `npx eas-cli credentials` picks the team and creates the bundle ID `com.chuabiolabs.gohealthme` with HealthKit, or do it in Xcode > Signing. Create the app "GoHealthMe" in App Store Connect (My Apps > +, bundle ID above).
4. **The `.p8` from Nikki** goes to `mobile/.secrets/AuthKey_<KEY_ID>.p8` (the folder is git-ignored). Then fill, values only, no quotes:
   - `mobile/.env.submit` (git-ignored):
     - `EXPO_APPLE_API_KEY_PATH=` the path above
     - `EXPO_APPLE_API_KEY_ID=` from Nikki
     - `EXPO_APPLE_API_ISSUER_ID=` from Nikki
5. **Build and submit** (the session can run these once 1-4 are done, or you do):
   `npx eas-cli build --platform ios --profile production` then `npx eas-cli submit --platform ios --profile production --latest`
6. **TestFlight.** App Store Connect > TestFlight > Internal Testing > create a group with you and Nikki (no review). Copy the **public link** once the build is processed. External group for beta users goes through Beta App Review (hours to days).
7. **Prod env, Vercel dashboard, project gohealthme-tokyo, Production:**
   - `APPLE_APP_AVAILABLE=1`
   - `APPLE_APP_INSTALL_URL=` the TestFlight public link
   Then redeploy.
8. **Database.** `cd ~/Desktop/eth/gohealthme-tokyo-hotfix && supabase link` (project gohealthme-tokyo) then `supabase db push` for the coverage migration. The session prepares the file; the push needs your login.
9. **Device QA with your iPhone and Watch**, the only proof that counts: pair from the site on the phone (count the taps), allow Health, see the sync count, see the site flip to paired; sleep one night without opening the app and confirm the night landed; join a sleep challenge on prod and let SPOTTER verify it.
