import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Nothing is fetched server-side that a visitor triggers, so there is no image
  // proxying, no rewrites and no secrets. The app is static except for the gallery.
  reactStrictMode: true,
};

export default nextConfig;
