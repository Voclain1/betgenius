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
    ];
  },
};

export default nextConfig;
