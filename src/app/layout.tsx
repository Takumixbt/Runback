import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { MarketProvider } from "@/components/MarketProvider";
import { Nav } from "@/components/Nav";
import { Ticker } from "@/components/Ticker";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const DESCRIPTION =
  "Run back any trade. Paste a wallet on Hyperliquid, Lighter, RiseX, Pacifica, Drift, dYdX or Jupiter. Replay a position as a clip.";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: "Runback", template: "%s" },
  description: DESCRIPTION,
  applicationName: "Runback",
  openGraph: {
    title: "Runback",
    description: "Run back any trade. Paste a wallet, replay a position as a clip.",
    type: "website",
    siteName: "Runback",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Runback",
    description: "Run back any trade. Paste a wallet, replay a position as a clip.",
  },
};

export const viewport: Viewport = { themeColor: "#0f1a1e", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="preconnect" href="https://api.hyperliquid.xyz" />
        <link rel="preconnect" href="https://app.hyperliquid.xyz" />
        <link rel="preconnect" href="https://mainnet.zklighter.elliot.ai" />
        <link rel="preconnect" href="https://indexer.dydx.trade" />
        <link rel="preconnect" href="https://perps-api.jup.ag" />
        <link rel="preconnect" href="https://api.rise.trade" />
        <link rel="preconnect" href="https://data.velocity.exchange" />
        <link rel="preconnect" href="https://api.pacifica.fi" />
      </head>
      <body className={inter.className}>
        <MarketProvider>
          <div className="flex h-dvh flex-col overflow-hidden">
            <Nav />
            <Ticker />
            <div className="scrollers min-h-0 flex-1 overflow-y-auto">
              {children}
              <footer className="mx-auto flex w-full max-w-[1120px] items-center px-5 pb-10 pt-16">
                <a
                  href="https://github.com/Takumixbt/runback"
                  className="inline-flex h-8 w-8 items-center justify-center text-faint hover:text-muted"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub"
                  title="GitHub"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                </a>
              </footer>
            </div>
          </div>
        </MarketProvider>
      </body>
    </html>
  );
}
