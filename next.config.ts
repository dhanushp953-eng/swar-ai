import type { NextConfig } from "next";

/**
 * Build-time origins the browser is allowed to call (CSP connect-src). These
 * come from the deployed backend URLs (Render HTTPS) and fall back to the
 * local dev backend so `next dev` keeps working without configuration.
 */
function backendConnectOrigins(): string[] {
  const candidates = [
    process.env.NEXT_PUBLIC_AUDIO_API_URL,
    process.env.NEXT_PUBLIC_TUTOR_API_URL,
    process.env.NEXT_PUBLIC_FS1_API_URL,
  ]
    .map((value) => (value ?? "").trim())
    .filter(Boolean);
  const origins = new Set<string>();
  for (const candidate of candidates) {
    try {
      const origin = new URL(candidate).origin;
      if (origin && origin !== "null") origins.add(origin);
    } catch {
      // Ignore malformed URLs; they are ignored rather than breaking the build.
    }
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:8000");
    origins.add("http://localhost:8088");
  }
  return [...origins];
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Referrer-Policy",
    value: "no-referrer",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      `connect-src 'self' ${backendConnectOrigins().join(" ")}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.29.53"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://localhost:8000/api/:path*"
            : "/api/:path*",
      },
    ];
  },
};

export default nextConfig;
