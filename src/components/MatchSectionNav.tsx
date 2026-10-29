export function MatchSectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  return <nav aria-label="Match page sections" className="flex flex-wrap gap-2 rounded-2xl border border-brand-border bg-brand-card p-3">
    {sections.map(s => <a key={s.id} href={`#${s.id}`} className="rounded-lg px-3 py-2 text-xs font-bold text-gray-300 hover:bg-brand-bg hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">{s.label}</a>)}
  </nav>;
}
