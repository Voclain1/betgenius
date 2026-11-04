import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { PredictionTimeline } from "@/components/PredictionTimeline";
import { PREDICTION_PAGE_SIZE, pages, splitByKickoff } from "@/lib/predictionTimeline";
import type { PredictionRow } from "@/components/PredictionCard";
import type { PredictionTableRow } from "@/components/PredictionsTable";
import type { PredictionView } from "@/lib/predictionView";

type Row = PredictionRow & PredictionTableRow;

/**
 * The league, cup and team pages' prediction list: upcoming picks first, then
 * played ones behind a "Hide past" band, each paged (see PredictionTimeline).
 * `pageSize` sets each group's page; `pastCollapsed` starts the played
 * group hidden behind "Show past" (competition pages).
 * Every page is a CategoryPredictionsList in the requested view, rendered here
 * on the server.
 */
export function PredictionTimelineList({
  rows,
  view,
  reasoningExcerpt = false,
  emptyUpcoming,
  pageSize = PREDICTION_PAGE_SIZE,
  pastCollapsed = false,
  now = new Date(),
}: {
  rows: Row[];
  view: PredictionView;
  reasoningExcerpt?: boolean;
  emptyUpcoming: string;
  pageSize?: number;
  pastCollapsed?: boolean;
  now?: Date;
}) {
  const { upcoming, past } = splitByKickoff(rows, now);
  const render = (page: Row[]) => <CategoryPredictionsList rows={page} view={view} reasoningExcerpt={reasoningExcerpt} />;
  return (
    <PredictionTimeline
      upcoming={pages(upcoming, pageSize).map(render)}
      past={pages(past, pageSize).map(render)}
      upcomingCount={upcoming.length}
      pastCount={past.length}
      pageSize={pageSize}
      pastCollapsed={pastCollapsed}
      emptyUpcoming={emptyUpcoming}
    />
  );
}
