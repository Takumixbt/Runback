import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Visitor-triggered reads go to each venue from the browser when CORS allows.
  // Pacifica (and Drift if the host has moved) fall through `/api/x/{venue}`.
  reactStrictMode: true,
};

export default nextConfig;
