/**
 * A small in-memory stand-in for the Prisma client, for checks that need to
 * run query-shaped code without a database.
 *
 * It implements only the operations and filters the sitemap/scope code uses
 * (findMany, findUnique, groupBy, aggregate; equality, not, in, gte/gt/lte/lt,
 * startsWith, AND/OR/NOT; select incl. one level of relation select; orderBy
 * with Postgres null ordering), and it records every call so a check can
 * assert WHAT was read as well as what came back.
 *
 * Unordered results are shuffled with a seeded RNG, and ties under an orderBy
 * are left in that shuffled order — the database promises no order there, so
 * code under test must not depend on one.
 *
 * Semantics follow Postgres where they differ from JS: a comparison against
 * NULL is false (so `not: "X"` does not match a NULL column), ORDER BY ... DESC
 * puts NULLs first and ASC puts them last, and GROUP BY treats NULL as a group.
 */

type Row = Record<string, any>;
export type FakeTables = Record<string, Row[]>;
export type FakeCall = { model: string; method: string; args: any };

function isPlainObject(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value);
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function eq(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  return comparable(a) === comparable(b);
}

function matchOps(value: unknown, ops: Record<string, any>): boolean {
  for (const [op, operand] of Object.entries(ops)) {
    switch (op) {
      case "equals":
        if (operand === null ? value !== null : !eq(value, operand)) return false;
        break;
      case "not":
        if (operand === null) {
          if (value === null || value === undefined) return false;
        } else if (isPlainObject(operand)) {
          if (value == null || matchOps(value, operand)) return false;
        } else if (value == null || eq(value, operand)) return false;
        break;
      case "in":
        if (value == null || !(operand as unknown[]).some((o) => eq(value, o))) return false;
        break;
      case "notIn":
        if (value == null || (operand as unknown[]).some((o) => eq(value, o))) return false;
        break;
      case "gte":
        if (value == null || (comparable(value) as number) < (comparable(operand) as number)) return false;
        break;
      case "gt":
        if (value == null || (comparable(value) as number) <= (comparable(operand) as number)) return false;
        break;
      case "lte":
        if (value == null || (comparable(value) as number) > (comparable(operand) as number)) return false;
        break;
      case "lt":
        if (value == null || (comparable(value) as number) >= (comparable(operand) as number)) return false;
        break;
      case "startsWith":
        if (typeof value !== "string" || !value.startsWith(operand)) return false;
        break;
      default:
        throw new Error(`fakePrisma: unsupported filter operator "${op}"`);
    }
  }
  return true;
}

export function matchesWhere(row: Row, where: Record<string, any> | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === "AND") {
      const parts = Array.isArray(condition) ? condition : [condition];
      if (!parts.every((part) => matchesWhere(row, part))) return false;
    } else if (key === "OR") {
      if (!(condition as any[]).some((part) => matchesWhere(row, part))) return false;
    } else if (key === "NOT") {
      const parts = Array.isArray(condition) ? condition : [condition];
      if (parts.some((part) => matchesWhere(row, part))) return false;
    } else if (isPlainObject(condition)) {
      if (!matchOps(row[key], condition)) return false;
    } else if (condition === null) {
      if (row[key] !== null && row[key] !== undefined) return false;
    } else if (!eq(row[key], condition)) {
      return false;
    }
  }
  return true;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function project(row: Row, select: Record<string, any> | undefined): Row {
  if (!select) {
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) if (!Array.isArray(v) || k !== "categories") out[k] = clone(v);
    return out;
  }
  const out: Row = {};
  for (const [key, spec] of Object.entries(select)) {
    if (!spec) continue;
    if (spec === true) out[key] = clone(row[key] ?? null);
    else if (isPlainObject(spec) && spec.select) out[key] = ((row[key] ?? []) as Row[]).map((child) => project(child, spec.select));
    else throw new Error(`fakePrisma: unsupported select for "${key}"`);
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const specs: [string, "asc" | "desc"][] = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o) as [string, "asc" | "desc"][]);
  return [...rows].sort((a, b) => {
    for (const [field, dir] of specs) {
      const av = a[field] ?? null;
      const bv = b[field] ?? null;
      if (av === null && bv === null) continue;
      // Postgres: NULLS LAST for ASC, NULLS FIRST for DESC.
      if (av === null) return dir === "asc" ? 1 : -1;
      if (bv === null) return dir === "asc" ? -1 : 1;
      const x = comparable(av) as any;
      const y = comparable(bv) as any;
      if (x < y) return dir === "asc" ? -1 : 1;
      if (x > y) return dir === "asc" ? 1 : -1;
    }
    return 0;
  });
}

function aggregateFields(rows: Row[], spec: Record<string, boolean> | undefined, pick: "max" | "min"): Row | undefined {
  if (!spec) return undefined;
  const out: Row = {};
  for (const field of Object.keys(spec)) {
    let best: any = null;
    for (const row of rows) {
      const value = row[field];
      if (value == null) continue;
      if (best === null) best = value;
      else if (pick === "max" ? comparable(value)! > comparable(best)! : comparable(value)! < comparable(best)!) best = value;
    }
    out[field] = best === null ? null : clone(best);
  }
  return out;
}

export function createFakePrisma(tables: FakeTables, options: { seed?: number } = {}) {
  const calls: FakeCall[] = [];
  const random = mulberry32(options.seed ?? 1);
  const failures = new Map<string, Error>();

  function model(name: string) {
    const table = () => tables[name] ?? [];
    const record = (method: string, args: any) => {
      calls.push({ model: name, method, args: args === undefined ? undefined : clone(args) });
      const failure = failures.get(`${name}.${method}`) ?? failures.get(`${name}.*`);
      if (failure) throw failure;
    };
    return {
      async findMany(args: any = {}) {
        record("findMany", args);
        let rows = shuffle(table().filter((row) => matchesWhere(row, args.where)), random);
        rows = sortRows(rows, args.orderBy);
        if (args.take != null) rows = rows.slice(0, args.take);
        return rows.map((row) => project(row, args.select));
      },
      async findFirst(args: any = {}) {
        record("findFirst", args);
        const rows = sortRows(shuffle(table().filter((row) => matchesWhere(row, args.where)), random), args.orderBy);
        return rows[0] ? project(rows[0], args.select) : null;
      },
      async findUnique(args: any) {
        record("findUnique", args);
        const row = table().find((r) => matchesWhere(r, args.where));
        return row ? project(row, args.select) : null;
      },
      async count(args: any = {}) {
        record("count", args);
        return table().filter((row) => matchesWhere(row, args.where)).length;
      },
      async groupBy(args: any) {
        record("groupBy", args);
        const groups = new Map<string, Row[]>();
        for (const row of shuffle(table().filter((r) => matchesWhere(r, args.where)), random)) {
          const key = JSON.stringify((args.by as string[]).map((field) => comparable(row[field] ?? null)));
          const group = groups.get(key);
          if (group) group.push(row);
          else groups.set(key, [row]);
        }
        const out = [...groups.values()].map((rows) => {
          const result: Row = {};
          for (const field of args.by as string[]) result[field] = clone(rows[0][field] ?? null);
          if (args._count) result._count = { _all: rows.length };
          const max = aggregateFields(rows, args._max, "max");
          if (max) result._max = max;
          const min = aggregateFields(rows, args._min, "min");
          if (min) result._min = min;
          return result;
        });
        return sortRows(out, args.orderBy);
      },
      async aggregate(args: any) {
        record("aggregate", args);
        const rows = table().filter((r) => matchesWhere(r, args.where));
        const result: Row = {};
        if (args._count) result._count = { _all: rows.length };
        const max = aggregateFields(rows, args._max, "max");
        if (max) result._max = max;
        const min = aggregateFields(rows, args._min, "min");
        if (min) result._min = min;
        return result;
      },
    };
  }

  const models = new Map<string, ReturnType<typeof model>>();
  const client = new Proxy({} as any, {
    get(_target, property) {
      if (typeof property === "symbol" || property === "then") return undefined;
      if (property.startsWith("$")) {
        return () => {
          throw new Error(`fakePrisma: ${property} is not supported`);
        };
      }
      if (!models.has(property)) models.set(property, model(property));
      return models.get(property);
    },
  });

  return {
    client,
    calls,
    tables,
    reset() {
      calls.length = 0;
    },
    /** Make `model.method` (or `model.*`) throw until cleared. */
    failOn(target: string, error = new Error(`fakePrisma: injected failure on ${target}`)) {
      failures.set(target, error);
    },
    clearFailures() {
      failures.clear();
    },
  };
}
