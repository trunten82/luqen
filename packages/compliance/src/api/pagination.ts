export interface PaginationParams {
  readonly limit: number;
  readonly offset: number;
}

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const rawLimit = query.limit;
  const rawOffset = query.offset;

  let limit = 50;
  let offset = 0;

  if (rawLimit !== undefined) {
    const parsed = parseInt(String(rawLimit), 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 200);
    }
  }

  if (rawOffset !== undefined) {
    const parsed = parseInt(String(rawOffset), 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }

  return { limit, offset };
}

export function paginateArray<T>(
  items: readonly T[],
  params: PaginationParams,
): { data: readonly T[]; total: number; limit: number; offset: number } {
  const total = items.length;
  const data = items.slice(params.offset, params.offset + params.limit);
  return { data, total, limit: params.limit, offset: params.offset };
}
