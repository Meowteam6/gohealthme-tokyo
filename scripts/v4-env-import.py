#!/usr/bin/env python3
"""Set the V4 Vercel project's env (production + preview) from sources that hold real values.

Run by a founder from their own terminal (sessions may not write secrets into
Vercel). V3's Vercel secrets are Sensitive and come back EMPTY on `vercel env
pull`, so they cannot be copied; this script uses what exists locally instead:

  - app/.env.local of V4 (Dynamic env id, oracle key, Circle ids)
  - contracts/.env PRIVATE_KEY (the 0xc278 deployer) as treasury and ENS owner
  - the Supabase CLI for the GoHealthMe project's URL and keys
  - generated values (CRON_SECRET) and known constants (Junction sandbox host)

Anything that is missing or still a placeholder is listed at the end as a
founder action. Prints names only, never values.
"""
import json
import os
import re
import secrets
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
SUPABASE_REF = "lynhrbkspjsmqzywfhht"  # the GoHealthMe project (testnet handles only)
SPOTTER_SETTLER = "0x5BECa2BCe03ef2D8d91091744b2CfD6d1A5cd483"  # Circle EOA, read from V3 chain

# Shape checks so a placeholder is never pushed as if it were real.
SHAPES = {
    "ORACLE_SIGNER_PRIVATE_KEY": r"^(0x)?[0-9a-fA-F]{64}$",
    "TREASURY_PRIVATE_KEY": r"^(0x)?[0-9a-fA-F]{64}$",
    "ENS_OWNER_PRIVATE_KEY": r"^(0x)?[0-9a-fA-F]{64}$",
    "CIRCLE_API_KEY": r"^(TEST|LIVE)_API_KEY:[0-9a-f]+:[0-9a-f]+$",
    "CIRCLE_ENTITY_SECRET": r"^[0-9a-fA-F]{64}$",
    "CIRCLE_WALLET_ID": r"^[0-9a-f-]{36}$",
    "CIRCLE_WALLET_SET_ID": r"^[0-9a-f-]{36}$",
    "CDP_API_KEY_ID": r"^[0-9a-f-]{36}$",
    "HEALTH_POOLS_ADDRESS": r"^0x(?!66815e3AC541eB18d01D2aed25D0D9779583D832)[0-9a-fA-F]{40}$",
    "NEXT_PUBLIC_HEALTH_POOLS_ADDRESS": r"^0x(?!66815e3AC541eB18d01D2aed25D0D9779583D832)[0-9a-fA-F]{40}$",
    "ENS_AGENT_PRIVATE_KEY": r"^(0x)?[0-9a-fA-F]{64}$",
    "NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID": r"^[0-9a-f-]{36}$",
}


def parse(path):
    """Parse a dotenv file into a dict; missing file gives {}."""
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8"):
        m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line.rstrip("\n"))
        if m:
            key, val = m.groups()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                val = val[1:-1]
            out[key] = val.strip()
    return out


def supabase_values():
    """URL and keys for the GoHealthMe Supabase project via the CLI."""
    r = subprocess.run(
        ["supabase", "projects", "api-keys", "--project-ref", SUPABASE_REF, "-o", "json"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return {}
    keys = {k.get("name"): k.get("api_key") for k in json.loads(r.stdout)}
    url = f"https://{SUPABASE_REF}.supabase.co"
    return {
        "NEXT_PUBLIC_SUPABASE_URL": url,
        "SUPABASE_URL": url,
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": keys.get("anon", ""),
        "SUPABASE_ANON_KEY": keys.get("anon", ""),
        "SUPABASE_SERVICE_ROLE_KEY": keys.get("service_role", ""),
    }


def main():
    local = parse(os.path.join(APP, ".env.local"))
    deployer = parse(os.path.join(ROOT, "contracts", ".env")).get("PRIVATE_KEY", "")
    want = {
        "NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID": local.get("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID", ""),
        "ORACLE_SIGNER_PRIVATE_KEY": local.get("ORACLE_SIGNER_PRIVATE_KEY", ""),
        "CIRCLE_API_KEY": local.get("CIRCLE_API_KEY", ""),
        "CIRCLE_ENTITY_SECRET": local.get("CIRCLE_ENTITY_SECRET", ""),
        "CIRCLE_WALLET_ID": local.get("CIRCLE_WALLET_ID", ""),
        "CIRCLE_WALLET_SET_ID": local.get("CIRCLE_WALLET_SET_ID", ""),
        "SPOTTER_WALLET_ADDRESS": SPOTTER_SETTLER,
        "TREASURY_PRIVATE_KEY": deployer,
        "ENS_OWNER_PRIVATE_KEY": deployer,
        "ENS_AGENT_PRIVATE_KEY": local.get("ENS_AGENT_PRIVATE_KEY", ""),
        "CRON_SECRET": secrets.token_urlsafe(32),
        "WEARABLE_PROVIDER_DEFAULT": "junction",
        "JUNCTION_ENV": "sandbox",
        "JUNCTION_REGION": "us",
        "JUNCTION_API_KEY": local.get("JUNCTION_API_KEY", ""),
        "INTERCEPTA_API_KEY": local.get("INTERCEPTA_API_KEY", ""),
        "HEALTH_POOLS_ADDRESS": local.get("HEALTH_POOLS_ADDRESS", ""),
        "NEXT_PUBLIC_HEALTH_POOLS_ADDRESS": local.get("NEXT_PUBLIC_HEALTH_POOLS_ADDRESS", ""),
        "HEALTH_POOLS_FROM_BLOCK": local.get("HEALTH_POOLS_FROM_BLOCK", ""),
        "NEXT_PUBLIC_HEALTH_POOLS_FROM_BLOCK": local.get("NEXT_PUBLIC_HEALTH_POOLS_FROM_BLOCK", ""),
        "CDP_API_KEY_ID": local.get("CDP_API_KEY_ID", ""),
        "CDP_API_KEY_SECRET": local.get("CDP_API_KEY_SECRET", ""),
        "NEXT_PUBLIC_CDP_PAYMASTER_URL": local.get("NEXT_PUBLIC_CDP_PAYMASTER_URL", ""),
        "GOOGLE_CLOUD_PROJECT": local.get("GOOGLE_CLOUD_PROJECT", ""),
        "GOOGLE_CREDENTIALS_JSON": local.get("GOOGLE_CREDENTIALS_JSON", ""),
        "WORLD_APP_ID": local.get("WORLD_APP_ID", ""),
        "WORLD_RP_ID": local.get("WORLD_RP_ID", ""),
        "WORLD_RP_SIGNING_KEY": local.get("WORLD_RP_SIGNING_KEY", ""),
        "WORLD_VERIFY_MODE": local.get("WORLD_VERIFY_MODE", ""),
        "WORLD_APPROVAL_MODE": local.get("WORLD_APPROVAL_MODE", ""),
        "WORLD_ENVIRONMENT": local.get("WORLD_ENVIRONMENT", ""),
        **supabase_values(),
    }
    ok, founder = [], []
    for key, val in sorted(want.items()):
        shape = SHAPES.get(key)
        if not val or (shape and not re.match(shape, val)):
            founder.append(key)
            continue
        for env in ("production", "preview"):
            r = subprocess.run(
                ["vercel", "env", "add", key, env, "--force"],
                cwd=APP, input=val, text=True, capture_output=True,
            )
            if r.returncode != 0:
                founder.append(f"{key} ({env}): vercel refused")
                break
        else:
            ok.append(key)
    print(f"set on production + preview: {len(ok)}")
    for k in ok:
        print("  ok   " + k)
    print(f"\nstill needed from you: {len(founder)}")
    for k in founder:
        print("  TODO " + k)
    sys.exit(0)


if __name__ == "__main__":
    main()
