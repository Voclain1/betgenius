import Link from "next/link";

const groups = [
  { title: "Company", links: [["About", "/about"], ["Contact", "/contact"], ["Methodology", "/methodology"], ["Editorial Policy", "/editorial-policy"]] },
  { title: "Legal", links: [["Privacy Policy", "/privacy-policy"], ["Terms of Use", "/terms"], ["Cookie Policy", "/cookie-policy"], ["Betting Disclaimer", "/betting-disclaimer"], ["Affiliate Disclosure", "/affiliate-disclosure"]] },
  { title: "Responsible betting", links: [["Responsible Gambling", "/responsible-gambling"], ["Track Record", "/track-record"], ["Pricing", "/pricing"]] },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-brand-border bg-brand-card/40">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.3fr,1fr,1fr,1fr]">
          <div>
            <Link href="/" className="text-xl font-bold tracking-tight"><span className="text-brand">Bet</span>Genius</Link>
            {/* Positioning copy, addressed to a first-time visitor deciding
                whether this site is worth reading. Someone who installed the
                app has already made that decision, so in app context this is
                the one piece of footer chrome that is purely web-oriented.
                The link columns and the 18+ line below are NOT marked: the
                legal, responsible-gambling and affiliate links are compliance
                surface, and hiding those in a betting app is not a
                presentation decision to make quietly. */}
            <p data-web-only className="mt-3 max-w-xs text-sm leading-6 text-gray-400">Football predictions, match analysis and statistics designed to help readers assess the evidence—not promise an outcome.</p>
          </div>
          {groups.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-sm font-semibold text-gray-100">{group.title}</h2>
              <ul className="mt-3 space-y-2">
                {group.links.map(([label, href]) => <li key={href}><Link href={href} className="text-sm text-gray-400 hover:text-brand">{label}</Link></li>)}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-8 border-t border-brand-border pt-6 text-xs leading-5 text-gray-500">
          <p><strong className="text-gray-300">18+ only.</strong> Gamble responsibly. BetGenius content is informational, outcomes remain uncertain, and no prediction guarantees winnings. Never stake money you cannot afford to lose.</p>
          <p className="mt-3">© {new Date().getFullYear()} BetGenius. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
