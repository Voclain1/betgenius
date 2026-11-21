import type { Metadata } from "next";
import Link from "next/link";
import { GUIDE_CLUSTERS, GUIDES } from "@/content/guides";

export const metadata: Metadata = {
  title: "Football Prediction Guides",
  description: "Football prediction guides covering match evidence, cup ties, banker tips, goals markets, multi bets, bookmaker odds and risk.",
  alternates: { canonical: "/guides" },
};

const bySlug = new Map(GUIDES.map((guide) => [guide.slug, guide]));

export default function GuidesPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Learn</p>
        <h1 className="mt-3 text-3xl font-bold text-gray-100 sm:text-4xl">Football prediction guides</h1>
        <p className="mt-4 text-base leading-7 text-gray-300">Use match facts, market definitions and settlement rules to understand a prediction. These guides explain the questions worth asking; they do not promise an outcome.</p>
        <p className="mt-4 text-sm leading-6 text-gray-400">Looking for published selections? Start with <Link href="/predictions/today" className="text-brand hover:underline">football predictions today</Link> or <Link href="/predictions" className="text-brand hover:underline">browse the prediction categories</Link>.</p>
      </header>
      <nav aria-label="Guide topics" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {GUIDE_CLUSTERS.map((cluster) => <a key={cluster.id} href={`#${cluster.id}`} className="font-medium text-brand hover:underline">{cluster.title}</a>)}
      </nav>
      {GUIDE_CLUSTERS.map((cluster) => (
        <section key={cluster.id} id={cluster.id} className="scroll-mt-24 space-y-4" aria-labelledby={`${cluster.id}-heading`}>
          <div className="max-w-3xl">
            <h2 id={`${cluster.id}-heading`} className="text-xl font-semibold text-gray-100 sm:text-2xl">{cluster.title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">{cluster.intro}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {cluster.slugs.map((slug) => {
              const guide = bySlug.get(slug);
              if (!guide) return null;
              return (
                <article key={guide.slug} className="card">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">{guide.readingTime}</p>
                  <h3 className="mt-2 text-lg font-semibold"><Link href={`/guides/${guide.slug}`} className="hover:text-brand">{guide.title}</Link></h3>
                  <p className="mt-3 text-sm leading-6 text-gray-400">{guide.summary}</p>
                  <Link href={`/guides/${guide.slug}`} className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">Read guide →</Link>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
