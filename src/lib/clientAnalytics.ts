/**
 * Small client-only wrapper around the production GA4 tag.
 *
 * Local and preview builds do not render Analytics.tsx, so events deliberately
 * become no-ops there. Event payloads must never contain names, emails or any
 * other user-provided values.
 */
export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const gtag = (window as Window & { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== "function") return;
  gtag("event", name, params);
}
