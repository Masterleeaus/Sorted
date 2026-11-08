import type { Route } from "next";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="tz-login-page">
      <div style={{ width: "min(620px, 92vw)", textAlign: "center" }}>
        <img
          src="/brand/titan-zero-field-logo.jpeg"
          alt="Titan Zero Field"
          style={{ width: "100%", height: "auto", display: "block", marginBottom: 24 }}
        />
        <p style={{ margin: "0 0 8px", fontSize: 56, fontWeight: 800, color: "var(--accent)", lineHeight: 1 }}>404</p>
        <h1 style={{ margin: "0 0 12px", fontSize: 24 }}>Field route not found</h1>
        <p style={{ margin: "0 auto 24px", maxWidth: 440, color: "var(--fg-muted)", lineHeight: 1.5 }}>
          That destination is not part of this Titan Field surface.
        </p>
        <Link href={"/app" as Route} className="p7-btn p7-btn-primary">Return to Command</Link>
      </div>
    </div>
  );
}
