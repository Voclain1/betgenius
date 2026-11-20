# Sprint 09 implementation audit

Base: latest master `1978bde`, including merged Sprint 08 PR #184. Work is isolated on `feat/sprint09-performance`; no merge or deployment is authorized.

Reuse `/track-record`, its closed-month reports, Lagos month boundaries and 20-decided minimum; existing market settlement resolver, publication-observation audit, live subscription resolver, SQL discovery-access predicate, match slugs and established server-rendered design. Existing feed-result APIs are bounded and tier-gated. Prospective Sprint 06 reliability records remain separate research evidence, never a proxy for historical published tips.

Prediction stores publication/kickoff/settlement timestamps, outcome, final scores, structured selection, category links, market confirmation and previousDrafts. Category links cross-post a single prediction; they must not multiply headline samples. previousDrafts stores superseded drafts, not a complete publication or settlement correction ledger. updatedAt is not a correction timestamp. Never label drafts as original published versions or infer an original selection from the current row. Missing original evidence must remain explicit.

Publication quote evidence is an indicative named-bookmaker median, not an executed fill. Sprint 08 publicationObservation checks evidence kind, attribution, market/selection mapping and publication/kickoff chronology. Legacy Prediction.odds and current caches cannot establish a historical entry price. Unsupported or incomplete settlements cannot establish an indicative return. Current settlement policy supports WON/LOST/VOID; no partial-return history is manufactured.

Existing Prediction indexes support status/category, publication and fixture reads, but no historical selection-version ledger exists. Dashboard queries must have bounded date windows and row caps, explicit truncation and request-specific entitlement scopes; no new schema or provider fetch is initially justified. Existing public monthly reports expose aggregate tier results but suppress dedicated paid selections. New record-level reads must apply entitlement SQL before retrieving private fields and project a narrow view.
