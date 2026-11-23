import { ImageResponse } from "next/og";

export const alt = "Runback — paste a wallet, watch it trade";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0f1a1e",
          backgroundImage:
            "radial-gradient(900px 420px at 50% -80px, rgba(23, 69, 63, 0.45), transparent 70%)",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 22,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#50d2c1",
            fontWeight: 500,
          }}
        >
          Runback
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 28,
            fontSize: 72,
            lineHeight: 1.05,
            fontWeight: 600,
            color: "#f6fefd",
            letterSpacing: "-0.03em",
            maxWidth: 900,
          }}
        >
          <span>Paste a wallet.</span>
          <span>Watch it trade.</span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 28,
            color: "#9aa3a4",
            maxWidth: 720,
          }}
        >
          Any perp position on ten public books. Export the clip.
        </div>
      </div>
    ),
    { ...size },
  );
}
