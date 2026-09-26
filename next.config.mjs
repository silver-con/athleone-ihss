/** @type {import('next').NextConfig} */

// Security headers for every response. The Content-Security-Policy is only
// sent in production: `next dev` needs eval() for fast refresh.
//
// script-src keeps 'unsafe-inline' because Next.js inlines its bootstrap
// scripts; the policy still blocks scripts from any other origin, plugins,
// framing by other sites and form posts to other sites. DocuSign's signing
// page is reached by a top-level redirect (never framed), so it doesn't
// need an allowance here.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Geolocation is used by EVV clock-in/out on our own pages only.
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Content-Security-Policy', value: csp },
      ]
    : []),
];

const nextConfig = {
  // Self-contained server in .next/standalone for the Docker image
  // (see Dockerfile) — no full node_modules needed at runtime.
  output: 'standalone',
  poweredByHeader: false,
  experimental: {
    // Fax uploads pass through proxy.js; allow the 20 MB the inbox accepts.
    proxyClientMaxBodySize: '21mb',
  },
  async headers() {
    return [
      // Everything except the original-fax file gets the full set, including
      // "never show me in a frame".
      { source: '/((?!inbox/[^/]+/file).*)', headers: securityHeaders },
      // The original fax is shown in a frame on our own review screen, so
      // that one route may be framed by Athleone itself (and nobody else).
      {
        source: '/inbox/:id/file',
        headers: [
          ...securityHeaders.filter((h) => !['X-Frame-Options', 'Content-Security-Policy'].includes(h.key)),
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      // Signed-in pages carry PHI: never let a shared/proxy cache keep them.
      {
        source: '/(admin|caregiver|referrals|clients|fax|inbox|platform|account)/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};

export default nextConfig;
