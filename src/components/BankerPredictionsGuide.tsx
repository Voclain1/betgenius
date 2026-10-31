import Link from "next/link";
import { BANKER_CONFIDENCE_FLOOR, BANKER_MAX_PICKS } from "@/lib/geniusCuration";
import type { WinRateStat } from "@/lib/trackRecord";

/**
 * Closed by default, like the Today guide: the picks come first and the
 * explainer opens on request. The text stays in the page for search engines.
 */
export function BankerPredictionsIntro() {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold marker:hidden sm:text-lg">
        <h2 className="text-base font-semibold sm:text-lg">What is a Banker prediction?</h2>
        <span aria-hidden="true" className="shrink-0 text-sm font-normal text-brand group-open:hidden">Read guide +</span>
        <span aria-hidden="true" className="hidden shrink-0 text-sm font-normal text-brand group-open:inline">Close −</span>
      </summary>
      <div className="mt-4 border-t border-brand-border pt-1">
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Banker predictions are a short list of higher-conviction football picks selected from the day&apos;s
        fixture card. Up to {BANKER_MAX_PICKS} may be published in a day, fewer on a thin card, and some days will have none when the available
        evidence is not strong enough.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        A Banker label is not a guarantee. Check the market, confidence rating and reasoning, then consider
        late team news before making your own decision. The full pick and reasoning are available after free
        registration.
      </p>
      </div>
    </details>
  );
}

export function BankerPredictionsEvidence({ record }: { record?: WinRateStat | null }) {
  return (
    <section className="card" aria-labelledby="banker-method-heading">
      <h2 id="banker-method-heading" className="text-lg font-semibold">
        How Banker picks are selected
      </h2>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Bankers are the highest-confidence picks on the day&apos;s card, from any competition, including the
        Champions League and Europa League. A pick needs a confidence rating of at least {BANKER_CONFIDENCE_FLOOR}% to qualify, each match
        can supply only one, and the list is capped at {BANKER_MAX_PICKS} rather than filled to a target. Confidence compares
        the strength of the available evidence; it is not a guaranteed probability of winning.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Every Banker result is listed day by day at the foot of this page. The rate in this page&apos;s heading
        covers all published Banker results, while the public track record reports the current calendar month.
        Compare the same reporting period when reviewing performance.
      </p>
      <h3 className="mt-5 text-base font-semibold">What the Banker win rate measures</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        {record && record.rate != null && record.decided >= 20
          ? `The all-time Banker win rate is ${Math.round(record.rate * 100)}%, based on ${record.decided} decided picks.`
          : "An all-time percentage is shown only after at least 20 Banker picks have a win or loss recorded."}
        {" "}The calculation is wins divided by wins plus losses. Void picks do not enter that denominator,
        and pending picks are excluded until they settle. Both winning and losing results remain in the record.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        A win rate does not measure profit: returns also depend on odds and stakes. The confidence rating
        ranks the available evidence; it is not a calibrated win probability, and past results do not predict
        the next outcome.
      </p>
      <h3 className="mt-5 text-base font-semibold">Using today&apos;s Banker picks</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        After free registration, check each selection&apos;s market and reasoning against its match page.
        A double-chance selection and an outright win have different conditions, even when both appear in
        this list. Recheck line-ups and match status before kickoff; the evidence available when a pick was
        published may change.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        The list ranks individual picks. It is not an instruction to combine every selection into an accumulator:
        a multi-bet requires every leg to meet its settlement conditions. Neither the Banker label nor a
        shared confidence threshold guarantees the combined outcome.
      </p>
      <h3 className="mt-5 text-base font-semibold">The same score can settle Banker markets differently</h3>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Suppose a match finishes 1–1 in regulation time. A home-win selection loses, a home-or-draw
        selection wins, BTTS Yes wins and Over 2.5 Goals loses. The Banker label changes none of those
        conditions. Read the exact selection before placing a bet, and check your bookmaker’s rules for
        extra time, postponed fixtures and void selections.
      </p>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Compare like-for-like selections through our <Link href="/predictions/straight-wins" className="text-brand hover:underline">straight win predictions</Link>,
        <Link href="/predictions/double-chance" className="text-brand hover:underline"> double chance tips</Link>,
        <Link href="/predictions/btts" className="text-brand hover:underline"> both teams to score predictions</Link> and
        <Link href="/predictions/over-2-5-goals" className="text-brand hover:underline"> Over 2.5 goals predictions</Link>.
        Those pages explain each market; the Banker list selects across markets rather than defining a new bet type.
      </p>
      <h3 className="mt-5 text-base font-semibold">Questions about Banker predictions</h3>
      <div className="mt-2 divide-y divide-brand-border">
        {[
          ["Are Banker predictions sure wins?", "No. The label identifies a higher-confidence selection, not a guaranteed outcome. An unexpected result can defeat any pick. Avoid increasing a stake simply because a selection is called a Banker or because earlier picks won."],
          ["Do I need a paid subscription to see the daily Banker picks?", "Free registration unlocks the daily Banker selections and reasoning. Sign in to your account if the picks are shown as locked. VIP and Premium are separate offerings; the Banker registration prompt is not a request to purchase either plan."],
          ["Why are there fewer Banker tips than expected?", `The daily list has a maximum of ${BANKER_MAX_PICKS} picks, not a minimum. Each qualifying selection needs at least ${BANKER_CONFIDENCE_FLOOR}% confidence, and only one is selected per match. A smaller list is preferable to adding weaker selections simply to fill spaces.`],
          ["Is the daily Banker the same as the Weekend Banker?", "They cover different periods. This page follows the selected WAT day. The Weekend Banker covers Friday to Sunday, while the Midweek Banker covers Tuesday to Thursday. Those period pages use their own selection thresholds and list limits, so their picks can differ from the daily list."],
          ["Can a high win rate still produce a loss overall?", "Yes. Win rate counts winning and losing selections without weighting their prices or stakes. Several short-priced wins can be outweighed by losses. Review the reporting period and sample size as well as the rate, and do not interpret a percentage alone as evidence of profitability."],
        ].map(([question, answer]) => (
          <details key={question} className="py-4">
            <summary className="cursor-pointer font-semibold">{question}</summary>
            <p className="mt-3 text-sm leading-6 text-gray-300">{answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Looking beyond one day? Open the <Link href="/predictions/weekend" className="text-brand hover:underline">weekend football predictions</Link> or
        <Link href="/predictions/midweek" className="text-brand hover:underline"> midweek football predictions</Link> and
        check the displayed dates. For the broader daily card, browse <Link href="/predictions/today" className="text-brand hover:underline">today’s football predictions</Link>.
        Review match status before treating a listed selection as an upcoming tip. Betting is for adults aged
        18 or older; set limits and only risk money you can afford to lose.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/track-record#category-banker" className="text-brand hover:underline">
          Check the Banker track record
        </Link>
        <Link href="/guides/what-is-a-banker-bet" className="text-brand hover:underline">
          What a banker bet is
        </Link>
        <Link href="/methodology" className="text-brand hover:underline">
          Read the methodology
        </Link>
        <Link href="/responsible-gambling" className="text-brand hover:underline">
          Responsible gambling
        </Link>
      </div>
    </section>
  );
}
