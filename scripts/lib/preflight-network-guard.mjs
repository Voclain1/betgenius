// Preloaded into every preflight check (NODE_OPTIONS=--import). Any fetch to a
// non-loopback host is rejected, so a check cannot reach API-Football, an AI
// provider, Paystack or a push service. See docs/PREFLIGHT.md.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const realFetch = globalThis.fetch;

globalThis.fetch = function guardedFetch(input, init) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  let host = "";
  try {
    host = new URL(String(raw)).hostname;
  } catch {
    /* not an absolute URL: refuse below */
  }
  if (!LOOPBACK.has(host)) {
    return Promise.reject(new Error(`preflight: network access is blocked (${host || "unparseable URL"})`));
  }
  return realFetch(input, init);
};
