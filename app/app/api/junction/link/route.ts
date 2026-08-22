// POST /api/junction/link
// Body: { address }
// Returns: { userId, linkUrl } — open linkUrl in the browser to connect a
// health-data provider (WHOOP, Oura, Fitbit, Garmin, …) via Junction Link.

import { isAddress } from "viem";
import { createLinkToken } from "@/lib/server/junction";
import { errorMessage, jsonError, readJsonBody } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch (err) {
      return jsonError(400, errorMessage(err));
    }
    const { address } = body;
    if (typeof address !== "string" || !isAddress(address)) {
      return jsonError(400, "address must be a valid 0x address");
    }
    const { userId, linkUrl } = await createLinkToken(address);
    return Response.json({ userId, linkUrl });
  } catch (err) {
    return jsonError(502, errorMessage(err));
  }
}
