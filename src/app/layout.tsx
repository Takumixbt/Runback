import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { MarketProvider } from "@/components/MarketProvider";
import { Nav } from "@/components/Nav";
import { Ticker } from "@/components/Ticker";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Runback",
  description:
    "Paste a wallet on Hyperliquid, Lighter, RiseX, Drift, Pacifica, dYdX or Jupiter. Browse its trades, replay one as a video you can post.",
  openGraph: {
    title: "Runback",
    description: "Run it back. Positions on the perp books that actually publish a tape.",
    type: "website",
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
      </head>
      <body className={inter.className}>
        <MarketProvider>
          <div className="flex h-dvh flex-col overflow-hidden">
            <Nav />
            <Ticker />
            <div className="scrollers min-h-0 flex-1 overflow-y-auto">{children}</div>
          </div>
        </MarketProvider>
      </body>
    </html>
  );
}
