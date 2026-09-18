import { describe, expect, it } from "vitest";
import { createApp } from "./server";
import { countUsers } from "./db/stats";
import { tokenMatches } from "./stats";
import type { AuthProvider } from "./auth";

/**
 * `countUsers` runs real SQL against Node's built-in SQLite behind a minimal
 * D1 shim (`prepare().bind().first()`), so the date arithmetic is SQLite's own.
 * The specifier is a variable: the project has no @types/node.
 */
const SQLITE = "node:sqlite";
type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { run(...a: unknown[]): void; get(...a: unknown[]): unknown };
};
const { DatabaseSync } = (await import(/* @vite-ignore */ SQLITE)) as {
  DatabaseSync: new (path: string) => SqliteDb;
};

function testDb(users: { id: string; createdAt: string }[]): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL)"
  );
  const insert = sqlite.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)");
  for (const u of users) insert.run(u.id, `${u.id}@example.com`, u.createdAt);
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
      }),
    }),
  } as unknown as D1Database;
}

const NOW = new Date("2026-09-18T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

describe("countUsers", () => {
  it("counts an account created exactly 7 / 30 days ago, not one a second earlier", async () => {
    const db = testDb([
      { id: "a", createdAt: ago(7 * DAY) },
      { id: "b", createdAt: ago(7 * DAY + 1000) },
      { id: "c", createdAt: ago(30 * DAY) },
      { id: "d", createdAt: ago(30 * DAY + 1000) },
    ]);
    expect(await countUsers(db, NOW)).toEqual({ total: 4, new_7d: 1, new_30d: 3 });
  });

  it("leaves out UI-test scenario users", async () => {
    const db = testDb([
      { id: "real", createdAt: ago(DAY) },
      { id: "scenario-typical-abc123", createdAt: ago(DAY) },
      { id: "scenario-empty-def456", createdAt: ago(40 * DAY) },
    ]);
    expect(await countUsers(db, NOW)).toEqual({ total: 1, new_7d: 1, new_30d: 1 });
  });

  it("reports zeros, not nulls, for an empty table", async () => {
    expect(await countUsers(testDb([]), NOW)).toEqual({ total: 0, new_7d: 0, new_30d: 0 });
  });
});

describe("tokenMatches", () => {
  it("accepts only the exact token", async () => {
    expect(await tokenMatches("s3cret", "s3cret")).toBe(true);
    expect(await tokenMatches("s3cre", "s3cret")).toBe(false);
    expect(await tokenMatches("", "s3cret")).toBe(false);
  });
});

describe("GET /api/stats", () => {
  // The endpoint must never ask "who is signed in": a provider that throws
  // proves it is served ahead of the auth middleware.
  const noAuth: AuthProvider = {
    resolve: () => {
      throw new Error("auth consulted");
    },
    signIn: async () => {},
    signOut: async () => {},
  };
  const app = createApp({ auth: noAuth, stats: { now: () => NOW } });
  const env = (extra: Record<string, unknown> = {}) => ({
    DB: testDb([
      { id: "u1", createdAt: ago(DAY) },
      { id: "u2", createdAt: ago(60 * DAY) },
      { id: "scenario-x-1", createdAt: ago(DAY) },
    ]),
    ...extra,
  });
  const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

  it("is a 404 while STATS_TOKEN is unset", async () => {
    const res = await app.request("/api/stats", bearer("anything"), env());
    expect(res.status).toBe(404);
  });

  it("rejects a wrong or missing token with 401", async () => {
    const wrong = await app.request("/api/stats", bearer("nope"), env({ STATS_TOKEN: "tok" }));
    expect(wrong.status).toBe(401);
    const missing = await app.request("/api/stats", {}, env({ STATS_TOKEN: "tok" }));
    expect(missing.status).toBe(401);
    const notBearer = await app.request(
      "/api/stats",
      { headers: { Authorization: "tok" } },
      env({ STATS_TOKEN: "tok" })
    );
    expect(notBearer.status).toBe(401);
  });

  it("returns the counts, uncached, for the right token", async () => {
    const res = await app.request("/api/stats", bearer("tok"), env({ STATS_TOKEN: "tok" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      service: "grid24",
      generated_at: "2026-09-18T12:00:00.000Z",
      users: { total: 2, new_7d: 1, new_30d: 1 },
    });
  });
});
