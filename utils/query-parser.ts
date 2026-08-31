// src/utils/query-parser.ts
const OPERATOR_MAP: Record<string, string> = {
  $gte: 'gte', $lte: 'lte', $gt: 'gt', $lt: 'lt', $ne: 'not', $in: 'in',
};

export function parseQueryFilter(queryDict: Record<string, unknown> | null): Record<string, unknown> {
  if (!queryDict) return {};
  const where: Record<string, unknown> = {};
  for (const [field, condition] of Object.entries(queryDict)) {
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      const clause: Record<string, unknown> = {};
      for (const [op, val] of Object.entries(condition as Record<string, unknown>)) {
        const prismaOp = OPERATOR_MAP[op];
        if (prismaOp) clause[prismaOp] = val;
      }
      where[field] = clause;
    } else {
      where[field] = condition;
    }
  }
  return where;
}

export function parseSort(sort: string | undefined): Record<string, 'asc' | 'desc'> | undefined {
  if (!sort) return undefined;
  return sort.startsWith('-') ? { [sort.slice(1)]: 'desc' } : { [sort]: 'asc' };
}