import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  CRAWL_DISALLOW,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  PUBLIC_PATHS,
  SITE_URL,
} from "@/lib/site";

// The head copy and the crawl surface are a contract with search and answer
// engines. These pin the parts a refactor could silently break: the title
// budget, the testnet qualifier, and the public/private split between the
// sitemap and robots.txt.

describe("site head copy", () => {
  it("keeps the default title inside the 60-character result budget", () => {
    expect(DEFAULT_TITLE.length).toBeLessThanOrEqual(60);
    expect(DEFAULT_TITLE.startsWith("GoHealthMe")).toBe(true);
  });

  it("keeps the default description honest about testnet and under 160", () => {
    expect(DEFAULT_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(DEFAULT_DESCRIPTION).toMatch(/testnet/i);
    expect(DEFAULT_DESCRIPTION).toMatch(/Base Sepolia/);
  });

  it("never uses wagering language anywhere in the shared copy", () => {
    for (const text of [DEFAULT_TITLE, DEFAULT_DESCRIPTION]) {
      expect(text).not.toMatch(/\b(bet|wager|odds)\b/i);
    }
  });

  it("never promises an instant payout (the run settles at its end)", () => {
    for (const text of [DEFAULT_TITLE, DEFAULT_DESCRIPTION]) {
      expect(text).not.toMatch(/\b(instant|the second)\b/i);
    }
  });
});

describe("robots.txt", () => {
  it("allows the root, blocks every private prefix, and points at the sitemap", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules.userAgent).toBe("*");
    expect(rules.allow).toBe("/");
    expect(rules.disallow).toEqual([...CRAWL_DISALLOW]);
    expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });

  it("does not disallow any public path", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    const disallow = rules.disallow as string[];
    for (const path of PUBLIC_PATHS) {
      expect(disallow).not.toContain(path);
    }
  });
});

describe("sitemap.xml", () => {
  it("lists exactly the public pages as absolute www URLs", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      "https://www.gohealthme.app",
      "https://www.gohealthme.app/pools",
      "https://www.gohealthme.app/feed",
      "https://www.gohealthme.app/privacy",
      "https://www.gohealthme.app/terms",
    ]);
  });

  it("never lists a private, person-aimed, or API URL", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const url of urls) {
      const path = url.replace(SITE_URL, "") || "/";
      for (const blocked of CRAWL_DISALLOW) {
        expect(path.startsWith(blocked)).toBe(false);
      }
    }
  });
});
