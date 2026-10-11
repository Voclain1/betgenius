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
];

export function guideBySlug(slug: string): Guide | null {
  return GUIDES.find((guide) => guide.slug === slug) ?? null;
}

