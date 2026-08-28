import { PolicyCallout, TrustLink, TrustPage } from "@/components/trust/TrustPage";
import { trustMetadata } from "@/lib/trustMetadata";

export const metadata = trustMetadata("Cookie Policy", "Learn which cookies BetGenius uses now and how analytics, advertising and affiliate cookies would be handled.", "/cookie-policy");
const date = "28 August 2026";

export default function CookiePolicyPage() {
  return <TrustPage eyebrow="Legal" title="Cookie policy" effectiveDate={date} intro={<p>Cookies are small text files stored by a browser. Similar technologies can store identifiers or measure how a service is used. This policy distinguishes what BetGenius uses now from technologies that may be introduced later.</p>} sections={[
    { id: "essential", title: "Essential cookies", content: <p>BetGenius uses cookies or browser storage needed for authentication sessions, account security and basic product operation. These technologies cannot always be disabled through the site without breaking login or other requested features.</p> },
    { id: "preferences", title: "Preferences and functionality", content: <p>The site stores your light, dark or system theme choice on your device so the interface can remember it. Other functional preferences may be added when needed and documented here.</p> },
    { id: "analytics", title: "Analytics cookies", content: <p>The current application does not include a Google Analytics tag. If analytics is introduced, it may use cookies or similar technologies to understand page use and performance. Where consent is required, non-essential analytics will not be enabled before that choice.</p> },
    { id: "advertising", title: "Advertising cookies", content: <><p>The current application does not include a Google AdSense tag. If advertising is introduced, Google and other advertising partners may use cookies or similar identifiers to serve, limit and measure ads, and to personalise them where permitted.</p><PolicyCallout>BetGenius does not claim AdSense approval or Google endorsement. This policy describes how advertising technology will be handled if it is enabled.</PolicyCallout></> },
    { id: "affiliate", title: "Affiliate and third-party cookies", content: <p>When you follow a bookmaker or other affiliate link, the third party may set a cookie or record an identifier to attribute a registration or transaction. BetGenius does not control those third-party cookies. Review the destination site’s policy and our <TrustLink href="/affiliate-disclosure">Affiliate Disclosure</TrustLink>.</p> },
    { id: "controls", title: "Managing cookies", content: <><p>You can block or delete cookies in your browser settings. Doing so may sign you out, reset preferences or prevent parts of the site from working.</p><p>BetGenius does not currently provide an on-site cookie-preferences panel because no non-essential analytics or advertising tag is active. A consent mechanism must be added before non-essential technologies that require consent are enabled.</p></> },
    { id: "changes", title: "Updates and questions", content: <p>We will update this policy when our use of cookies changes. For privacy questions, read the <TrustLink href="/privacy-policy">Privacy Policy</TrustLink> or use the verified channel on the <TrustLink href="/contact">Contact page</TrustLink>.</p> },
  ]} />;
}
