// Apple Watch device QA, server side. Run while Andre (or any tester) walks
// the device loop; it reports what has actually landed for one wallet:
//   cd app && node --env-file=.env.local scripts/apple-device-qa.mjs 0xWALLET [poolId]
// Reads only. Never prints a secret.
import { createClient } from "@supabase/supabase-js";
const [addressArg, poolArg] = process.argv.slice(2);
if (!addressArg || !/^0x[0-9a-fA-F]{40}$/.test(addressArg)) { console.error("usage: apple-device-qa.mjs 0xWALLET [poolId]"); process.exit(2); }
const address = addressArg.toLowerCase();
const sb = createClient(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const row = (ok, label, detail) => console.log(`${ok === null ? "WAIT" : ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${detail}`);

// 1. Pairing: the redeem writes a device record keyed by token hash plus a per-wallet pointer in the KV store.
const kvUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL, kvTok = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
async function kv(cmd) { if (!kvUrl) return null; const r = await fetch(kvUrl, { method: "POST", headers: { Authorization: `Bearer ${kvTok}`, "content-type": "application/json" }, body: JSON.stringify(cmd) }); return (await r.json()).result; }
const pointer = kvUrl ? await kv(["GET", `apple-device-for:${address}`]) : "n/a (no KV in this env file; prod KV is separate)";
row(kvUrl ? (pointer ? true : null) : null, "1 phone paired (device record)", kvUrl ? (pointer ? "a device token is bound to this wallet" : "no device yet: the app has not redeemed a code") : String(pointer));
const provider = kvUrl ? await kv(["GET", `wearable-provider:${address}`]) : null;
row(kvUrl ? (provider && String(provider).includes("apple") ? true : null) : null, "2 provider pinned to apple", provider ? String(provider).slice(0, 80) : "not yet: pinned on the first stored sync");

// 2. Sync: coverage and daily rows.
const { data: cov } = await sb.from("wearable_sync_days").select("day,tz_offset_sec,synced_at").eq("address", address).order("day", { ascending: false }).limit(40);
row(cov && cov.length ? true : null, "3 coverage rows (days phone read)", cov && cov.length ? `${cov.length} days, newest ${cov[0].day}, tz ${cov[0].tz_offset_sec}s, synced ${cov[0].synced_at}` : "none yet");
const { data: days } = await sb.from("wearable_days").select("metric,day,value,partial").eq("address", address).order("day", { ascending: false }).limit(200);
const byMetric = {}; for (const d of days ?? []) (byMetric[d.metric] ??= []).push(d);
row(days && days.length ? true : null, "4 daily totals stored", days && days.length ? Object.entries(byMetric).map(([m, r]) => `${m}:${r.length}`).join(" ") : "none yet");
for (const m of ["sleep_hours", "sleep_efficiency", "workouts"]) { const r = byMetric[m]; if (r) console.log(`      ${m}: ` + r.slice(0, 5).map(x => `${x.day}=${x.value}${x.partial ? "(partial)" : ""}`).join(", ")); }

// 3. Prod answers for this wallet (public reads only).
const base = process.env.QA_BASE ?? "https://gohealthme-tokyo.vercel.app";
const prov = await (await fetch(`${base}/api/wearable/providers`)).json().catch(() => ({}));
const apple = (prov.providers ?? []).find(p => p.id === "apple");
row(apple?.configured === true, "5 prod offers Apple Watch", apple ? `configured=${apple.configured} metrics=${(apple.metrics ?? []).join(",")}` : "providers route unreachable");

// 4. Chain: did the wallet join the pool?
if (poolArg) {
  const { createPublicClient, http, getAddress } = await import("viem"); const { baseSepolia } = await import("viem/chains");
  const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || undefined) });
  const pools = process.env.NEXT_PUBLIC_HEALTH_POOLS_ADDRESS;
  const abi = [{ type: "function", name: "participantCount", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] }, { type: "function", name: "participants", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "address" }] }];
  try {
    const n = await client.readContract({ address: pools, abi, functionName: "participantCount", args: [BigInt(poolArg)] });
    let joined = false; for (let i = 0n; i < n; i++) { const a = await client.readContract({ address: pools, abi, functionName: "participants", args: [BigInt(poolArg), i] }); if (a.toLowerCase() === address) joined = true; }
    row(joined ? true : null, `6 joined pool ${poolArg} on chain`, joined ? `yes (${n} in)` : `not yet (${n} in)`);
  } catch (e) { row(null, `6 joined pool ${poolArg} on chain`, "could not read participants: " + String(e.message).slice(0, 80)); }
}
console.log("\nNext in the loop after a hit: the verdict shows on the challenge page; the sweep records it on the cron. Re-run this to watch rows land.");
