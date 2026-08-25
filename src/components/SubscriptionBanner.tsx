import Link from "next/link";
import type { SubscriptionStatus, SubscriptionTier } from "@/lib/enums";

// The one signature moment of the dashboard — every other surface (tiles,
// lists, sections) stays on the plain `.card` treatment used site-wide, but
// a user's subscription status is the one thing everyone sees regardless of
// tier, so it gets the visual budget: a tier-accented gradient/glow border
// instead of another stacked-text settings row. Same gold/purple tokens the
// nav's VIP★ / Premium◆ pills already use, so status reads consistently
// wherever it shows up.
const TIER_COPY: Record<SubscriptionTier, { label: string; glyph: string | null }> = {
  FREE: { label: "Free", glyph: null },
  VIP: { label: "VIP", glyph: "★" },
  PREMIUM: { label: "Premium", glyph: "◆" },
};

const TIER_STYLES: Record<SubscriptionTier, { frame: string; text: string }> = {
  FREE: { frame: "border-brand-border bg-brand-card", text: "text-gray-100" },
  VIP: {
    frame: "border-vip/40 bg-gradient-to-br from-vip/15 via-brand-card to-brand-card shadow-[0_0_50px_-24px_rgba(245,197,24,0.8)]",
    text: "text-vip",
  },
  PREMIUM: {
    frame: "border-premium/40 bg-gradient-to-br from-premium/15 via-brand-card to-brand-card shadow-[0_0_50px_-24px_rgba(168,85,247,0.8)]",
    text: "text-premium",
  },
};

export function SubscriptionBanner({
  tier,
  status,
  currentPeriodEnd,
}: {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
}) {
  const copy = TIER_COPY[tier];
  const style = TIER_STYLES[tier];
  const isFree = tier === "FREE";

  const subtitle = isFree
    ? "Upgrade to unlock VIP and Premium tips."
    : `${status === "ACTIVE" ? "Active" : status}${
        currentPeriodEnd ? ` · renews ${new Date(currentPeriodEnd).toLocaleDateString()}` : ""
      }`;

  const inner = (
    <div className={`relative overflow-hidden rounded-2xl border p-5 sm:p-6 ${style.frame}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400">Your plan</div>
          <div className={`mt-1 flex items-baseline gap-2 text-2xl font-bold sm:text-3xl ${style.text}`}>
            {copy.glyph && <span aria-hidden="true">{copy.glyph}</span>}
            {copy.label}
          </div>
          <div className="mt-1 text-sm text-gray-400">{subtitle}</div>
        </div>
        {isFree ? (
          <span className="btn btn-primary pointer-events-none shrink-0">Upgrade</span>
        ) : (
          <Link href="/pricing" className="btn btn-ghost shrink-0 text-sm">
            Manage plan
          </Link>
        )}
      </div>
    </div>
  );

  // FREE's whole banner is the invitation, not just the button inside it —
  // the button stays as a secondary visual reinforcement (a non-interactive
  // span; nesting a real link there would be invalid HTML inside this Link).
  if (isFree) {
    return (
      <Link
        href="/pricing"
        className="block rounded-2xl transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}
