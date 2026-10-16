import type { ReactNode } from "react";

export type Guide = {
  slug: string;
  title: string;
  description: string;
  summary: string;
  publishedAt: string;
  reviewedAt: string;
  readingTime: string;
  sections: { id: string; title: string; content: ReactNode }[];
  related: { href: string; label: string; description: string }[];
};

export const GUIDES: Guide[] = [
  {
    slug: "how-to-read-football-predictions",
    title: "How to read football predictions",
    description: "Learn how to interpret a football prediction, its market, confidence rating, evidence and risk before making your own decision.",
    summary: "A practical guide to separating the pick from the evidence, understanding confidence correctly and checking what could change before kick-off.",
    publishedAt: "2026-09-27",
    reviewedAt: "2026-09-27",
    readingTime: "6 min read",
    sections: [
      { id: "start-with-market", title: "Start with the market", content: <><p>A prediction only makes sense inside its stated market. “Home win”, “over 2.5 goals” and “both teams to score” answer different questions about the same match. Read the market and selection together before considering the supporting argument.</p><p>A strong case for one market does not automatically support another. Evidence that points to goals, for example, may say little about which team will win.</p></> },
      { id: "confidence", title: "What confidence means", content: <><p>BetGenius confidence compares the strength of the available evidence. It is not a literal probability, a bookmaker price or a guarantee that the selection will win.</p><p>Use it to compare assessments on the platform, then read the reasoning. A high score with incomplete or changing team information still carries risk.</p></> },
      { id: "evidence", title: "Check the evidence behind the pick", content: <ul><li>Recent results and whether they came at home or away.</li><li>Goals scored and conceded, including clean sheets and failures to score.</li><li>League position and the number of matches behind the table.</li><li>Head-to-head history, without allowing old meetings to outweigh current form.</li><li>Known injuries, suspensions, line-ups and other time-sensitive information.</li></ul> },
      { id: "limits", title: "Look for limits and counter-signals", content: <p>A useful prediction explains uncertainty rather than hiding it. Small samples, contradictory form, unavailable team news and late changes can weaken an otherwise reasonable assessment. Red cards, penalties and ordinary match variance can defeat good pre-match reasoning.</p> },
      { id: "record", title: "Use the settled record", content: <p>Judge a prediction process across a meaningful sample containing wins and losses. Do not treat one winning streak as proof, and do not rely on claims that omit unsuccessful selections. BetGenius retains settled outcomes in its public track record.</p> },
      { id: "responsibility", title: "Make your own decision", content: <p>Predictions are informational, not instructions to bet. If you choose to gamble, remain within legal age and location requirements, never chase losses and never stake money you cannot afford to lose.</p> },
    ],
    related: [
      { href: "/methodology", label: "Prediction methodology", description: "See how BetGenius assesses evidence and measures results." },
      { href: "/track-record", label: "Public track record", description: "Review settled wins, losses, voids and sample sizes." },
      { href: "/responsible-gambling", label: "Responsible gambling", description: "Read the risk and support guidance before betting." },
    ],
  },
  {
    slug: "football-odds-and-implied-probability",
    title: "Football odds and implied probability, explained",
    description: "How decimal odds turn into a percentage, what the bookmaker's margin is, and how to compare a price with a prediction's confidence.",
    summary: "Read any price as a probability in one step, see the margin built into a market, and compare a bookmaker's view with a prediction's confidence.",
    publishedAt: "2026-10-11",
    reviewedAt: "2026-10-11",
    readingTime: "7 min read",
    sections: [
      { id: "decimal-odds", title: "What decimal odds tell you", content: <><p>Decimal odds show the total return for each unit staked, stake included. At 2.50, a ₦1,000 stake returns ₦2,500 if it wins: ₦1,500 profit plus the ₦1,000 back. Fractional 6/4 and American +150 describe the same price.</p><p>The lower the number, the more likely the bookmaker thinks the outcome is, and the less a win pays.</p></> },
      { id: "implied-probability", title: "Turning a price into a probability", content: <><p>Divide 1 by the decimal odds. A price of 2.50 implies 1 ÷ 2.50 = 0.40, a 40% chance. A price of 1.25 implies 80%.</p><p>That figure is the price&apos;s break-even point. A selection at 2.50 has to win more than 40% of the time over many bets just to cover its losses.</p></> },
      { id: "margin", title: "The bookmaker's margin", content: <><p>Add the implied probabilities of every outcome in a market and the total comes to more than 100%. Take home 2.10, draw 3.40 and away 3.60: 47.6% + 29.4% + 27.8% = 104.8%. The extra 4.8% is the margin, and it is why the prices pay slightly less than the true chances would justify.</p><p>To estimate the market&apos;s fair view, divide each figure by the total. The home side&apos;s 47.6% becomes 47.6 ÷ 1.048, about 45.4%.</p></> },
      { id: "confidence", title: "Comparing a price with a prediction", content: <><p>BetGenius confidence is an assessment of the evidence, not a bookmaker price. When our confidence for a pick sits well above the market&apos;s fair probability, the two disagree, and it is worth reading the reasoning to see why. When they sit close together, the market and the analysis point the same way.</p><p>Neither number is a promise. A 75% assessment is expected to lose roughly one time in four over a long run.</p></> },
      { id: "takeaways", title: "Key points", content: <ul><li>Implied probability is 1 divided by the decimal odds.</li><li>Every market carries a margin; remove it before comparing.</li><li>A short price is a likely outcome, not a certain one.</li><li>Judge any source over many settled picks, never one result.</li></ul> },
    ],
    related: [
      { href: "/odds-calculator", label: "Odds to probability calculator", description: "Any price as a percentage, and a market's margin removed." },
      { href: "/guides/how-to-read-football-predictions", label: "How to read football predictions", description: "Market, confidence and evidence, in the order to check them." },
      { href: "/responsible-gambling", label: "Responsible gambling", description: "Limits and support before you stake anything." },
    ],
  },
  {
    slug: "over-under-goals-explained",
    title: "Over and under goals markets, explained",
    description: "How over/under 1.5, 2.5 and 3.5 goals bets settle, why half-goal lines cannot draw, and what decides a total-goals prediction.",
    summary: "What the line means, how each total settles with real scorelines, and the evidence that matters for a goals prediction.",
    publishedAt: "2026-10-11",
    reviewedAt: "2026-10-11",
    readingTime: "6 min read",
    sections: [
      { id: "the-line", title: "What the line means", content: <><p>A total-goals market asks whether the match will produce more or fewer goals than a line. Over 2.5 wins with three or more goals; under 2.5 wins with two or fewer. Both teams&apos; goals count together.</p><p>Half-goal lines such as 1.5, 2.5 and 3.5 cannot land exactly, so there is always a winner and a loser.</p></> },
      { id: "settling", title: "How real scorelines settle", content: <ul><li>2–1 (three goals): over 2.5 wins, under 2.5 loses.</li><li>1–1 (two goals): under 2.5 wins, over 1.5 wins, over 2.5 loses.</li><li>0–0: every &quot;under&quot; line wins and every &quot;over&quot; line loses.</li><li>4–0: over 3.5 wins; the goals do not need to come from both teams.</li></ul> },
      { id: "regulation-time", title: "Regulation time only", content: <p>Goals markets settle on the score at the end of normal time, including stoppage time. Extra time and penalty shootouts in cup ties do not count. A cup tie that is 1–1 after 90 minutes settles as two goals even if it finishes 3–2 after extra time.</p> },
      { id: "evidence", title: "What drives a goals prediction", content: <ul><li>Each side&apos;s recent scoring and conceding, home and away separately.</li><li>How often each team&apos;s matches have gone over the line this season.</li><li>Missing strikers or defenders, and likely line-ups.</li><li>Match context: a team that only needs a draw may play more cautiously.</li></ul> },
      { id: "takeaways", title: "Key points", content: <ul><li>Over 2.5 needs three goals or more; under 2.5 needs two or fewer.</li><li>Only the total matters, not which team scores.</li><li>Extra time does not count.</li></ul> },
    ],
    related: [
      { href: "/predictions/over-2-5-goals", label: "Over 2.5 goals predictions", description: "Today's over 2.5 picks with the evidence behind them." },
      { href: "/predictions/goals", label: "Goals predictions", description: "Over 1.5 and over 2.5 picks in one feed." },
      { href: "/track-record#market-over-25", label: "Over 2.5 track record", description: "How the over 2.5 picks have done this month." },
    ],
  },
  {
    slug: "both-teams-to-score-explained",
    title: "Both teams to score (BTTS), explained",
    description: "How BTTS yes and no bets settle, which scorelines win, and the evidence behind a both-teams-to-score prediction.",
    summary: "BTTS asks one question: will each team score at least once? Here is how it settles and what to look at before trusting a pick.",
    publishedAt: "2026-10-11",
    reviewedAt: "2026-10-11",
    readingTime: "5 min read",
    sections: [
      { id: "the-question", title: "One question, two answers", content: <p>&quot;Both teams to score: yes&quot; wins when each side scores at least one goal. &quot;No&quot; wins when at least one side fails to score. The total does not matter, only whether both teams find the net.</p> },
      { id: "settling", title: "How real scorelines settle", content: <ul><li>1–1, 2–1 and 3–2: BTTS yes wins.</li><li>0–0, 2–0 and 4–0: BTTS no wins.</li><li>An own goal counts for the team it is credited to, so it can complete a BTTS yes.</li><li>Like goals markets, it settles on the score after normal time; extra time does not count.</li></ul> },
      { id: "evidence", title: "What drives a BTTS prediction", content: <ul><li>How often each team scores, and how often it keeps a clean sheet, home and away.</li><li>Whether a side relies on one goalscorer who may be missing.</li><li>Defensive absences that make a usually tight team concede.</li><li>Head-to-head meetings, weighed lightly: squads change between seasons.</li></ul> },
      { id: "combinations", title: "BTTS with other markets", content: <p>BTTS yes and over 2.5 goals often agree, but not always: a 1–1 wins BTTS yes and loses over 2.5, while a 3–0 does the opposite. Treat them as separate questions with separate evidence.</p> },
      { id: "takeaways", title: "Key points", content: <ul><li>Yes needs a goal from each side; no needs a clean sheet from either.</li><li>The total does not matter.</li><li>Clean-sheet and failed-to-score records are the core evidence.</li></ul> },
    ],
    related: [
      { href: "/predictions/btts", label: "BTTS predictions", description: "Today's both-teams-to-score picks." },
      { href: "/track-record#market-btts", label: "BTTS track record", description: "How BTTS picks have done this month." },
      { href: "/guides/over-under-goals-explained", label: "Over and under goals, explained", description: "The other common goals market, and how it differs." },
    ],
  },
  {
    slug: "double-chance-explained",
    title: "Double chance betting, explained",
    description: "How 1X, X2 and 12 double chance bets work, why the prices are short, and how double chance compares with draw no bet.",
    summary: "Double chance covers two of the three results. Here is what that buys, what it costs, and when it is the more sensible market.",
    publishedAt: "2026-10-11",
    reviewedAt: "2026-10-11",
    readingTime: "6 min read",
    sections: [
      { id: "three-options", title: "The three options", content: <ul><li><strong>1X</strong>: the home team wins or the match is drawn.</li><li><strong>X2</strong>: the away team wins or the match is drawn.</li><li><strong>12</strong>: either team wins; only a draw loses.</li></ul> },
      { id: "price", title: "Why the prices are short", content: <><p>Covering two outcomes makes a win more likely, so it pays less. With home at 2.10 and draw at 3.40, their implied chances are 47.6% and 29.4%, together 77%. That puts 1X near 1.30 before the bookmaker&apos;s margin, and the quoted price will usually be a little lower.</p><p>A ₦1,000 stake at 1.30 returns ₦1,300 if it wins: ₦300 profit.</p></> },
      { id: "draw-no-bet", title: "Double chance or draw no bet?", content: <p>Draw no bet backs one team and returns the stake if the match is drawn. Double chance 1X wins on a draw instead of refunding. Double chance is the safer of the two and pays less; draw no bet pays more and only refunds the draw.</p> },
      { id: "when", title: "When it makes sense", content: <p>Double chance suits a side the evidence rates clearly, but in a match where a draw is a real possibility: an away team in good form against a stubborn host, for example. It does not turn a weak case into a strong one; a short price still loses sometimes, and the small profit leaves little room for those losses.</p> },
      { id: "takeaways", title: "Key points", content: <ul><li>1X and X2 each cover a team and the draw; 12 covers both teams.</li><li>More cover means shorter prices and smaller returns.</li><li>A 1.30 price must win about 77% of the time just to break even.</li></ul> },
    ],
    related: [
      { href: "/predictions/double-chance", label: "Double chance predictions", description: "Today's double chance picks and the reasoning behind them." },
      { href: "/guides/football-odds-and-implied-probability", label: "Odds and implied probability", description: "How to read a short price as a percentage." },
      { href: "/track-record#market-double-chance", label: "Double chance track record", description: "How double chance picks have done this month." },
    ],
  },
  {
    slug: "how-accumulators-work",
    title: "How accumulators work, and why the risk compounds",
    description: "How accumulator odds multiply, why every extra leg makes a win much less likely, and how to judge a multi bet honestly.",
    summary: "An accumulator's odds multiply, and so do its risks. A worked example shows how quickly the chance of every leg landing falls.",
    publishedAt: "2026-10-11",
    reviewedAt: "2026-10-11",
    readingTime: "7 min read",
    sections: [
      { id: "multiplying", title: "The odds multiply", content: <p>An accumulator combines several selections into one bet, and every one must win. The prices multiply: three legs at 1.50, 1.60 and 1.80 give 1.50 × 1.60 × 1.80 = 4.32. A ₦1,000 stake returns ₦4,320 if all three land.</p> },
      { id: "probability", title: "So does the risk", content: <><p>The chances multiply too. Four legs that are each 70% likely sound strong, but all four landing is 0.7 × 0.7 × 0.7 × 0.7, about 24%. Roughly three times in four, at least one leg fails and the whole bet loses.</p><p>Each leg also carries the bookmaker&apos;s margin, and those margins compound with every leg added. A long accumulator is usually priced further from fair than any single bet in it.</p></> },
      { id: "one-leg", title: "One leg is enough to lose", content: <p>An accumulator does not pay part of the return for most legs winning. Four winners and one late equaliser is a losing bet. That is why a few strong legs usually make a better accumulator than many average ones.</p> },
      { id: "judging", title: "Judging a multi bet", content: <ul><li>Check each leg on its own evidence before combining it.</li><li>Avoid adding a leg only to raise the price.</li><li>Legs from the same match can be linked: a home win and over 2.5 goals often land or fail together.</li><li>Stake what you can afford to lose entirely, which is the usual outcome.</li></ul> },
      { id: "takeaways", title: "Key points", content: <ul><li>Accumulator odds and probabilities both multiply.</li><li>Four 70% legs together land about 24% of the time.</li><li>Every leg must win; there is no partial return.</li></ul> },
    ],
    related: [
      { href: "/multi-bets", label: "Multi bets", description: "Curated accumulators built from published picks." },
      { href: "/bet-builder", label: "Bet builder", description: "Combine picks and see the combined odds before you stake." },
      { href: "/responsible-gambling", label: "Responsible gambling", description: "Limits and support before you stake anything." },
    ],
  },
  {
    slug: "staking-and-betting-limits",
    title: "Staking and limits: betting within your means",
    description: "How to set a betting budget, choose a fixed stake, and handle losing runs without chasing losses.",
    summary: "A budget set in advance and a fixed, small stake protect you from the losing runs every bettor meets, however good the picks are.",
    publishedAt: "2026-10-11",
    reviewedAt: "2026-10-11",
    readingTime: "6 min read",
    sections: [
      { id: "budget", title: "Set the budget first", content: <p>Decide, before the month starts, the amount you could lose without it affecting rent, food, school fees, transport, savings or debt payments. That figure is the whole budget, and it is spent money, not an investment. If no such amount exists this month, the right stake is nothing.</p> },
      { id: "fixed-stake", title: "Use a small, fixed stake", content: <><p>A fixed stake keeps one bad week from ending the month. With a ₦20,000 monthly budget, a 2% stake is ₦400 a bet. Keep the stake the same after wins and after losses.</p><p>Raising the stake after a loss to win it back is chasing, and it turns a manageable loss into a serious one.</p></> },
      { id: "losing-runs", title: "Expect losing runs", content: <><p>Even picks that win 60% of the time lose often. The chance of five straight losses on any given five bets is 0.4 multiplied by itself five times, about 1%. Over hundreds of bets, a run like that is expected rather than unusual.</p><p>A losing run is not a sign that a win is due. Each match is separate.</p></> },
      { id: "records", title: "Keep a record", content: <p>Write down every deposit, stake and withdrawal, not just the wins. A monthly total tells you honestly where you stand; memory tends to keep the wins and lose the rest.</p> },
      { id: "help", title: "If it stops being fun", content: <p>Use your operator&apos;s deposit, stake and time limits, take breaks, and stop when the budget is gone. If betting causes stress, debt or secrecy, step away and talk to someone. Our responsible gambling page lists where to get support.</p> },
    ],
    related: [
      { href: "/responsible-gambling", label: "Responsible gambling", description: "Limits, warning signs and where to get support." },
      { href: "/guides/how-accumulators-work", label: "How accumulators work", description: "Why multi bets lose more often than they look." },
      { href: "/track-record", label: "This month's track record", description: "Wins and losses, published as they settle." },
    ],
  },
  {
    slug: "what-is-a-banker-bet",
    title: "What a banker bet is, and what it is not",
    description: "What a banker bet means in football, why a banker can still lose, and how BetGenius chooses its daily banker picks.",
    summary: "A banker is the most confident pick on a card, not a guaranteed one. Here is what that means at a short price.",
    publishedAt: "2026-10-11",
    reviewedAt: "2026-10-11",
    readingTime: "5 min read",
    sections: [
      { id: "meaning", title: "What \"banker\" means", content: <p>A banker is the selection a tipster or bettor trusts most on a given day: usually a strong favourite at a short price. In an accumulator it is the leg everything else is built around.</p> },
      { id: "not-certain", title: "Short is not certain", content: <><p>A price of 1.30 implies about a 77% chance, so a fairly priced banker at 1.30 is still expected to lose roughly one time in four. Upsets, red cards and late goals happen to favourites every week.</p><p>That is also why a banker on its own pays little: ₦1,000 at 1.30 returns ₦300 profit.</p></> },
      { id: "how-we-choose", title: "How BetGenius chooses bankers", content: <p>Bankers are the highest-confidence picks on the day&apos;s card, from any competition, with a confidence rating of at least 75 and one pick per match. The list is capped at seven rather than filled to a target. A day with no strong case gets fewer picks, not weaker ones. Every Banker result, win or lose, is listed day by day at the foot of the Banker page.</p> },
      { id: "using", title: "Using a banker sensibly", content: <ul><li>Read the reasoning and check the team news before kickoff.</li><li>Do not raise your stake because a pick is called a banker.</li><li>Adding one to an accumulator raises that bet&apos;s risk; it does not remove it.</li></ul> },
      { id: "takeaways", title: "Key points", content: <ul><li>A banker is the most confident pick, not a sure one.</li><li>At 1.30, a banker should be expected to lose about one time in four.</li><li>Judge bankers over a full month of results.</li></ul> },
    ],
    related: [
      { href: "/predictions/banker", label: "Banker predictions", description: "Today's banker picks and their past results." },
      { href: "/track-record#category-banker", label: "Banker track record", description: "The Banker win rate for the current month." },
      { href: "/guides/football-odds-and-implied-probability", label: "Odds and implied probability", description: "How a short price turns into a percentage." },
    ],
  },
  {
    slug: "sure-odds-and-correct-score-scams",
    title: "Sure odds and correct score tips are scams",
    description: "Why paid sure odds, fixed matches and guaranteed correct score tips are fraud, how the scam works, and how to protect your money.",
    summary: "No one can sell a guaranteed result. Here is how sure-odds and correct-score sellers take your money, the warning signs, and what to do if you have paid.",
    publishedAt: "2026-10-16",
    reviewedAt: "2026-10-16",
    readingTime: "6 min read",
    sections: [
      { id: "no-sure-odds", title: "There is no such thing as sure odds", content: <><p>Every football match can be decided by a deflection, a red card, an injury or a goal in the 94th minute. Bookmakers know this, which is why even the shortest favourite is priced to lose some of the time. A seller who promises &quot;sure odds&quot;, a &quot;100% banker&quot; or a &quot;sure win&quot; is claiming to know something the whole betting market does not.</p><p>If anyone really could predict results with certainty, they would quietly bet on them, not sell them to strangers on WhatsApp, Telegram or Instagram.</p></> },
      { id: "correct-score", title: "Why paid correct score tips are a con", content: <><p>Correct score is a real market, but it is the hardest one to call. Even the most likely scoreline in a typical match, often 1–0 or 1–1, usually happens only around one time in eight to one time in ten. That is why correct score prices of 6.00 to 10.00 and higher are normal.</p><p>A seller offering &quot;guaranteed correct scores&quot; or &quot;fixed matches&quot; for a fee is selling something that does not exist. Genuine match-fixing is a crime investigated by football authorities and the police; its organisers do not advertise it to the public for a subscription.</p></> },
      { id: "how-it-works", title: "How the scam usually works", content: <ul><li><strong>Shotgun tipping:</strong> the seller sends different scorelines to different groups of buyers. Whichever group happens to win becomes the &quot;proof&quot;, and the losers are blocked or told they were unlucky.</li><li><strong>Edited winning slips:</strong> screenshots of huge winning tickets are easy to fake or to book after the match has finished.</li><li><strong>Escalating fees:</strong> a small first payment is followed by &quot;VIP&quot; or &quot;fixed game&quot; fees, then a &quot;refund&quot; charge when the tip loses.</li><li><strong>Pressure:</strong> &quot;only three slots left&quot;, &quot;pay before kickoff&quot;, &quot;send to this account now&quot;.</li></ul> },
      { id: "warning-signs", title: "Warning signs", content: <ul><li>Words like &quot;sure&quot;, &quot;guaranteed&quot;, &quot;fixed&quot;, &quot;100%&quot; or &quot;risk-free&quot;.</li><li>No full record of every tip, losses included, published before kickoff.</li><li>Payment only by direct bank transfer or airtime to a personal account.</li><li>Requests for your betting account login, BVN, card details or one-time codes.</li><li>Accounts that change names, numbers or channels after a run of losses.</li></ul> },
      { id: "what-honest-tips-look-like", title: "What honest tips look like", content: <><p>An honest prediction service shows a confidence rating, explains its reasoning and publishes every result, including the losses. BetGenius does exactly that: no pick is described as certain, and every settled tip stays in the public track record so you can judge the method over a full month, not a single slip.</p><p>Even a strong 80% assessment is expected to lose about one time in five. Anyone who tells you otherwise is not being honest with you.</p></> },
      { id: "if-you-paid", title: "If you have already paid", content: <ul><li>Stop paying. A &quot;refund fee&quot; or &quot;unlock fee&quot; is part of the same scam.</li><li>Keep screenshots of the chats, account numbers and payment receipts.</li><li>Contact your bank straight away and ask them to flag the receiving account.</li><li>Report the account to the platform it used, and report the fraud to the police or the EFCC.</li><li>Never share your PIN, password or one-time codes with anyone who promises to recover your money.</li></ul> },
      { id: "takeaways", title: "Key points", content: <ul><li>No football result can be guaranteed, so &quot;sure odds&quot; cannot exist.</li><li>Paid fixed matches and guaranteed correct scores are fraud.</li><li>Trust only tips with a full, public record of wins and losses.</li><li>Never stake money you cannot afford to lose.</li></ul> },
    ],
    related: [
      { href: "/track-record", label: "Public track record", description: "Every settled BetGenius tip, wins and losses alike." },
      { href: "/guides/football-odds-and-implied-probability", label: "Odds and implied probability", description: "Why even short prices lose some of the time." },
      { href: "/responsible-gambling", label: "Responsible gambling", description: "Limits, warning signs and where to get support." },
    ],
  },
];

export function guideBySlug(slug: string): Guide | null {
  return GUIDES.find((guide) => guide.slug === slug) ?? null;
}

