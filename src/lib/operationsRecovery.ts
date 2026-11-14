import { prisma } from "./prisma";
import { matchKey } from "./slug";
import { executeOperation, operationIdentity } from "./operationExecution";
import { freshness, freshnessThresholds } from "./predictionOperations";
export type RecoveryAction = "REFRESH_ODDS" | "RETRY_SETTLEMENT";
export function recoveryAuthorized(role: string | undefined) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
export async function planRecovery(
  action: RecoveryAction,
  predictionId: string,
  now = new Date(),
) {
  const p = await prisma.prediction.findUnique({ where: { id: predictionId } });
  const reasons: string[] = [];
  if (!p)
    return {
      eligible: false,
      reasons: ["NOT_FOUND"],
      key: null,
      prediction: null,
    };
  if (p.status !== "PUBLISHED") reasons.push("NOT_PUBLISHED");
  if (!p.kickoff || !p.fixtureApiId) reasons.push("MISSING_FIXTURE_IDENTITY");
  if (action === "REFRESH_ODDS") {
    if (!p.kickoff || +p.kickoff - +now < 60 * 60000)
      reasons.push("INSUFFICIENT_LEAD_TIME");
    const key = matchKey(p);
    const q = key
      ? await prisma.fixtureOddsCache.findUnique({ where: { matchKey: key } })
      : null;
    const state = freshness({
      fetchedAt: q?.fetchedAt ?? null,
      now,
      maxMinutes: freshnessThresholds().odds,
      lastError: q?.lastError,
    });
    const updated = (q?.oddsJson as { update?: string } | null)?.update;
    const provider = freshness({
      fetchedAt: updated ? new Date(updated) : null,
      now,
      maxMinutes: freshnessThresholds().odds,
    });
    if (state.status === "FRESH" && provider.status === "FRESH")
      reasons.push("LOCAL_AND_PROVIDER_QUOTES_FRESH");
  } else {
    if (p.outcome !== "PENDING" || p.manualSettlementOnly)
      reasons.push("MANUAL_OR_ALREADY_SETTLED");
    if (!p.kickoff || +now - +p.kickoff < 110 * 60000)
      reasons.push("NOT_DUE_FOR_SETTLEMENT");
  }
  return {
    eligible: !reasons.length,
    reasons,
    key: `${action}:${p.id}:${now.toISOString().slice(0, 13)}`,
    prediction: p,
  };
}
export async function recoverOperation(input: {
  action: RecoveryAction;
  predictionId: string;
  dryRun: boolean;
  role: string | undefined;
  actorId: string;
  reason: string;
  expectedKey?: string;
  authorizePublishedChange?: boolean;
}) {
  if (!recoveryAuthorized(input.role)) throw new Error("FORBIDDEN");
  const plan = await planRecovery(input.action, input.predictionId);
  const preview = {
    eligible: plan.eligible,
    reasons: plan.reasons,
    key: plan.key,
    action: input.action,
    predictionId: input.predictionId,
    dryRun: true,
  };
  if (input.dryRun) return preview;
  if (process.env.OPS_RECOVERY_MODE !== "manual")
    return { ...preview, status: "DISABLED" };
  if (
    input.expectedKey &&
    input.expectedKey === plan.key &&
    input.authorizePublishedChange
  ) {
    const receipt = await prisma.jobRun.findUnique({
      where: { id: operationIdentity(input.expectedKey) },
    });
    if ((receipt?.detail as any)?.status === "SUCCEEDED")
      return { status: "SUCCEEDED", id: receipt!.id, replayed: true };
  }
  if (
    !input.authorizePublishedChange ||
    !plan.eligible ||
    !plan.key ||
    input.expectedKey !== plan.key
  )
    return { ...preview, status: "REQUIRES_VALID_PREVIEW_AND_AUTHORIZATION" };
  return executeOperation({
    key: plan.key,
    resource: `${input.action}:${input.predictionId}`,
    actorId: input.actorId,
    reason: input.reason,
    run: async (lease) => {
      // Revalidate dependencies after acquiring the resource lease, before any provider/write work.
      const current = await planRecovery(input.action, input.predictionId);
      if (!current.eligible || current.key !== plan.key || !current.prediction)
        return {
          ok: false,
          detail: { reason: "DEPENDENCIES_CHANGED", reasons: current.reasons },
        };
      if (input.action === "REFRESH_ODDS") {
        const { refreshOddsCache } = await import("./enrichment");
        const p = current.prediction,
          key = matchKey(p);
        if (!key || !p.fixtureApiId || !p.kickoff)
          return { ok: false, detail: { reason: "MISSING_IDENTITY" } };
        const result = await refreshOddsCache(
          {
            matchKey: key,
            fixtureApiId: p.fixtureApiId,
            kickoff: p.kickoff,
            kind: "published",
          },
          lease,
        );
        return { ok: result.result === "ok", detail: result };
      }
      const { settleFinishedPredictions } = await import("./settleFinished");
      const result = await settleFinishedPredictions(1, [input.predictionId]);
      return {
        ok: result.results.some((r) =>
          ["WON", "LOST", "VOID", "already_settled"].includes(r.result),
        ),
        detail: result,
      };
    },
  });
}
