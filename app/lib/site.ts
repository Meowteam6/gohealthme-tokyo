// The public origin and the head copy shared by the root layout, robots.ts,
// sitemap.ts, the OG image and the JSON-LD entity. One source, so the host or
// the one-liner cannot drift between them. www is the canonical host: the apex
// 308s to it at the domain layer, outside this repo.
export const SITE_URL = "https://www.gohealthme.app";
export const SITE_NAME = "GoHealthMe";

// Every child title gets this suffix. A layout that sets a plain string title
// resets the template for its own children, so any nested layout that names
// itself must restate this template to keep the suffix on its child routes.
export const TITLE_TEMPLATE = `%s - ${SITE_NAME}`;

// 60 characters. Leads with the name so a result or a share card names the
// product before it names the mechanic.
export const DEFAULT_TITLE =
  "GoHealthMe: stake on your health goal, get paid in USDC";

// Under 160 characters. The grandma one-liner from the landing, then the
// testnet qualifier, so no snippet that mentions money ever reads as real
// money. No "instant": a run pays when it settles at the end of its window.
export const DEFAULT_DESCRIPTION =
  "You can't Venmo your grandma in another country to go for a walk, but you can pay her in USDC when she does. Testnet, play-money USDC on Base Sepolia.";

// The whole indexable surface, and the only URLs the sitemap ever lists. Every
// entry must also render signed out (lib/public-paths.ts), or a crawler and a
// shared link both land on character creation.
export const PUBLIC_PATHS = [
  "/",
  "/pools",
  "/feed",
  "/privacy",
  "/terms",
] as const;

// Everything a crawler must stay out of: the API, the consoles, per-wallet
// pages, and the person-aimed links (/c/ challenge invites, /u/ profiles).
export const CRAWL_DISALLOW = [
  "/api/",
  "/admin",
  "/dashboard",
  "/settings",
  "/goal",
  "/handle",
  "/challenge/",
  "/challenges",
  "/pools/create",
  "/c/",
  "/u/",
] as const;

// Page-level robots override for the routes above. Belt and braces with
// CRAWL_DISALLOW: a Disallow alone does not keep a linked URL out of the index.
export const NOINDEX = { index: false, follow: false } as const;
