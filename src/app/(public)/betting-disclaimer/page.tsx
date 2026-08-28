import { PolicyCallout, TrustLink, TrustPage } from "@/components/trust/TrustPage";
import { trustMetadata } from "@/lib/trustMetadata";

export const metadata = trustMetadata("Betting Disclaimer", "Important information about the uncertainty, financial risk and legal responsibility involved in using BetGenius football predictions.", "/betting-disclaimer");
const date = "28 August 2026";

export default function BettingDisclaimerPage() {
  return <TrustPage eyebrow="Important information" title="Betting disclaimer" effectiveDate={date} intro={<p>BetGenius provides football information, analytical estimates and opinions. It is not a bookmaker, and its content is not a promise of profit or a substitute for your own judgement.</p>} sections={[
    { id: "no-guarantees", title: "Predictions are not guarantees", content: <><PolicyCallout tone="warning"><strong>Football outcomes are uncertain.</strong> A prediction, confidence rating or favourable statistical pattern can be wrong. You may lose some or all of the money you stake.</PolicyCallout><p>Late injuries, line-up and tactical changes, red cards, weather, data delays, officiating decisions and ordinary randomness can change an outcome. Past performance does not guarantee future results.</p></> },
    { id: "your-decision", title: "Your decision and financial risk", content: <p>You decide independently whether to bet, which operator to use and how much to stake. Never bet money you cannot afford to lose, never borrow to gamble, and do not treat betting as income, an investment or a financial strategy. Nothing on BetGenius is financial advice.</p> },
    { id: "information", title: "Information can change", content: <p>We work to present useful information, but statistics, schedules, team news, odds and competition details can be delayed, incomplete or corrected after publication. Verify time-sensitive information with the competition or operator before acting.</p> },
    { id: "law", title: "Age and local law", content: <p>Betting may be prohibited or restricted in your jurisdiction. BetGenius is intended only for adults aged 18 or older, and you are responsible for complying with the law, licensing rules and operator terms that apply where you are.</p> },
    { id: "third-parties", title: "Bookmakers and external links", content: <p>A link to a bookmaker or other third party is not a guarantee, endorsement of an outcome or assurance that the service is lawful or available to you. Third parties control their own prices, promotions, eligibility checks and terms. Some links may be commercial; see our <TrustLink href="/affiliate-disclosure">Affiliate Disclosure</TrustLink>.</p> },
    { id: "help", title: "Keep gambling in perspective", content: <p>If gambling stops feeling controlled or affordable, stop and seek support. Our <TrustLink href="/responsible-gambling">Responsible Gambling guide</TrustLink> lists practical warning signs and immediate steps.</p> },
  ]} />;
}
