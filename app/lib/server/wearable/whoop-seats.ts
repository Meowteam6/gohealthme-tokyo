// WHOOP's developer app admits 10 members until WHOOP approves it for
// production. Seats are first come, first served so nobody has to ask:
// reserved wallets (WHOOP_ALLOWED_WALLETS, Andre and Nikki) are always
// admitted and do not use an open seat; everyone else takes one of the
// remaining seats when their WHOOP link completes. When the open seats are
// gone, WHOOP is not offered and the pairing card points to Junction, which
// covers WHOOP straps too. A seat is claimed only once tokens are stored, so
// an abandoned consent screen costs nothing.
import { appendJson, readJsonList } from "@/lib/server/store";
import { whoopAllowedWallets } from "@/lib/server/wearable/whoop-allowlist";

const SEATS_FILE = "whoop-seats.json";
const DEFAULT_SEAT_LIMIT = 10;

function seatLimit(): number {
  const raw = Number.parseInt(process.env.WHOOP_SEAT_LIMIT ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SEAT_LIMIT;
}

async function takenSeats(reserved: readonly string[]): Promise<Set<string>> {
  const all = await readJsonList<string>(SEATS_FILE);
  return new Set(all.map((a) => a.toLowerCase()).filter((a) => !reserved.includes(a)));
}

export interface WhoopSeatStatus {
  allowed: boolean;
  /** Open seats left for new wallets. */
  seatsLeft: number;
}

export async function whoopSeatStatus(address: string | null): Promise<WhoopSeatStatus> {
  const reserved = whoopAllowedWallets();
  const taken = await takenSeats(reserved);
  const open = Math.max(0, seatLimit() - reserved.length);
  const seatsLeft = Math.max(0, open - taken.size);
  if (address === null) return { allowed: false, seatsLeft };
  const a = address.toLowerCase();
  const allowed = reserved.includes(a) || taken.has(a) || seatsLeft > 0;
  return { allowed, seatsLeft };
}

/** Record that this wallet holds a WHOOP seat. Idempotent; reserved wallets
 *  never use an open seat. Call only after the WHOOP tokens are stored. */
export async function claimWhoopSeat(address: string): Promise<void> {
  const a = address.toLowerCase();
  const reserved = whoopAllowedWallets();
  if (reserved.includes(a)) return;
  const taken = await takenSeats(reserved);
  if (taken.has(a)) return;
  await appendJson(SEATS_FILE, a);
}
