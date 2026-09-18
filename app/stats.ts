import { Hono } from "hono";
import { countUsers, type UserCounts } from "./db/stats";
import type { Env } from "./global.d";

/** Repo name reported to the repos.hashrock.info dashboard. */
export const STATS_SERVICE = "grid24";

export type StatsOptions = {
  /** Injected clock, so tests can pin `generated_at` and the 7/30-day windows. */
  now?: () => Date;
};

/**
 * Constant-time string comparison. Both sides are hashed first so the byte
 * loop always runs over 32 bytes, whatever the input lengths — the length of
 * the secret is not leaked either. (Node, where the tests run, lacks the
 * Workers-only `crypto.subtle.timingSafeEqual`, so the loop is done by hand.)
 */
export async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * `GET /api/stats` — sign-up counts for the repos.hashrock.info dashboard.
 *
 * Authenticated by `Authorization: Bearer <STATS_TOKEN>` only: no session,
 * cookie or AuthProvider, so it is mounted ahead of the auth middleware.
 * Without `STATS_TOKEN` configured the endpoint does not exist (404).
 */
export function statsRouter({ now = () => new Date() }: StatsOptions = {}) {
  const router = new Hono<Env>();

  router.get("/", async (c) => {
    const expected = c.env.STATS_TOKEN;
    if (!expected) return c.notFound();

    const header = c.req.header("Authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!(await tokenMatches(given, expected))) {
      c.header("Cache-Control", "no-store");
      return c.json({ error: "Unauthorized" }, 401);
    }

    const at = now();
    const users: UserCounts = await countUsers(c.env.DB, at);
    c.header("Cache-Control", "no-store");
    return c.json({ service: STATS_SERVICE, generated_at: at.toISOString(), users });
  });

  return router;
}
