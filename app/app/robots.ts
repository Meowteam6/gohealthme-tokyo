import type { MetadataRoute } from "next";
import { CRAWL_DISALLOW, SITE_URL } from "@/lib/site";

// Served at /robots.txt. Allow-all with the private surface carved out; the
// page-level noindex on each of those routes is the second line of defence.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...CRAWL_DISALLOW],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
