import { SectionHead } from "@/components/TeamProfile";

/**
 * A titled section in the editorial language of the team and competition
 * pages: kicker and heavy title above, one deep rounded card below. `aside`
 * sits right of the title (a "Full table" link, a caption).
 */
export function PremiumPanel({
  kicker,
  title,
  id,
  aside,
  children,
  bare = false,
}: {
  kicker: string;
  title: string;
  id: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  /** Children bring their own surfaces (a grid of cards): no wrapping card. */
  bare?: boolean;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="flex flex-wrap items-end justify-between gap-x-3">
        <SectionHead kicker={kicker} title={title} id={id} />
        {aside && <div className="mb-4 shrink-0 text-xs font-semibold">{aside}</div>}
      </div>
      {bare ? children : <div className="rounded-3xl border border-brand-border bg-brand-card p-5">{children}</div>}
    </section>
  );
}

export { textTone } from "@/lib/tone";
