#!/usr/bin/env python3
"""Import V3's production env into the V4 Vercel project (production + preview).

Run by a founder from their own terminal (sessions may not write secrets into
Vercel). Reads V3 via `vercel env pull`, drops what V4 must not inherit, and
pushes each value with `vercel env add`. Prints only names, never values.
"""
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V3_APP = os.path.expanduser("~/Desktop/eth/gohealthme-base/app")
V4_APP = os.path.join(ROOT, "app")

# Never inherit: V3's production database, V3's pool/registry, the beta bypass,
# WHOOP (capped at 10 members), V3's token key (V4 has its own), build noise.
SKIP = re.compile(
    r"^(KV_|REDIS_URL|HEALTH_VERDICT_ADDRESS|HEALTH_POOLS_ADDRESS|"
    r"NEXT_PUBLIC_HEALTH_POOLS_ADDRESS|NEXT_PUBLIC_ACCESS_GATE_DISABLED|WHOOP_|"
    r"WEARABLE_TOKEN_KEY|VERCEL|NX_|TURBO_)"
)


def parse(path):
    """Parse a dotenv file written by `vercel env pull` into a dict."""
    out = {}
    for line in open(path, encoding="utf-8"):
        m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line.rstrip("\n"))
        if not m:
            continue
        key, val = m.groups()
        if len(val) >= 2 and val[0] == val[-1] == '"':
            val = val[1:-1].replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
        out[key] = val
    return out


def main():
    with tempfile.TemporaryDirectory() as tmp:
        pulled = os.path.join(tmp, "v3.env")
        subprocess.run(
            ["vercel", "env", "pull", pulled, "--environment=production", "--yes"],
            cwd=V3_APP, check=True, capture_output=True,
        )
        values = {k: v for k, v in parse(pulled).items() if v and not SKIP.match(k)}
    failed = []
    for key, val in sorted(values.items()):
        for env in ("production", "preview"):
            r = subprocess.run(
                ["vercel", "env", "add", key, env, "--force"],
                cwd=V4_APP, input=val, text=True, capture_output=True,
            )
            status = "ok  " if r.returncode == 0 else "FAIL"
            print(f"{status} {key} ({env})")
            if r.returncode != 0:
                failed.append(f"{key} ({env}): {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'unknown'}")
    print(f"\n{len(values)} variables, {len(failed)} failures")
    for f in failed:
        print("  " + f)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
