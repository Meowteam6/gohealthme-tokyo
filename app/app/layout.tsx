import type { Metadata, Viewport } from "next";
import Link from "next/link";
import {
  Atkinson_Hyperlegible_Next,
  Bricolage_Grotesque,
  Geist_Mono,
  Patrick_Hand,
} from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import Header from "@/components/Header";
import HelperWidget from "@/components/HelperWidget";
import { Analytics } from "@vercel/analytics/next";
import AccessGate from "@/components/AccessGate";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
  TITLE_TEMPLATE,
} from "@/lib/site";

// Type system (docs/DESIGN.md): Bricolage Grotesque for titles and the big
// stake, payout and night figures (variable, with the optical-size axis so it
// tightens at 64px); Atkinson Hyperlegible Next for all running copy and every
// control; Patrick Hand only inside SPOTTER's speech bubbles; Geist Mono only
// for addresses and tx hashes.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
  display: "swap",
});

const patrickHand = Patrick_Hand({
  variable: "--font-patrick",
  subsets: ["latin"],
  weight: "400",
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${atkinson.variable} ${patrickHand.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-8 sm:pb-8">
            <AccessGate>{children}</AccessGate>
          </main>
          <footer className="border-t border-edge bg-surface-raised/60 px-4 pb-24 pt-6 text-sm text-muted sm:pb-6">
            <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <p className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1 text-[0.8125rem] font-bold text-foreground">
                  Base Sepolia test money, beta
                </p>
                <p className="max-w-xl">
                  Built at ETHGlobal Tokyo 2026 and settled by SPOTTER. Your
                  health data never touches the chain.
                </p>
              </div>
              <nav aria-label="Legal" className="flex items-center gap-5">
                <Link
                  href="/privacy"
                  className="inline-flex min-h-11 items-center font-bold text-accent-deep underline-offset-4 hover:underline"
                >
                  Privacy
                </Link>
                <Link
                  href="/terms"
                  className="inline-flex min-h-11 items-center font-bold text-accent-deep underline-offset-4 hover:underline"
                >
                  Terms
                </Link>
              </nav>
            </div>
          </footer>
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
