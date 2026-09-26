import type { Metadata, Viewport } from "next";
import { Figtree, Fraunces, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import Header from "@/components/Header";
import HelperWidget from "@/components/HelperWidget";
import { Analytics } from "@vercel/analytics/next";
import AccessGate from "@/components/AccessGate";
import SiteFooter from "@/components/SiteFooter";
import { NIGHT_PALETTE } from "@/lib/night-palette";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
  TITLE_TEMPLATE,
} from "@/lib/site";

// Type system (docs/DESIGN.md, Night Shift): Fraunces sets words (headlines,
// section titles, the wordmark, verdict lines), with its SOFT, WONK and
// optical-size axes so it softens at display sizes. Figtree sets every control,
// all running copy and every number. Geist Mono is for tx hashes and addresses
// only. Words in the serif, numbers in the sans.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Site-wide head defaults. Every route inherits these and overrides only what
// it needs (title, description, canonical, robots). metadataBase turns every
// relative URL below and in child routes into an absolute www URL. The title
// template applies to child segments only, so the landing keeps the default.
// openGraph.url is "./" on purpose: Next resolves it against the current
// pathname, so each page's share card points at itself, not at the landing.
// The OG and Twitter images come from app/opengraph-image.tsx.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: TITLE_TEMPLATE,
  },
  description: DEFAULT_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "./",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

// Structured data for search and answer engines: the organisation and the web
// app as one graph, each addressable by @id. No offers block on purpose -
// nothing here is for sale and a price would imply real money. The "<" escape
// keeps any future string from closing the script tag early.
const structuredData = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/spotter/spotter.png`,
        width: 1024,
        height: 1024,
      },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: "HealthApplication",
      operatingSystem: "Web",
      description: DEFAULT_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#org` },
    },
  ],
}).replace(/</g, "\\u003c");

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: NIGHT_PALETTE.background,
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${figtree.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-[75rem] flex-1 px-gutter pb-24 pt-5 sm:pb-12 min-[900px]:pt-8">
            <AccessGate>{children}</AccessGate>
          </main>
          <SiteFooter />
          <HelperWidget />
        </Providers>
        {/* Vercel Web Analytics: anonymous page-view counts so the pilot has a
            funnel to measure. Cookieless, no wallet address, no health data;
            disclosed on /privacy. */}
        <Analytics />
      </body>
    </html>
  );
}
