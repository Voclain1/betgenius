// The database URL `next build` uses in CI and in the image build.
//
// WHY. Some pages are rendered from data at build time (ISR pages such as
// /fixtures, /free-ticket, /livescores, /track-record), so the build opens
// database connections — through an SSH port-forward to the VPS once
// DB_ON_VPS is on. `next build` prerenders in several worker processes and
// each Prisma client opens its own pool (default 2 x CPUs + 1 connections),
// each allowed only Prisma's default 5 s to connect. A burst of simultaneous
// connections through one SSH tunnel can take longer than that, and the
// build then fails with P1001 on some pages while others in the same build
// read the database fine (preflight run 43450847102, 13 Nov 2026).
//
// So, for the BUILD only: a longer connect timeout, a longer wait for a pooled
// connection, and a small pool per process. A database that is genuinely
// unreachable still fails the build, just after 30 s instead of 5 s. The
// running app never sees this URL: production gets its own DATABASE_URL in
// app.env (deploy-vps.yml), so runtime pooling and timeouts are unchanged.
//
// Parameters already present on the URL are kept as they are.
// Usage: export DATABASE_URL="$(node scripts/ci/build-database-url.mjs "$DATABASE_URL")"
const raw = process.argv[2];
if (!raw) process.exit(0); // unset secret: print nothing, leave the variable empty as before
let url;
try {
  url = new URL(raw);
} catch {
  // Not a URL we can parse: hand it back untouched rather than guess.
  process.stdout.write(raw);
  process.exit(0);
}
const defaults = { connect_timeout: "30", pool_timeout: "30", connection_limit: "3" };
for (const [k, v] of Object.entries(defaults)) if (!url.searchParams.has(k)) url.searchParams.set(k, v);
process.stdout.write(url.toString());
