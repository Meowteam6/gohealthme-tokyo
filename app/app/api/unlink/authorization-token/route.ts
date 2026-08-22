// POST /api/unlink/authorization-token
// Issues a short-lived capability token scoped to a user's Unlink address.
// Called automatically by the browser SDK (DEFAULT_AUTHORIZATION_TOKEN_URL).
import { unlinkAuthRoutes } from "@/lib/server/unlink-admin";

export async function POST(request: Request): Promise<Response> {
  const handlers = unlinkAuthRoutes();
  return handlers.authorizationToken(request);
}
