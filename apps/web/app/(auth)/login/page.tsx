"use client";

import { useState } from "react";
import { resolvePostLoginHref } from "@/lib/auth/post-login-destination";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error?.message || "Login failed");
        setLoading(false);
        return;
      }

      const role = data.user?.role ?? "owner";
      const isPhone = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
      const next = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("next") : null;
      const dest = resolvePostLoginHref(role, {
        cookieHeader: typeof document !== "undefined" ? document.cookie : null,
        isPhone,
        next,
      });
      window.location.replace(dest);
    } catch {
      setError("An unexpected error occurred");
      setLoading(false);
    }
  }

  return (
    <div className="tz-login-page">
      <div className="tz-login-brand tg-login-field-lockup">
        <img src="/brand/titan-zero-field-lockup.jpeg" alt="Titan Zero Field — Run the work" />
      </div>
      <div className="tg-login-go-brand">
        <img src="/icons/icon-192.png" alt="" aria-hidden="true" />
        <span><b>TITAN GO</b><small><i /> FIELD MODE</small></span>
      </div>
      <div className="login-card tz-login-card">
        <span className="tz-eyebrow">TITAN GO · FIELD MODE</span>
        <h1>Sign in</h1>
        <p>Sign in once. Titan Go opens the modes and roles available to your account.</p>

        {error ? <div className="error-message" role="alert">{error}</div> : null}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@company.com" />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading} className="login-button">
            {loading ? "Signing in…" : "Enter Titan Go"}
          </button>
        </form>
      </div>
    </div>
  );
}
