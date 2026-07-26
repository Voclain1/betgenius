"use client";

export type BookmakerOption = { id: string; name: string; affiliateUrl: string; logoUrl: string | null };

// The one outbound-affiliate-link button in the app — Bet Builder's
// "Continue to bookmaker" step and Combo cards' "Join [Bookmaker]" buttons
// both render this instead of two copies of the same disabled-link idiom.
export function BookmakerJoinButton({
  bookmaker,
  disabled,
  label,
  className = "",
}: {
  bookmaker: BookmakerOption;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={disabled ? undefined : bookmaker.affiliateUrl}
      target="_blank"
      rel="noopener noreferrer sponsored"
      aria-disabled={disabled}
      onClick={(e) => {
        if (disabled) e.preventDefault();
      }}
      className={`btn btn-primary justify-center ${disabled ? "pointer-events-none opacity-50" : ""} ${className}`}
    >
      {label ?? `Join ${bookmaker.name}`}
    </a>
  );
}
