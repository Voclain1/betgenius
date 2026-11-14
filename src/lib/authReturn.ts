/** User-supplied auth destinations must remain local, including after browser URL normalization. */
export function safeAuthReturn(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(value) ||
    /^\/(?:%2f|%5c)/i.test(value)
  )
    return "/dashboard";
  try {
    return new URL(value, "https://return.invalid").origin ===
      "https://return.invalid"
      ? value
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}
export function authPageHref(
  page: "/login" | "/register",
  destination: string,
): string {
  const safe = safeAuthReturn(destination);
  return safe === "/dashboard"
    ? page
    : `${page}?callbackUrl=${encodeURIComponent(safe)}`;
}
