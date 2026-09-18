import { SCENARIO_USER_PREFIX } from "../scenarios/access";

/** Sign-up counts reported by `GET /api/stats`. */
export type UserCounts = {
  total: number;
  new_7d: number;
  new_30d: number;
};

/**
 * Count real accounts: UI-test scenario users (`scenario-…`) are throwaway and
 * excluded. `created_at` is stored as ISO 8601 (`2026-09-18T12:00:00.000Z`),
 * which does not sort against SQLite's `datetime()` text (`2026-09-18 12:00:00`)
 * — so both sides go through `datetime()` before comparing. `now` is injected
 * for tests; windows are inclusive (created exactly 7 days ago counts).
 */
export async function countUsers(db: D1Database, now: Date = new Date()): Promise<UserCounts> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(datetime(created_at) >= datetime(?1, '-7 days')), 0) AS new_7d,
         COALESCE(SUM(datetime(created_at) >= datetime(?1, '-30 days')), 0) AS new_30d
       FROM users
       WHERE id NOT LIKE ?2`
    )
    .bind(now.toISOString(), `${SCENARIO_USER_PREFIX}%`)
    .first<UserCounts>();
  return {
    total: Number(row?.total ?? 0),
    new_7d: Number(row?.new_7d ?? 0),
    new_30d: Number(row?.new_30d ?? 0),
  };
}
