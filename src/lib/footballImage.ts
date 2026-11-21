/**
 * Only trusted API-Sports media can use the Next image optimiser.
 * Other provider URLs continue through the browser's native image loader.
 */
/**
 * Standalone Node render checks do not load next.config.mjs. In those checks
 * and in development, preserve the original image URL. Production still uses
 * Next's restricted caching image optimizer and the host allowlist.
 */
export const skipFootballImageOptimization = process.env.NODE_ENV !== "production";

export function isOptimizableFootballImageUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && /^[a-z0-9-]+\.api-sports\.io$/i.test(url.hostname);
  } catch {
    return false;
  }
}
