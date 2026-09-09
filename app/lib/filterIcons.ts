/**
 * Client-side name filter for icon lists (my icons, the gallery).
 *
 * The lists have no server-side search; once there are dozens of icons the
 * only way to find one was to scroll. A case-insensitive partial match on
 * the name (and, where present, the author) is the smallest thing that
 * fixes that.
 */

export type Named = { name: string; authorName?: string | null };

/** Show the filter box once the list is long enough that scanning it is work. */
export const FILTER_THRESHOLD = 8;

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Icons whose name (or author) contains `query`, case-insensitively. An empty
 * query returns the list unchanged, in its original order.
 */
export function filterByName<T extends Named>(items: readonly T[], query: string): T[] {
  const q = normalizeQuery(query);
  if (!q) return [...items];
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      (item.authorName ?? "").toLowerCase().includes(q)
  );
}
