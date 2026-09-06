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
              <footer className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-10 pt-16 text-mini text-faint">
                <span>Runback</span>
                <span aria-hidden>·</span>
                <a
                  href="https://github.com/Takumixbt/runback"
                  className="hover:text-muted"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
                <span aria-hidden>·</span>
                <a href="https://github.com/Takumixbt/runback/blob/main/LICENSE" className="hover:text-muted">
                  MIT
                </a>
              </footer>
            </div>
          </div>
        </MarketProvider>
      </body>
    </html>
  );
}
