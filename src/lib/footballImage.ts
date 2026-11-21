/**
 * Only trusted API-Sports media can use the Next image optimiser.
 * Other provider URLs continue through the browser's native image loader.
 */
export function isOptimizableFootballImageUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && /^[a-z0-9-]+\.api-sports\.io$/i.test(url.hostname);
  } catch {
    return false;
  }
}
