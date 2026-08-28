import { AffiliateDisclosure } from "@/components/AffiliateDisclosure";
import { TrustLink, TrustPage } from "@/components/trust/TrustPage";
import { trustMetadata } from "@/lib/trustMetadata";

export const metadata = trustMetadata("Affiliate Disclosure", "How BetGenius identifies bookmaker affiliate links and protects the independence of football analysis.", "/affiliate-disclosure");

export default function AffiliateDisclosurePage() {
  return <TrustPage eyebrow="Commercial transparency" title="Affiliate disclosure" intro={<p>BetGenius may receive compensation from selected third parties, including betting operators. This page explains what that means for readers and for our editorial work.</p>} sections={[
    { id: "short-disclosure", title: "The short version", content: <AffiliateDisclosure /> },
    { id: "how-it-works", title: "How affiliate links work", content: <p>When a link is an affiliate link, a third party may record that you arrived from BetGenius. We may earn a commission if you click, register, deposit or transact, depending on the agreement. A commission does not normally add a separate charge to the price shown to you, but you should review the operator’s own terms.</p> },
    { id: "independence", title: "Analysis remains independent", content: <p>Commercial relationships should not determine a prediction, confidence assessment or analytical conclusion. We do not raise a pick’s confidence because a bookmaker is featured. Our standards are described in the <TrustLink href="/editorial-policy">Editorial Policy</TrustLink>.</p> },
    { id: "third-parties", title: "Third-party responsibility", content: <p>BetGenius does not control a bookmaker’s site, account checks, odds, withdrawals, promotions or customer service. Eligibility, geographic restrictions, bonus terms and availability can change. Decide independently whether an operator is suitable and lawful for you.</p> },
    { id: "identification", title: "How we identify commercial links", content: <p>Buttons and links that can generate commission use appropriate sponsored-link markup and should appear with a concise disclosure near the relevant commercial choice. Advertising and sponsorship should be distinguishable from editorial analysis.</p> },
  ]} />;
}
