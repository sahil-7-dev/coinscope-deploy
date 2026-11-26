import { ImageResponse } from "next/og";

export const alt = "CoinScope: fundamentals-first crypto research and narrative discovery";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The link preview shown when CoinScope is shared on X, LinkedIn, Slack, Discord, etc.
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "linear-gradient(135deg, #0b1220 0%, #12261b 100%)", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 34, color: "#4ade80", fontWeight: 700, letterSpacing: 2 }}>COINSCOPE</div>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1, marginTop: 24, maxWidth: 1000 }}>Fundamentals-first crypto research</div>
        <div style={{ fontSize: 32, color: "#cbd5e1", marginTop: 28, maxWidth: 1000 }}>Spot narratives before the crowd. Compare coins to past winners. Get a plain verdict.</div>
        <div style={{ display: "flex", gap: 16, marginTop: 48, fontSize: 24, color: "#86efac" }}>
          <span>No technical analysis</span><span>·</span><span>No AI</span><span>·</span><span>Free data only</span>
        </div>
      </div>
    ),
    size,
  );
}
