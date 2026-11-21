import Link from "next/link";

/** Helpful category-specific context even when no new picks qualify today. */
export function EvergreenCategoryEvidence({ category }: { category: "FEATURED" | "GENIUS" | "GOALS" }) {
  if (category === "GENIUS") {
    return (
      <section className="card space-y-3" aria-labelledby="genius-evidence-heading">
        <h2 id="genius-evidence-heading" className="text-lg font-semibold">How Genius football tips are selected</h2>
        <p className="text-sm leading-6 text-gray-300">Genius Tips groups selected published football picks and orders them by confidence. The confidence rating compares the available match evidence; it does not guarantee a result. On a quiet day there may be no qualifying selections, and nothing is added simply to fill the list.</p>
        <p className="text-sm leading-6 text-gray-300">Review the wider <Link href="/predictions/today" className="text-brand hover:underline">football predictions for today</Link>, learn <Link href="/methodology" className="text-brand hover:underline">how picks are assessed</Link>, and compare the <Link href="/track-record" className="text-brand hover:underline">settled results</Link> before judging a short run of outcomes.</p>
      </section>
    );
  }
  if (category === "GOALS") {
    return (
      <section className="card space-y-3" aria-labelledby="goals-evidence-heading">
        <h2 id="goals-evidence-heading" className="text-lg font-semibold">Over 1.5 goals and total-goals predictions</h2>
        <p className="text-sm leading-6 text-gray-300">This category covers Over 1.5 and Over 2.5 total-goals selections. Over 1.5 requires at least two goals during regulation time; Over 2.5 requires at least three. A 1–1 result qualifies for Over 1.5 but not Over 2.5. Each selection needs its own evidence and is never a guaranteed result.</p>
        <p className="text-sm leading-6 text-gray-300">For only the three-goal threshold, visit <Link href="/predictions/over-2-5-goals" className="text-brand hover:underline">Over 2.5 goals predictions</Link>. For the different question of whether both sides score, see <Link href="/predictions/btts" className="text-brand hover:underline">BTTS predictions</Link>. Our <Link href="/guides/over-under-goals-explained" className="text-brand hover:underline">goals-market guide</Link> explains settlement conditions.</p>
      </section>
    );
  }
  return (
    <section className="card space-y-3" aria-labelledby="featured-evidence-heading">
      <h2 id="featured-evidence-heading" className="text-lg font-semibold">Understanding featured football predictions</h2>
      <p className="text-sm leading-6 text-gray-300">Featured tips are selected from published matches where the available form, team context and market evidence support the assessment. A featured label or confidence rating does not guarantee that a pick will win. If no selection meets the criteria today, the feed remains empty until suitable picks are published.</p>
      <p className="text-sm leading-6 text-gray-300">Explore <Link href="/predictions/today" className="text-brand hover:underline">today's full prediction list</Link>, read <Link href="/methodology" className="text-brand hover:underline">our methodology</Link> and compare the <Link href="/track-record" className="text-brand hover:underline">publicly settled record</Link>.</p>
    </section>
  );
}
