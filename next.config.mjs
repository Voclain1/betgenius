const nextConfig = {
  images: {
    // The only remote images next/image renders are team crests, which come
    // from API-Football. Checked on production (8 Oct 2026): all 1,857 stored
    // crest URLs are on media.api-sports.io. The previous "**" let anyone use
    // the image optimiser to fetch and resize arbitrary URLs, which is the
    // surface several Next.js advisories target (optimiser DoS, cache
    // confusion). "*.api-sports.io" also covers the media-N mirrors the
    // provider has used.
    remotePatterns: [
      { protocol: "https", hostname: "media.api-sports.io" },
      { protocol: "https", hostname: "*.api-sports.io" },
    ],
  },
  async redirects() {
    return [
      // "Same-Game Doubles" was renamed to "Combo Bets" at the display layer.
      // The old slug was live, linked from the nav and present in the sitemap,
      // so it redirects permanently rather than 404ing.
      { source: "/predictions/same-game-doubles", destination: "/predictions/combo-bets", permanent: true },
      // "Combos" was renamed to "Multi Bets" to stop it reading as a variant of
      // "Combo Bet", which is a different feature (two picks on one match, vs
      // one pick across several). Same permanent-redirect pattern.
      { source: "/combos", destination: "/multi-bets", permanent: true },
    ];
  },
};

export default nextConfig;
