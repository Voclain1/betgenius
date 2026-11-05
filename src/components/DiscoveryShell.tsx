"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const feeds = [
  ["/predictions", "Discover"],
  ["/predictions/today", "Today's tips"],
  ["/predictions/genius", "Genius"],
  ["/predictions/banker", "Banker"],
  ["/predictions/featured", "Featured"],
  ["/predictions/goals", "Goals"],
  ["/predictions/combo-bets", "Combo bets"],
  ["/predictions/bet-of-the-day", "Bet of the Day"],
  ["/predictions/vip", "VIP"],
  ["/predictions/premium", "Premium"],
] as const;

/** An editorial page container. Homepage uses the full canvas, without a navigation rail. */
export function DiscoveryShell({
  children,
  reviewPath,
}: {
  children: React.ReactNode;
  reviewPath?: string;
}) {
  const pathname = usePathname();
  const path = reviewPath ?? pathname ?? "/";
  const discovery =
    path === "/" ||
    path === "/predictions" ||
    /^\/predictions\/[^/]+$/.test(path);
  if (!discovery) return <>{children}</>;
  return (
    <div
      className={`discovery-shell ${path === "/" ? "discovery-home" : "discovery-feed"}`}
    >
      <a href="#discovery-content" className="discovery-skip">
        Skip to predictions
      </a>
      {path !== "/" && (
        <nav aria-label="Prediction feeds" className="discovery-topnav">
          {feeds.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={path === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      <div id="discovery-content" className="discovery-content" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
