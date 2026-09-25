import { describe, it, expect, vi, beforeEach } from "vitest";

// The retention cron is the only thing that enforces the 120-day promise on
// wearable_days, so its auth, its success path and its failure path are pinned.

const rpc = vi.fn();
let client: { rpc: typeof rpc } | null = { rpc };

vi.mock("@/lib/server/supabase", () => ({
  getSupabaseServiceRole: () => client,
}));

async function load() {
  vi.resetModules();
  return import("@/app/api/cron/wearable-retention/route");
}

function req(auth?: string) {
  return new Request("http://x/api/cron/wearable-retention", {
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "s3cret");
  rpc.mockReset();
  client = { rpc };
});

describe("wearable retention cron", () => {
  it("refuses without the cron secret and never touches the database", async () => {
    const { GET } = await load();
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("runs the 120-day sweep and reports the rows removed", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const { GET } = await load();
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 3 });
    expect(rpc).toHaveBeenCalledWith("sweep_wearable_days", { older_than_days: 120 });
  });

  it("fails loudly with a reference when the sweep errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { POST } = await load();
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Retention sweep failed/);
    expect(body.error).not.toMatch(/permission denied/);
  });

  it("is a no-op when the deployment has no database", async () => {
    client = null;
    const { GET } = await load();
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: expect.any(String) });
  });
});
