import { TopTrendsPanel } from "@/components/TopTrendsPanel";

/**
 * Puts the Top trends panel beside every prediction page.
 *
 * From `xl` the panel is a right-hand column; below it, it follows the page
 * content so the predictions themselves stay first on a phone. The layout
 * reads no data (the panel fetches /api/top-trends), so each page keeps
 * whatever static or dynamic rendering it already had.
 */
export default function PredictionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start xl:gap-6">
      <div className="min-w-0">{children}</div>
      <aside className="mt-10 xl:mt-0">
        <TopTrendsPanel />
      </aside>
    </div>
  );
}
