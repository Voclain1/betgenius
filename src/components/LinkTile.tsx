import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/**
 * An onward link as a card in the premium language: heavy title, one line of
 * what is behind it, and an arrow that marks it as a way through rather than
 * a stripe or a tint.
 */
export function LinkTile({ href, title, desc, kicker }: { href: string; title: string; desc?: React.ReactNode; kicker?: string }) {
  return (
    <Link
      href={href}
      className="group relative flex h-full flex-col gap-1.5 rounded-3xl border border-brand-border bg-brand-card p-5 transition hover:border-brand/60 hover:bg-brand-bg/40"
    >
      {kicker && <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">{kicker}</span>}
      <span className="pr-8 text-lg font-black leading-snug tracking-tight text-gray-100">{title}</span>
      {desc && <span className="text-sm leading-relaxed text-gray-400">{desc}</span>}
      <span
        aria-hidden
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-brand-border text-gray-400 transition group-hover:border-brand group-hover:text-brand"
      >
        <ArrowUpRight className="h-4 w-4" />
      </span>
    </Link>
  );
}
