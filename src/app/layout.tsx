import type { Metadata } from "next";
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
        {/* Read from the browser, so warm the connection before anything asks for it. */}
        <link rel="preconnect" href="https://api.hyperliquid.xyz" />
      </head>
      <body>{children}</body>
    </html>
  );
}
