import Link from "next/link";
import type { ReactNode } from "react";

export type TrustSection = {
  id: string;
  title: string;
  content: ReactNode;
};

export function PolicyCallout({ children, tone = "notice" }: { children: ReactNode; tone?: "notice" | "warning" }) {
  return (
    <div className={`rounded-xl border p-4 text-sm leading-6 ${tone === "warning" ? "border-amber-400/40 bg-amber-400/10 text-gray-200" : "border-brand/30 bg-brand/10 text-gray-200"}`}>
      {children}
    </div>
  );
}

export function TrustLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="font-medium text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand">{children}</Link>;
}

export function TrustPage({ eyebrow, title, intro, sections, effectiveDate }: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  sections: TrustSection[];
  effectiveDate?: string;
}) {
  return (
    <article className="mx-auto max-w-6xl pb-10">
      <header className="rounded-2xl border border-brand-border bg-gradient-to-br from-brand/15 via-brand-card to-brand-bg px-5 py-8 sm:px-8 sm:py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
        <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight text-gray-100 sm:text-4xl">{title}</h1>
        <div className="mt-4 max-w-3xl text-base leading-7 text-gray-300">{intro}</div>
        {effectiveDate && <p className="mt-5 text-xs text-gray-500">Effective date: {effectiveDate} · Last updated: {effectiveDate}</p>}
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[14rem,minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="On this page">
          <div className="rounded-xl border border-brand-border bg-brand-card p-4">
            <h2 className="text-sm font-semibold text-gray-100">On this page</h2>
            <nav className="mt-3">
              <ol className="space-y-2 text-sm text-gray-400">
                {sections.map((section) => <li key={section.id}><a className="hover:text-brand" href={`#${section.id}`}>{section.title}</a></li>)}
              </ol>
            </nav>
          </div>
        </aside>

        <div className="min-w-0 space-y-10">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="text-xl font-semibold text-gray-100 sm:text-2xl">{section.title}</h2>
              <div className="mt-3 space-y-4 text-[15px] leading-7 text-gray-300 [&_li]:pl-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc [&_strong]:font-semibold [&_strong]:text-gray-100">
                {section.content}
              </div>
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}
