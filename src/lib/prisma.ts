import { PrismaClient } from "@prisma/client";

import { PREDICTION_SLUG_SOURCE_FIELDS, derivePredictionSlugs } from "@/lib/slug";

/**
 * A Prisma update value may be written either bare (`kickoff: d`) or wrapped
 * (`kickoff: { set: d }`). Both mean the same thing; only the bare form is
 * readable without unwrapping, so normalise before deciding anything.
 */
function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && !(value instanceof Date) && "set" in (value as Record<string, unknown>)) {
    return (value as { set: unknown }).set;
  }
  return value;
}

/** True when a write payload touches any field a slug key is derived from. */
function touchesSlugSource(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return PREDICTION_SLUG_SOURCE_FIELDS.some((field) => field in record);
}

type SlugKeys = ReturnType<typeof derivePredictionSlugs>;

function slugsFor(row: Record<string, unknown>): SlugKeys {
  return derivePredictionSlugs({
    leagueName: unwrap(row.leagueName) as string | null | undefined,
    leagueApiId: unwrap(row.leagueApiId) as number | null | undefined,
    homeTeam: unwrap(row.homeTeam) as string | null | undefined,
    awayTeam: unwrap(row.awayTeam) as string | null | undefined,
    kickoff: unwrap(row.kickoff) as Date | string | null | undefined,
  });
}

function differs(row: Record<string, unknown>, next: SlugKeys): boolean {
  return (Object.keys(next) as (keyof SlugKeys)[]).some((key) => (row[key] ?? null) !== next[key]);
}

function createPrismaClient() {
  const base = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });

  /**
   * Keeps Prediction's denormalised slug keys correct. See the block comment on
   * those columns in prisma/schema.prisma for why they exist and why this — not
   * a Postgres generated column — is where they are maintained.
   *
   * create/createMany derive from the payload, which necessarily carries every
   * source field. update/upsert cannot: a settlement write sends `kickoff`
   * alone, and matchSlugKey depends on the teams too. So those recompute from
   * the row the write RETURNS and patch only when the result actually differs,
   * which costs a second round-trip on the rare write that moves a kickoff and
   * nothing at all on the common ones. The patch touches slug columns only, so
   * it cannot re-enter this branch.
   */
  return base.$extends({
    name: "prediction-slug-keys",
    query: {
      prediction: {
        async create({ args, query }) {
          args.data = { ...args.data, ...slugsFor(args.data as Record<string, unknown>) };
          return query(args);
        },
        async createMany({ args, query }) {
          const data = args.data;
          args.data = Array.isArray(data)
            ? data.map((row) => ({ ...row, ...slugsFor(row as Record<string, unknown>) }))
            : { ...data, ...slugsFor(data as Record<string, unknown>) };
          return query(args);
        },
        async update({ args, query }) {
          const result = await query(args);
          if (!touchesSlugSource(args.data)) return result;
          return reconcile(result);
        },
        async upsert({ args, query }) {
          const result = await query(args);
          return reconcile(result);
        },
      },
    },
  });

  async function reconcile(result: unknown) {
    if (!result || typeof result !== "object") return result;
    const row = result as Record<string, unknown>;
    if (typeof row.id !== "string") return result;
    const next = slugsFor(row);
    if (!differs(row, next)) return result;
    return base.prediction.update({ where: { id: row.id }, data: next });
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
