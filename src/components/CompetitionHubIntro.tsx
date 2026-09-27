export function CompetitionHubIntro({ heading, intro }: { heading: string; intro: string }) {
  return (
    <>
      <details className="card group md:hidden">
        <summary className="cursor-pointer list-none text-sm font-semibold text-brand">
          <span className="group-open:hidden">About these {heading.toLowerCase()} +</span>
          <span className="hidden group-open:inline">Close guide −</span>
        </summary>
        <p className="mt-3 text-sm leading-6 text-gray-300">{intro}</p>
      </details>
      <p className="hidden max-w-3xl text-sm leading-6 text-gray-300 md:block">{intro}</p>
    </>
  );
}
