import Link from "next/link";
import { SectionHead } from "@/components/TeamProfile";

const LINK = "font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand";
const GUIDE_LINKS = [
  ["home-today-guide", "Today and weekend"], ["home-free-guide", "Free predictions"],
  ["home-nigeria-guide", "Nigeria"], ["home-banker-guide", "Banker tips"],
  ["home-markets-guide", "Prediction markets"], ["home-league-guide", "Premier League"],
  ["home-method-guide", "Methodology"], ["home-record-guide", "Results record"],
  ["home-responsible-guide", "Responsible use"],
] as const;

/** Editorial content only: server-rendered, with native disclosure controls. */
export function HomepageExplainer() {
  return (
    <>
      <section aria-labelledby="home-football-guide">
        <SectionHead kicker="Football predictions and match analysis" title="Football predictions today: understand the pick before you decide" id="home-football-guide" />
        <div className="max-w-4xl space-y-4 text-sm leading-7 text-gray-400">
          <p>
            Finding football predictions today is easy. Working out which selections have enough evidence behind them takes more care.
            A useful prediction should tell you what the market is, what needs to happen for the selection to succeed, and why the available
            match information supports that view. BetGenius brings those questions together with published football tips, match previews,
            fixtures, scores and a public results record for Nigerian and international football fans.
          </p>
          <p>
            The predictions above are the starting point. Open a fixture to read the supporting analysis, compare the available team information,
            and check whether the selection fits the market you intended to assess. Football remains uncertain: a convincing explanation,
            a familiar team or a high confidence rating cannot remove the possibility of a loss.
          </p>
        </div>
        <nav aria-label="Football predictions guide" className="mt-5 flex flex-wrap gap-2">
          {GUIDE_LINKS.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-full border border-brand-border px-3 py-2 text-xs font-semibold text-gray-300 hover:border-brand hover:text-brand">{label}</a>)}
        </nav>
        <div className="mt-5 divide-y divide-brand-border rounded-3xl border border-brand-border bg-brand-card px-5 sm:px-8">
          <GuideSection id="home-today-guide" title="Today’s football predictions, tomorrow’s fixtures and weekend tips">
            <p>
              Use <Link href="/predictions/today" className={LINK}>today’s football predictions</Link> when you want the current day’s published card.
              Daily views follow West Africa Time, so a late-night fixture may belong to a different calendar day from the one shown on an overseas website.
              Check the displayed date and kickoff time before comparing a tip with a bookmaker’s fixture list. Yesterday’s settled selections
              belong to the results record; they are not new recommendations for today.
            </p>
            <p>
              For a longer view, browse <Link href="/predictions/weekend" className={LINK}>weekend football predictions</Link> or the
              <Link href="/predictions/midweek" className={LINK}> midweek predictions</Link> page. These views help you find published selections
              within the relevant period without treating every upcoming fixture as an assessed match. Picks appear as analysis is published,
              and some dates or competitions may have fewer selections. Use the <Link href="/fixtures" className={LINK}>football fixtures</Link> page
              to check the wider schedule, then open the prediction where one is available.
            </p>
          </GuideSection>
          <GuideSection id="home-free-guide" title="Free football predictions and paid analysis: what can you read?">
            <p>
              BetGenius provides <Link href="/predictions/today" className={LINK}>free football predictions</Link> through public categories including
              Today, Featured, Genius and Goals. They let you examine published selections and their reasoning before deciding whether any paid
              feature is useful to you. The full Banker selections require a free account, while VIP and Premium provide access to additional
              paid categories and features. A registration requirement and a subscription requirement are different, and the page’s access message
              should tell you which applies.
            </p>
            <p>
              Compare the current <Link href="/pricing" className={LINK}>VIP and Premium plans</Link> with what you actually need, rather than assuming
              a paid label makes a match more predictable. Paying buys access to analysis; it does not buy a successful result. Start with the public
              selections, read the methodology and inspect settled outcomes across a meaningful period. BetGenius is an information platform,
              not a bookmaker, and it does not accept wagers or place bets on your behalf.
            </p>
          </GuideSection>
          <GuideSection id="home-nigeria-guide" title="Football predictions in Nigeria, with international coverage">
            <p>
              Readers looking for football predictions in Nigeria often follow several competitions at once: the Nigeria Premier Football League,
              English Premier League, European club competitions and domestic cups. BetGenius is built primarily with Nigerian readers in mind,
              while its published coverage also includes international football. West Africa Time helps keep daily cards and kickoff displays
              consistent for that audience. Coverage still depends on the fixture schedule, available data and whether a prediction has been published.
            </p>
            <p>
              Use the league links on this homepage to find the competitions with published analysis, rather than assuming every match in every league
              is covered. Competition context matters as much as the team names. A domestic league match, a group-stage fixture and a knockout cup tie
              can create different incentives, and an early cup round may offer a much smaller statistical sample. Read the stated competition and round,
              check the market’s settlement conditions, and avoid applying a league trend to a cup fixture without examining the evidence.
            </p>
          </GuideSection>
          <GuideSection id="home-banker-guide" title="Banker predictions today: a shortlist, not a guarantee">
            <p>
              <Link href="/predictions/banker" className={LINK}>Banker predictions today</Link> provide a focused shortlist of higher-confidence selections
              from the available card. The label helps readers find a smaller set to assess; it does not mean the outcomes are certain.
              A Banker can be an outright result, a double-chance selection or another eligible market, so read the actual pick instead of treating
              the category name as the bet itself. The shortlist may be smaller when fewer matches have suitable evidence.
            </p>
            <p>
              Assess each Banker individually. Combining several selections into an accumulator introduces a separate requirement: every leg must meet
              its settlement conditions. Several individually plausible picks do not become a guaranteed combined outcome. The Banker page explains
              its selection rules and historical results; compare those results over the same reporting period and remember that win rate alone
              cannot establish profit. Odds, stake sizes and the particular mix of markets also affect the financial outcome.
            </p>
          </GuideSection>
          <GuideSection id="home-markets-guide" title="Match winner, double chance, BTTS and over 2.5 goals predictions">
            <p>
              A football prediction is only useful when its market is clear. <Link href="/predictions/straight-wins" className={LINK}>Match-winner predictions</Link>
              favour an outright home or away win. <Link href="/predictions/double-chance" className={LINK}>Double-chance predictions</Link> cover two of
              the three match-result outcomes, such as home win or draw. That wider coverage changes the conditions of the selection; it does not
              make it certain. In cup football, a match-result market can also differ from a market on which team eventually qualifies.
            </p>
            <p>
              <Link href="/predictions/btts" className={LINK}>Both teams to score predictions</Link>, often called BTTS, assess whether both sides will
              score, rather than which side will win. <Link href="/predictions/over-2-5-goals" className={LINK}>Over 2.5 goals predictions</Link> concern a total
              of at least three goals under the applicable settlement rules. A game can finish 3–0 and satisfy over 2.5 while failing BTTS Yes;
              a 1–1 draw does the opposite. Match your reading of the statistics to the question that the market actually asks.
            </p>
          </GuideSection>
          <GuideSection id="home-league-guide" title="Premier League predictions and European football tips">
            <p>
              <Link href="/predictions/league/premier-league-39" className={LINK}>Premier League predictions</Link> are one route into the site’s league
              analysis. A competition page gives you a more focused view than a mixed daily card, making it easier to move between published fixtures,
              team pages and the surrounding league context. The same approach applies when browsing other domestic leagues or European competitions
              through the homepage’s league directory. Familiarity with a big club should not replace checking its current evidence.
            </p>
            <p>
              Look beyond the most recent result. Home performance and away performance can differ, while a short run of games can exaggerate a team’s
              strengths or weaknesses. Head-to-head history provides context but may span different squads, managers and seasons. Reported absences,
              limited statistical coverage and changes close to kickoff can affect the assessment. Where a match page distinguishes original prediction
              evidence from refreshed information, read those dates carefully so that later results are not mistaken for facts known before publication.
            </p>
          </GuideSection>
          <GuideSection id="home-method-guide" title="How BetGenius builds football predictions from match evidence">
            <p>
              Structured football data supports our match analysis process. Depending on the fixture’s coverage, the available evidence can include
              recent results, season records, home and away splits, scoring and conceding trends, standings, previous meetings and reported player
              availability. These inputs help support a market selection and readable reasoning. Missing statistics or team news should be treated
              as a limitation, not interpreted as a clean bill of health or a complete picture of the match.
            </p>
            <p>
              Read our <Link href="/methodology" className={LINK}>football prediction methodology</Link> to understand the evidence and its limitations.
              Confidence is an internal ranking of the strength of an assessment; it is not a calibrated probability of winning and should not be
              compared directly with a bookmaker’s implied probability as if they were the same measurement. A useful explanation should also leave
              room for counterarguments: an unavailable player, a small sample or inconsistent form can weaken an otherwise attractive selection.
            </p>
          </GuideSection>
          <GuideSection id="home-record-guide" title="How to evaluate a football prediction website’s results">
            <p>
              Judge a football prediction website by evidence you can inspect. That includes whether its selections are clearly identified, whether
              unsuccessful calls remain visible, and whether performance claims explain their sample and reporting period. BetGenius’s
              <Link href="/track-record" className={LINK}> public prediction track record</Link> includes settled wins and losses and links to monthly
              archives. Read its calculation rules before comparing two percentages: different categories or date windows can describe different sets of picks.
            </p>
            <p>
              A successful short run does not establish long-term accuracy, and accuracy by itself does not establish profitability. A high proportion
              of short-priced winning selections can still produce a loss depending on prices and stakes. Use the
              <Link href="/about" className={LINK}> About page</Link> to understand who operates BetGenius, and the
              <Link href="/editorial-policy" className={LINK}> editorial policy</Link> to read its sourcing and corrections standards. If a statement
              appears incorrect, send the exact page URL and supporting evidence through the <Link href="/contact" className={LINK}>Contact page</Link>.
            </p>
          </GuideSection>
          <GuideSection id="home-responsible-guide" title="Using football betting tips responsibly">
            <p>
              Football betting tips are information to assess, not a reliable source of income or a way to recover previous losses.
              Late team changes, ordinary match events and incomplete data can overturn an assessment that looked reasonable before kickoff.
              Keep a clear distinction between enjoying football analysis and deciding to risk money. You can read fixtures, scores and match evidence
              without placing any bet, and no selection on this site creates an obligation to participate.
            </p>
            <p>
              Betting is for adults aged 18 or older and remains subject to the rules where you live. Never borrow to bet, use money needed for
              essentials or increase stakes to chase a loss. Read our <Link href="/responsible-gambling" className={LINK}>responsible gambling guidance</Link>
              for practical steps and support. No Banker label, paid plan, confidence rating or past result changes the uncertainty of the next match.
            </p>
          </GuideSection>
        </div>
      </section>

      <section aria-labelledby="home-faq">
        <SectionHead kicker="Before you use a tip" title="Questions about BetGenius" id="home-faq" />
        <div className="divide-y divide-brand-border overflow-hidden rounded-3xl border border-brand-border bg-brand-card">
          <Question title="Is BetGenius free to use?" open>
            <p>Today’s predictions, Featured, Genius and Goals selections can be read without a paid plan. Banker picks require a free account.
              VIP and Premium add access to paid prediction categories and features. Review the current <Link href="/pricing" className={LINK}>plans and access details</Link> before paying;
              paid access does not guarantee better outcomes.</p>
          </Question>
          <Question title="When are football predictions updated?">
            <p>Selections appear as fixtures are assessed and predictions are published, so the card can change during the day.
              Daily cards use West Africa Time (Africa/Lagos). Use the date tabs to distinguish yesterday, today and tomorrow;
              an empty card means no selections are available for that view yet.</p>
          </Question>
          <Question title="What does a confidence rating mean?">
            <p>Confidence ranks the strength of the available evidence on BetGenius’s scale. It is not a calibrated chance of winning,
              a bookmaker price or a guarantee. Read the reasoning alongside the rating, and check for missing information or late team changes.</p>
          </Question>
          <Question title="Are Banker predictions guaranteed to win?">
            <p>No. Banker is a shortlist of higher-confidence selections, not a promise of a successful result.
              The number available depends on the fixture card and evidence. Read the selection rules and results on the <Link href="/predictions/banker" className={LINK}>Banker predictions page</Link>;
              combining several Bankers into an accumulator adds the requirement that every leg succeeds.</p>
          </Question>
          <Question title="How can I check the accuracy of your predictions?">
            <p>Use the <Link href="/track-record" className={LINK}>public results record</Link>, including its monthly archives,
              rather than a headline claim or a short winning streak. Compare the same category and reporting period, and read the calculation rules.
              A small sample or a high win rate is not proof of profitable betting.</p>
          </Question>
          <Question title="Which football competitions does BetGenius cover?">
            <p>Coverage spans Nigerian and international football, including domestic leagues and cup competitions.
              The league links above show competitions with published predictions. Not every fixture receives a pick, and the availability
              of statistics, team news, lineups and odds varies by match.</p>
          </Question>
          <Question title="How do I report an incorrect score, statistic or statement?">
            <p>Use the channels on our <Link href="/contact" className={LINK}>Contact page</Link> and include the match-page URL,
              the exact issue and a reliable supporting source where possible. Our editorial policy explains the corrections standard.
              Disagreeing with a selection is different from identifying an incorrect fact.</p>
          </Question>
        </div>
        <p className="mt-4 max-w-3xl text-xs leading-6 text-gray-500">
          Betting is for adults aged 18 or older. Predictions are information, not reliable income. Never borrow to bet or chase losses;
          read our <Link href="/responsible-gambling" className={LINK}>responsible gambling guidance</Link> for practical support.
        </p>
      </section>
    </>
  );
}

function Question({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group px-5 sm:px-6">
      <summary className="cursor-pointer py-5 text-sm font-bold leading-6 text-gray-100 marker:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
        {title}
      </summary>
      <div className="max-w-3xl pb-5 text-sm leading-7 text-gray-400">{children}</div>
    </details>
  );
}

function GuideSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section aria-labelledby={id} className="scroll-mt-24 py-6 sm:py-8">
    <h3 id={id} className="max-w-3xl text-lg font-bold leading-snug text-gray-100 sm:text-xl">{title}</h3>
    <div className="mt-4 max-w-3xl space-y-4 text-sm leading-7 text-gray-400">{children}</div>
  </section>;
}
