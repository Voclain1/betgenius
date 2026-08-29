const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
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
