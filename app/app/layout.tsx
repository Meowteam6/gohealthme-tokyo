import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Baloo_2 } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import Header from "@/components/Header";
import HelperWidget from "@/components/HelperWidget";
import AccessGate from "@/components/AccessGate";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
  TITLE_TEMPLATE,
} from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Rounded, friendly display face for headings, section labels, chip/button text
// and hero amounts (never body, never the mono money figures). This is the
// single biggest piece of the playful vibe the flat surfaces were missing.
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
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
      className={`${geistSans.variable} ${geistMono.variable} ${baloo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
            <AccessGate>{children}</AccessGate>
          </main>
          <footer className="border-t border-edge px-4 py-6 text-center text-xs text-muted">
            <p>
              GoHealthMe — settled by SPOTTER on Base Sepolia. Your health data
              never touches the chain.
            </p>
            <nav className="mt-2 flex items-center justify-center gap-4">
              <Link href="/privacy" className="hover:text-foreground hover:underline">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-foreground hover:underline">
                Terms
              </Link>
            </nav>
          </footer>
          {/* SPOTTER occasionally sprints across the bottom of the screen.
              Decoration only: pointer-events-none, aria-hidden, and stopped
              entirely under prefers-reduced-motion. */}
          <div
            aria-hidden="true"
            className="otter-dash pointer-events-none fixed bottom-2 left-0 z-30 select-none"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/spotter/spotter-run.png"
              alt=""
              className="h-16 w-auto drop-shadow-lg sm:h-20"
            />
          </div>
          <HelperWidget />
        </Providers>
      </body>
    </html>
  );
}
