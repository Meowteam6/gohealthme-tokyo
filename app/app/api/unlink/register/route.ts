// POST /api/unlink/register
// Registers a user's wallet-derived Unlink account with the engine.
// Called automatically by the browser SDK (DEFAULT_REGISTER_URL) when
// client.ensureRegistered() runs for the first time.
import { unlinkAuthRoutes } from "@/lib/server/unlink-admin";

export async function POST(request: Request): Promise<Response> {
  const handlers = unlinkAuthRoutes();
  return handlers.register(request);
}
