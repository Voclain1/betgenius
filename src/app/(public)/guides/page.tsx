import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES } from "@/content/guides";

export const metadata: Metadata = { title: "Football Prediction Guides", description: "Practical BetGenius guides to reading football predictions, evidence, confidence and risk.", alternates: { canonical: "/guides" } };

export default function GuidesPage() {
  return <div className="mx-auto max-w-6xl"><header className="max-w-3xl"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Learn</p><h1 className="mt-3 text-3xl font-bold text-gray-100 sm:text-4xl">Football prediction guides</h1><p className="mt-4 text-base leading-7 text-gray-300">Understand markets, evidence, confidence and risk before deciding how much weight to give any football prediction.</p></header><div className="mt-8 grid gap-4 md:grid-cols-2">{GUIDES.map((guide) => <article key={guide.slug} className="card"><p className="text-xs font-semibold uppercase tracking-wide text-brand">{guide.readingTime}</p><h2 className="mt-2 text-xl font-semibold"><Link href={`/guides/${guide.slug}`} className="hover:text-brand">{guide.title}</Link></h2><p className="mt-3 text-sm leading-6 text-gray-400">{guide.summary}</p><Link href={`/guides/${guide.slug}`} className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">Read guide →</Link></article>)}</div></div>;
}

