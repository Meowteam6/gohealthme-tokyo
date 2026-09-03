import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE_URL } from "@/lib/site";

// Served at /sitemap.xml. Static: exactly the public pages, never a pool id,
// a challenge link, a profile, or anything under /admin or /api. Listing
// public pool ids from the chain is a deliberate later step, not this one.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PATHS.map((path) => ({
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
    lastModified,
    changeFrequency: "weekly",
  }));
}
