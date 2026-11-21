import Link from "next/link";
import { cupDirectoryDescription, cupDirectoryGroups, cupDirectoryLabel } from "@/lib/cupSeoDirectory";

/** Progressive disclosure keeps all registered cups accessible without
 * crowding mobile search and match interfaces. Links use the one cup registry.
 */
export function CupDiscoveryDirectory({ currentSlug, mode = "index" }: {
  currentSlug?: string;
  mode?: "index" | "related";
}) {
  const [top, middle, other] = cupDirectoryGroups().map((group) => ({
    ...group,
    cups: group.cups.filter((cup) => cup.slug !== currentSlug),
  }));

  const links = (cups: typeof top.cups, card: boolean) => (
    <div className={card ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3"}>
      {cups.map((cup) => (
        <div key={cup.id} className={card ? "rounded-2xl border border-brand-border p-4" : ""}>
          <Link href={`/predictions/cup/${cup.slug}`} className="text-sm font-semibold text-brand hover:underline">
            {cupDirectoryLabel(cup)}
          </Link>
          {card && <p className="mt-2 text-xs leading-5 text-gray-400">{cupDirectoryDescription(cup)}</p>}
        </div>
      ))}
    </div>
  );
  const compact = mode === "related";
  return (
    <section aria-labelledby={compact ? "other-cup-links" : "cup-directory"}>
      {compact && <h2 id="other-cup-links" className="mb-3 text-lg font-semibold">Explore other cup competitions</h2>}
      {!compact && <h3 id="cup-directory" className="mb-3 text-lg font-semibold">Major cups: fixtures, results and predictions</h3>}
      {links(top.cups, !compact)}
      {middle.cups.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-3 text-base font-semibold">{middle.title}</h3>
          {links(middle.cups, false)}
        </div>
      )}
      {other.cups.length > 0 && (
        <details className="mt-5 rounded-2xl border border-brand-border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-brand">{other.title} ({other.cups.length})</summary>
          <div className="mt-4">{links(other.cups, false)}</div>
        </details>
      )}
    </section>
  );
}
