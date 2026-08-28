import { PolicyCallout, TrustLink, TrustPage } from "@/components/trust/TrustPage";
import { trustMetadata } from "@/lib/trustMetadata";

export const metadata = trustMetadata("About BetGenius", "Learn how BetGenius approaches football predictions, match analysis and statistics for Nigerian and international readers.", "/about");

export default function AboutPage() {
  return <TrustPage eyebrow="Company" title="Football analysis that shows its reasoning" intro={<p>BetGenius is a football predictions, match-preview and statistics platform built primarily for Nigerian football fans, with coverage spanning major competitions around the world.</p>} sections={[
    { id: "what-we-do", title: "What we do", content: <><p>We turn available match information into readable predictions and supporting analysis. A published pick may include a recommended market, confidence rating, recent form, home and away performance, standings, goals trends, head-to-head history and relevant team news.</p><p>The aim is to help readers make a more informed assessment. BetGenius does not place bets for users and is not a bookmaker.</p></> },
    { id: "our-standard", title: "Our standard", content: <><p>We favour evidence that can be traced to real fixtures and team data. Where coverage is incomplete, stale or contradictory, that limitation matters. Our <TrustLink href="/methodology">prediction methodology</TrustLink> explains the signals we use and the limits of the process.</p><PolicyCallout>No analyst or statistical pattern can guarantee a football result. A strong assessment is still a probability, not a promise.</PolicyCallout></> },
    { id: "not-sure-odds", title: "Not a “sure odds” platform", content: <p>BetGenius does not present uncertain events as fixed, risk-free, certain or guaranteed. We publish reasoning and maintain a settled-results record so readers can assess our work rather than rely on slogans. Past results do not guarantee future performance.</p> },
    { id: "who-we-serve", title: "Who we serve", content: <p>Our language, pricing and product decisions are shaped first for Nigerian readers, while the site remains accessible internationally. Visitors are responsible for following the gambling laws and age restrictions that apply where they live.</p> },
    { id: "contact", title: "Questions and accountability", content: <p>Read our <TrustLink href="/editorial-policy">editorial policy</TrustLink> for sourcing and corrections standards, or use the channels listed on our <TrustLink href="/contact">Contact page</TrustLink> to raise a factual, technical, privacy or business enquiry.</p> },
  ]} />;
}
