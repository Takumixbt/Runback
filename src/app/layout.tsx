import type { Metadata, Viewport } from "next";
import { MarketProvider } from "@/components/MarketProvider";
import { Nav } from "@/components/Nav";
import { Ticker } from "@/components/Ticker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Runback",
  description:
    "Paste a Hyperliquid wallet, browse its trades, replay one as a video you can post.",
  openGraph: {
    title: "Runback",
    description: "Run it back. Every position on Hyperliquid, replayed.",
    type: "website",
  },
};

/** Their ground colour, so browser chrome does not flash white on load. */
export const viewport: Viewport = { themeColor: "#0f1a1e", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/*
          Hyperliquid ships Inter under the name "OurFont", so this is literally their
          typeface. Weights kept to 400/500: their interface is almost entirely regular,
          including its titles, and matching that matters more than any colour here.
        */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap"
        />
        {/* Read from the browser, so warm both connections before anything asks. */}
        <link rel="preconnect" href="https://api.hyperliquid.xyz" />
        <link rel="preconnect" href="https://app.hyperliquid.xyz" />
      </head>
      <body>
        {/*
          The chrome is fixed and only the page scrolls, which is how the terminal behaves:
          the wordmark, the address box and the marks never leave.
        */}
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
