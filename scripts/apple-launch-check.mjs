// Apple Watch launch check: is this deployment ready to offer Apple to players.
//
// One run, one pass/fail table, nothing changed. It answers the questions the
// launch checklist in docs/WEARABLES.md asks before APPLE_APP_AVAILABLE is
// flipped on, and again right after.
//
//   node --env-file=app/.env.local scripts/apple-launch-check.mjs
//   node --env-file=app/.env.local scripts/apple-launch-check.mjs --base https://gohealthme-tokyo.vercel.app
//
// --env-file supplies the Supabase trio, CRON_SECRET and the Apple vars from
// the local env file (never printed; only "set" or "unset" is shown). --base
// is the deployment to probe; the default is the V4 production alias. A
// Vercel preview sits behind SSO and answers 401 with a login page to
// everything; the rows that expect a 401 accept only our own JSON refusal, so
// a protected URL fails them instead of passing by accident. Point --base at
// a URL a browser can open without logging in.
//
// Checks, in order:
//   1. Supabase env present (names only)
//   2. wearable_days reachable through PostgREST with the service role
//   3. wearable_sync_days reachable (the coverage table)
//   4. coverage columns on wearable_days (tz_offset_sec, partial)
//      3 and 4 FAIL as "pending migration" when the coverage migration is not
//      applied: every /api/wearable/apple/sync answers 502 until it lands,
//      because the sync writes the offset and the covered days on every post.
//   5. sweep_wearable_days exists (called with a 100-year window, so it deletes nothing)
//   6. <base>/api/wearable/providers lists apple, and whether it is configured
//   7. APPLE_APP_INSTALL_URL set, https, and answers 2xx (the TestFlight link)
//   8. <base>/api/wearable/apple/pair/redeem answers 400 to a bad code (503 = no store on the deployment)
//   9. <base>/api/wearable/apple/sync answers 401 without a device token
//  10. <base>/api/cron/wearable-retention is deployed and locked (401 without the secret)
//
// Exit code 1 when any check fails; a warning does not fail the run.

const DEFAULT_BASE = "https://gohealthme-tokyo.vercel.app";
const TIMEOUT_MS = 15_000;
const COVERAGE_MIGRATION = "supabase/migrations/20261006000000_wearable_days_coverage.sql";
const PENDING_MIGRATION =
  `pending migration: apply ${COVERAGE_MIGRATION} (recipe in docs/DATABASE.md). ` +
  "Until it lands every /api/wearable/apple/sync answers 502, so no phone can store a day";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

const base = (arg("--base") ?? DEFAULT_BASE).replace(/\/+$/, "");

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
}
const pass = (name, detail) => record(name, "PASS", detail);
const fail = (name, detail) => record(name, "FAIL", detail);
const warn = (name, detail) => record(name, "WARN", detail);

function envSet(name) {
  return (process.env[name] ?? "").trim() !== "";
}

function reason(err) {
  return err instanceof Error ? err.message : String(err);
}

async function http(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body = null;
  const text = await res.text();
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function postgrestCode(body) {
  return typeof body === "object" && body !== null && typeof body.code === "string" ? body.code : null;
}

// PostgREST answers 404 with code PGRST205 for an unknown table, PGRST202 for
// an unknown function, and 400 with 42703 for an unknown column; older
// versions answer 404 with no code.
function postgrestMissing(status, body) {
  if (status === 404) return true;
  const code = postgrestCode(body);
  return code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883" || code === "42703";
}

function postgrestUnexpected(status) {
  if (status === 401 || status === 403) {
    return `${status} from PostgREST: SUPABASE_SERVICE_ROLE_KEY is not this project's service-role key`;
  }
  return `unexpected ${status} from PostgREST`;
}

// Our routes refuse with { error: "..." } (app/lib/server/http.ts jsonError).
// A Vercel-protected deployment refuses with an HTML login page, also as 401,
// which would make the two "must answer 401" rows pass against a deployment
// this script never actually reached. Only a JSON refusal counts.
function ownRefusal(status, body) {
  return status === 401 && typeof body === "object" && body !== null && typeof body.error === "string";
}

const PROTECTED_HINT =
  "401 with no JSON error body: the deployment itself refused the request (Vercel protection?). " +
  "Point --base at a URL a browser opens without a login";

// 1. Supabase env ---------------------------------------------------------
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const supabaseReady = supabaseUrl !== "" && serviceKey !== "";
if (supabaseReady) {
  pass("supabase env", "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set");
} else {
  fail(
    "supabase env",
    `${envSet("NEXT_PUBLIC_SUPABASE_URL") ? "" : "NEXT_PUBLIC_SUPABASE_URL unset. "}${envSet("SUPABASE_SERVICE_ROLE_KEY") ? "" : "SUPABASE_SERVICE_ROLE_KEY unset. "}Pass app/.env.local with --env-file`.trim(),
  );
}

const sbHeaders = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  "content-type": "application/json",
};

/** One PostgREST read; `name` is the row, `query` the path after /rest/v1/. */
async function sbRead(name, query, onOk, onMissing) {
  if (!supabaseReady) return fail(name, "skipped: Supabase env missing");
  try {
    const { status, body } = await http(`${supabaseUrl}/rest/v1/${query}`, { headers: sbHeaders });
    if (status === 200) return pass(name, onOk);
    if (postgrestMissing(status, body)) return fail(name, onMissing);
    return fail(name, postgrestUnexpected(status));
  } catch (err) {
    return fail(name, `Supabase unreachable: ${reason(err)}`);
  }
}

// 2. wearable_days --------------------------------------------------------
await sbRead(
  "wearable_days",
  "wearable_days?select=day&limit=1",
  "table exists, service role can read it",
  "table missing: apply supabase/migrations/20260908_wearable_days.sql",
);

// 3. wearable_sync_days ---------------------------------------------------
await sbRead(
  "wearable_sync_days",
  "wearable_sync_days?select=day&limit=1",
  "coverage table exists, service role can read it",
  PENDING_MIGRATION,
);

// 4. coverage columns -----------------------------------------------------
await sbRead(
  "coverage columns",
  "wearable_days?select=tz_offset_sec,partial&limit=1",
  "wearable_days has tz_offset_sec and partial",
  PENDING_MIGRATION,
);

// 5. sweep_wearable_days --------------------------------------------------
if (supabaseReady) {
  try {
    // A 100-year window deletes nothing; this only proves the function exists
    // and the service role may execute it.
    const { status, body } = await http(`${supabaseUrl}/rest/v1/rpc/sweep_wearable_days`, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({ older_than_days: 36_500 }),
    });
    if (status === 200) {
      pass("sweep_wearable_days", `retention function exists (probe deleted ${typeof body === "number" ? body : 0} rows)`);
    } else if (postgrestMissing(status, body)) {
      fail("sweep_wearable_days", "function missing: re-apply the wearable_days migration");
    } else {
      fail("sweep_wearable_days", postgrestUnexpected(status));
    }
  } catch (err) {
    fail("sweep_wearable_days", `Supabase unreachable: ${reason(err)}`);
  }
} else {
  fail("sweep_wearable_days", "skipped: Supabase env missing");
}

// 6. providers route ------------------------------------------------------
try {
  const { status, body } = await http(`${base}/api/wearable/providers`);
  const providers = typeof body === "object" && body !== null ? body.providers : null;
  const apple = Array.isArray(providers) ? providers.find((p) => p.id === "apple") : undefined;
  if (status === 401 && !ownRefusal(status, body)) {
    fail("providers lists apple", PROTECTED_HINT);
  } else if (status !== 200 || apple === undefined) {
    fail("providers lists apple", `${status} from ${base}/api/wearable/providers${apple === undefined ? ", no apple entry" : ""}`);
  } else if (apple.configured === true) {
    pass("providers lists apple", "configured: true (APPLE_APP_AVAILABLE=1 and a store on the deployment)");
  } else {
    fail(
      "providers lists apple",
      `configured: false. ${typeof apple.note === "string" ? apple.note : "No store, or APPLE_APP_AVAILABLE unset on the deployment"}`,
    );
  }
} catch (err) {
  fail("providers lists apple", `${base} unreachable: ${reason(err)}`);
}

// 7. install URL ----------------------------------------------------------
const installUrl = (process.env.APPLE_APP_INSTALL_URL ?? "").trim();
if (installUrl === "") {
  fail("APPLE_APP_INSTALL_URL", "unset in the env file passed with --env-file (set it in Vercel too: the TestFlight public link)");
} else if (!installUrl.startsWith("https://")) {
  fail("APPLE_APP_INSTALL_URL", "must start with https:// or the app ignores it (appleInstallUrl)");
} else {
  try {
    const { status } = await http(installUrl, { method: "GET" });
    if (status >= 200 && status < 300) pass("APPLE_APP_INSTALL_URL", `${installUrl} answers ${status}`);
    else fail("APPLE_APP_INSTALL_URL", `${installUrl} answers ${status}`);
  } catch (err) {
    fail("APPLE_APP_INSTALL_URL", `${installUrl} unreachable: ${reason(err)}`);
  }
}

// 8. redeem answers 400 ---------------------------------------------------
try {
  const { status, body } = await http(`${base}/api/wearable/apple/pair/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "NOTACODE" }),
  });
  if (status === 400) pass("redeem rejects a bad code", "400, so the pairing store is live on the deployment");
  else if (status === 401 && !ownRefusal(status, body)) fail("redeem rejects a bad code", PROTECTED_HINT);
  else if (status === 503) fail("redeem rejects a bad code", "503: the deployment has no SUPABASE_SERVICE_ROLE_KEY");
  else if (status === 404) fail("redeem rejects a bad code", "404: the pairing route is not on this deployment; deploy the branch that carries feat/apple-pairing");
  else if (status === 429) fail("redeem rejects a bad code", "429: rate limited; wait a minute and run again");
  else fail("redeem rejects a bad code", `unexpected ${status}`);
} catch (err) {
  fail("redeem rejects a bad code", `${base} unreachable: ${reason(err)}`);
}

// 9. sync answers 401 -----------------------------------------------------
try {
  const { status, body } = await http(`${base}/api/wearable/apple/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ days: [{ metric: "steps", day: "2026-01-01", value: 1 }] }),
  });
  if (ownRefusal(status, body)) pass("sync refuses an unpaired phone", "401 without a device token");
  else if (status === 401) fail("sync refuses an unpaired phone", PROTECTED_HINT);
  else if (status === 400) fail("sync refuses an unpaired phone", "400: the deployed sync route predates device-token pairing (it still wants a wallet signature in the body); deploy this branch");
  else if (status === 429) fail("sync refuses an unpaired phone", "429: rate limited; wait a minute and run again");
  else fail("sync refuses an unpaired phone", `unexpected ${status} (an unauthenticated post must never store days)`);
} catch (err) {
  fail("sync refuses an unpaired phone", `${base} unreachable: ${reason(err)}`);
}

// 10. retention cron deployed and locked -----------------------------------
if (!envSet("CRON_SECRET")) warn("CRON_SECRET", "unset in the env file (Vercel needs it for /api/cron/wearable-retention)");
try {
  const { status, body } = await http(`${base}/api/cron/wearable-retention`);
  if (ownRefusal(status, body)) pass("retention cron locked", "401 without the secret; schedule 17 3 * * * in app/vercel.json");
  else if (status === 401) fail("retention cron locked", PROTECTED_HINT);
  else if (status === 404) fail("retention cron locked", "route not deployed");
  else if (status === 500) fail("retention cron locked", "500: CRON_SECRET is unset on the deployment");
  else if (status === 200) fail("retention cron locked", "200 without a secret: the sweep is open to anyone");
  else fail("retention cron locked", `unexpected ${status}`);
} catch (err) {
  fail("retention cron locked", `${base} unreachable: ${reason(err)}`);
}

// Report --------------------------------------------------------------------
const width = Math.max(...results.map((r) => r.name.length));
console.log(`Apple Watch launch check against ${base}\n`);
for (const r of results) {
  console.log(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
}
const failed = results.filter((r) => r.status === "FAIL").length;
const warned = results.filter((r) => r.status === "WARN").length;
console.log(`\n${results.length - failed - warned} pass, ${warned} warn, ${failed} fail`);
process.exit(failed > 0 ? 1 : 0);
