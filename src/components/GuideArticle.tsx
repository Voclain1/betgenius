import Link from "next/link";
import { EditorialAttribution } from "@/components/EditorialAttribution";
import type { Guide } from "@/content/guides";

const formatDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function GuideArticle({ guide }: { guide: Guide }) {
  return (
    <article className="mx-auto max-w-6xl">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Betting literacy guide</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-100 sm:text-4xl">{guide.title}</h1>
        <p className="mt-4 text-base leading-7 text-gray-300">{guide.summary}</p>
        <div className="mt-5"><EditorialAttribution /></div>
        <p className="mt-3 text-xs text-gray-500">Published {formatDate(guide.publishedAt)} · Reviewed {formatDate(guide.reviewedAt)} · {guide.readingTime}</p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[15rem,minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <details className="card group lg:hidden">
            <summary className="cursor-pointer list-none text-sm font-semibold text-brand"><span className="group-open:hidden">In this guide +</span><span className="hidden group-open:inline">Close contents −</span></summary>
            <GuideToc guide={guide} className="mt-3" />
          </details>
          <div className="card hidden lg:block"><h2 className="text-sm font-semibold text-gray-100">In this guide</h2><GuideToc guide={guide} className="mt-3" /></div>
        </aside>
        <div className="min-w-0 space-y-10">
          {guide.sections.map((section) => <section key={section.id} id={section.id} className="scroll-mt-24"><h2 className="text-xl font-semibold text-gray-100 sm:text-2xl">{section.title}</h2><div className="mt-3 space-y-4 text-[15px] leading-7 text-gray-300 [&_li]:pl-1 [&_ul]:ml-5 [&_ul]:list-disc">{section.content}</div></section>)}
          <section aria-labelledby="related-guides"><h2 id="related-guides" className="text-xl font-semibold text-gray-100">Continue checking the evidence</h2><div className="mt-4 grid gap-3 sm:grid-cols-3">{guide.related.map((item) => <Link key={item.href} href={item.href} className="card block hover:border-brand/50"><span className="font-semibold text-brand">{item.label}</span><span className="mt-2 block text-sm leading-6 text-gray-400">{item.description}</span></Link>)}</div></section>
        </div>
      </div>
    </article>
  );
}

function GuideToc({ guide, className }: { guide: Guide; className?: string }) {
  return <nav aria-label="Guide contents" className={className}><ol className="space-y-2 text-sm text-gray-400">{guide.sections.map((section) => <li key={section.id}><a href={`#${section.id}`} className="hover:text-brand">{section.title}</a></li>)}</ol></nav>;
}

