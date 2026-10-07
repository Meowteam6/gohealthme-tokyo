// Where a navigation the WebView asks about should go.
//
// The shell shows the GoHealthMe website, and the website links out in three
// different ways that need three different answers:
//
// - Its own pairing link, gohealthme://pair?code=..., used to open this app
//   from Safari. Inside the shell it is already here, so the code is redeemed
//   natively on the spot and the navigation is cancelled.
// - A hop to another app: a wallet scheme (wc:, metamask:, cbwallet:), World
//   App (worldapp:, or IDKit's https://world.org/verify universal link), or a
//   wallet's *.app.link universal link. Loading those inside the WebView
//   would render a web page or nothing; the OS routes them to the app.
// - Everything else stays, including same-frame OAuth redirects (WHOOP's
//   login round trip, Junction's connect page): their cookies live in the
//   WebView's own data store and the redirect back lands on the site.
//
// Requests from inside an iframe (Turnkey's signer, Dynamic's auth) are
// always allowed; the shell only routes the top frame.
//
// Pure, no React Native import, so vitest covers every rule.

import { codeFromUrl } from "../pairing-store";

export interface RouteRequest {
  url: string;
  isTopFrame: boolean;
  navigationType?: string;
}

export type RouteDecision = "allow" | { kind: "pair"; code: string } | { kind: "system"; url: string };

/**
 * What the WebView's own originWhitelist must be for classify to see
 * anything. react-native-webview checks that list before it asks
 * onShouldStartLoadWithRequest; a URL it rejects goes to Linking.canOpenURL,
 * which is always false on iOS without LSApplicationQueriesSchemes, and the
 * navigation is silently dropped. Its default is http and https only, so the
 * pairing link and every wallet or World App scheme would die there. With
 * everything whitelisted, classify is the one gate.
 */
export const ORIGIN_WHITELIST: string[] = ["*"];

/** Pseudo schemes that belong to the document itself, never to another app. */
const DOCUMENT_SCHEMES = new Set(["about", "blob", "data", "javascript"]);

/** Hosts whose /verify path is IDKit's World App anchor. */
const WORLD_HOSTS = new Set(["world.org", "www.world.org", "worldcoin.org", "www.worldcoin.org"]);

function schemeOf(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Lower-cased host (no port, no credentials) of an http(s) URL, or null. */
export function hostOf(url: string): string | null {
  const match = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(url);
  return match?.[1]?.toLowerCase() ?? null;
}

function pathOf(url: string): string {
  const match = /^https?:\/\/[^/?#]*([^?#]*)/i.exec(url);
  return match?.[1] ?? "";
}

export function classify(request: RouteRequest): RouteDecision {
  if (!request.isTopFrame) return "allow";
  const { url } = request;

  const code = codeFromUrl(url);
  if (code !== null) return { kind: "pair", code };

  const scheme = schemeOf(url);
  if (scheme === null) return "allow";
  if (DOCUMENT_SCHEMES.has(scheme)) return "allow";
  if (scheme !== "http" && scheme !== "https") return { kind: "system", url };

  const host = hostOf(url);
  if (host === null) return "allow";
  if (WORLD_HOSTS.has(host) && pathOf(url).startsWith("/verify")) return { kind: "system", url };
  if (host.endsWith(".app.link")) return { kind: "system", url };

  return "allow";
}
