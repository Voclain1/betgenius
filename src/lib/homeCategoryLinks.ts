/**
 * The category buttons on the homepage, in display order.
 *
 * Labels say "Tips" on purpose: a bare "Banker" or "VIP" button reads as a
 * section name, not as a list of predictions to open. Kept out of the page
 * file so scripts/check-prediction-view.tsx can assert the list without
 * rendering the homepage, which needs a database.
 */
export const HOME_CATEGORY_LINKS: { label: string; href: string }[] = [
  { label: "Banker Tips", href: "/predictions/banker" },
  { label: "Today's Tips", href: "/predictions/today" },
  { label: "Premium Tips", href: "/predictions/premium" },
  { label: "VIP Tips", href: "/predictions/vip" },
  { label: "Goals Tips", href: "/predictions/goals" },
  { label: "Multi Bet Tips", href: "/multi-bets" },
];
