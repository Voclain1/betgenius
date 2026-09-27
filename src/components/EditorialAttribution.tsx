import Image from "next/image";
import Link from "next/link";
import { editorialDesk } from "@/lib/editorialTeam";

export function EditorialAttribution() {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-400" aria-label="Editorial attribution">
      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-brand-border bg-brand-card" aria-hidden="true">
        <Image src={editorialDesk.image} alt="" fill sizes="32px" className="object-contain p-1" />
      </span>
      <p>
        Published by the{" "}
        <Link href="/about#team" className="font-medium text-brand hover:underline">{editorialDesk.name}</Link>
        {" · "}
        <Link href="/editorial-policy" className="hover:text-brand hover:underline">Editorial policy</Link>
      </p>
    </div>
  );
}
