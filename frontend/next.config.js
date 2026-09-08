const path = require("path");

// Next only auto-loads .env files from its own project root (frontend/), but
// this repo keeps one .env at the repo root -- docker compose reads it via
// `env_file`. Without this, running `npm run dev` from frontend/ starts with
// no NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, and Clerk silently drops into keyless
// mode and mints throwaway keys into frontend/.clerk/.
// Matches `--env-file` semantics: a real environment variable always wins, so
// docker compose's env_file still takes precedence.
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(path.join(__dirname, "..", ".env"));
  } catch {
    /* no root .env; frontend/.env.local or the real environment supplies it */
  }
}

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 16 blocks its own dev resources (/_next/hmr, the client bundle) when
  // the browser's origin is not the dev server's own. Tenancy here is by
  // subdomain, so every real URL is such an origin -- and the page then
  // server-renders fine while never hydrating: no data fetch, no click
  // handlers, just a permanent "Loading...". Development only; a production
  // build serves these normally.
  allowedDevOrigins: [
    "zenoeats.local",
    "admin.zenoeats.local",
    "spicehouse.zenoeats.local",
    "jr-corner.zenoeats.local",
    // Wildcards are not supported here, so every new restaurant subdomain has
    // to be added to this list AND to the machine's hosts file before it can
    // be browsed with `next dev`. Production serves these normally and needs
    // neither.
    "*.zenoeats.local",
  ],
  // Emits .next/standalone: a self-contained server with only the packages
  // actually imported, so the production image ships neither the full
  // node_modules tree nor the sources.
  output: "standalone",
  async rewrites() {
    // Only used when the browser talks to Next directly. In the documented
    // setup the browser goes to nginx on :8080, which routes /api to FastAPI
    // before Next ever sees it. "api:8000" only resolves inside compose, so
    // native runs need the published port instead.
    const apiOrigin = process.env.API_PROXY_ORIGIN ?? "http://127.0.0.1:8000";
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};
