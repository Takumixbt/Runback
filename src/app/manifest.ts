import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Runback",
    short_name: "Runback",
    description: "Paste a wallet. Watch it trade.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1a1e",
    theme_color: "#0f1a1e",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon.png", sizes: "256x256", type: "image/png" },
    ],
  };
}
