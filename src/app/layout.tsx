import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Runback",
  description:
    "Paste a Hyperliquid wallet, browse its trades, replay one as a video you can post.",
  openGraph: {
    title: "Runback",
    description: "Run it back. Every trade on Hyperliquid, replayed.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
        {/* The API this app reads is called from the browser, so warm the connection early. */}
        <link rel="preconnect" href="https://api.hyperliquid.xyz" />
      </head>
      <body>{children}</body>
    </html>
  );
}
