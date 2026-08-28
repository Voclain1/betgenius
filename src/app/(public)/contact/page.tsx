import { Mail, ShieldCheck, BriefcaseBusiness, Wrench } from "lucide-react";
import { PolicyCallout, TrustPage } from "@/components/trust/TrustPage";
import { trustMetadata } from "@/lib/trustMetadata";

export const metadata = trustMetadata("Contact BetGenius", "Contact BetGenius about editorial corrections, account support, privacy, advertising or business enquiries.", "/contact");

const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
const enquiries = [
  ["Editorial and corrections", "Report a factual error and include the page URL, the statement concerned and any supporting source.", Mail],
  ["Technical and account support", "Describe what happened, the page involved and the time of the issue. Never send your password or full payment-card details.", Wrench],
  ["Privacy", "Ask about personal data, access, correction or deletion. We may need to verify identity before acting.", ShieldCheck],
  ["Advertising and business", "Clearly identify your organisation and proposal. Commercial enquiries do not influence prediction conclusions.", BriefcaseBusiness],
] as const;

export default function ContactPage() {
  return <TrustPage eyebrow="Contact" title="Get in touch with BetGenius" intro={<p>Choose the enquiry type below and include enough context for the team to investigate. Please do not send passwords, card numbers or other unnecessary sensitive information.</p>} sections={[
    { id: "enquiries", title: "What can we help with?", content: <div className="grid gap-3 sm:grid-cols-2">{enquiries.map(([title, text, Icon]) => <div key={title} className="rounded-xl border border-brand-border bg-brand-card p-4"><Icon className="text-brand" size={20} aria-hidden="true"/><h3 className="mt-3 font-semibold text-gray-100">{title}</h3><p className="mt-1 text-sm leading-6 text-gray-400">{text}</p></div>)}</div> },
    { id: "contact-channel", title: "Contact channel", content: contactEmail ? <><p>Email <a className="font-medium text-brand underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>. Add a clear subject such as “Correction”, “Account support”, “Privacy request” or “Business enquiry”.</p><p>Response times can vary with the complexity of the request.</p></> : <PolicyCallout tone="warning"><strong>A public BetGenius contact inbox has not yet been configured.</strong> We will publish it here once ownership is verified. Until then, do not rely on addresses presented elsewhere as official. The site operator must set <code>NEXT_PUBLIC_CONTACT_EMAIL</code> before launch of this page.</PolicyCallout> },
    { id: "privacy-safety", title: "Privacy and account safety", content: <ul><li>Do not send your password, one-time code or full card details.</li><li>For a privacy request, state the email connected to your account but avoid attaching identity documents unless specifically and securely requested.</li><li>BetGenius will never ask you to pay to submit a correction or support request.</li></ul> },
  ]} />;
}
