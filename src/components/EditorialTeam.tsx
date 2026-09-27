import Image from "next/image";
import { editorialDesk } from "@/lib/editorialTeam";

export function EditorialTeam() {
  return (
    <div>
      <article id={editorialDesk.id} className="scroll-mt-24 rounded-xl border border-brand-border bg-brand-card p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-brand-bg p-2">
            <Image src={editorialDesk.image} alt="" fill sizes="64px" className="object-contain p-2" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-100">{editorialDesk.name}</h3>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-brand">{editorialDesk.role}</p>
            <p className="mt-2 text-sm leading-6 text-gray-300">{editorialDesk.description}</p>
          </div>
        </div>
      </article>
      <p className="mt-3 text-xs leading-5 text-gray-500">
        BetGenius is independently operated. “Analysis” and “editorial review” describe stages of the same internal publishing process, not separate people or an independent third-party review.
      </p>
    </div>
  );
}
