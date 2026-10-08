"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Prose } from "@/components/Prose";
import { reasoningExcerpt } from "@/lib/reasoningExcerpt";

/**
 * A pick's reasoning, collapsed to its opening sentence or two with a
 * "Show full reasoning" control. The full text is still in the HTML (hidden
 * until opened), so crawlers read all of it.
 */
export function ReasoningExcerpt({ text }: { text: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const { excerpt, truncated } = reasoningExcerpt(text);
  if (!excerpt) return null;
  if (!truncated) return <Prose text={text} />;

  return (
    <div>
      {!open && (
        <p className="relative text-sm leading-relaxed text-gray-300">
          {excerpt}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-brand-card to-transparent" />
        </p>
      )}
      <div hidden={!open}>
        <Prose text={text} />
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-gray-100 hover:text-brand"
      >
        {open ? "Show less" : "Show full reasoning"}
        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
      </button>
    </div>
  );
}
