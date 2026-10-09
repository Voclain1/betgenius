/**
 * The category feeds' hero, in the team and competition pages' language:
 * kicker, heavy title, the feed's one-line promise, and the day's numbers in
 * a ruled stats strip. Every stat is read from the rows on the page (or the
 * feed's settled record), so nothing here can drift from what is listed.
 */
export function CategoryMasthead({
  kicker,
  title,
  blurb,
  dateLabel,
  stats,
  actions,
}: {
  kicker: string;
  title: string;
  blurb: React.ReactNode;
  dateLabel: string;
  stats: { label: string; value: string; accent?: boolean }[];
  /** Follow button, unlock or sign-up call. */
  actions?: React.ReactNode;
}) {
  return (
    <header className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.16),transparent)]" />
      <div className="relative space-y-3 p-5 sm:p-8">
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-[3px] w-5 rounded-full bg-brand" />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">{kicker}</span>
        </div>
        <h1 className="text-3xl font-black leading-[1.05] tracking-tight text-gray-100 sm:text-5xl">{title}</h1>
        <p className="text-xs font-semibold text-gray-500">{dateLabel}</p>
        <p className="max-w-2xl text-sm leading-relaxed text-gray-300 sm:text-base">{blurb}</p>
        {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
      </div>
      {stats.length > 0 && (
        <dl className={`relative grid gap-px border-t border-brand-border bg-brand-border ${stats.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : stats.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col-reverse bg-brand-card px-2 py-3.5 text-center">
              <dt className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{s.label}</dt>
              <dd className={`text-2xl font-black tabular-nums sm:text-3xl ${s.accent ? "text-brand" : "text-gray-100"}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
