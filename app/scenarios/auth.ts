import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import type { SessionUser } from "../user";
import type { Scenario } from "./types";

/**
 * How a scenario signs the browser in. Scenarios never bypass auth on their
 * own: with DEV_BYPASS_AUTH on they lean on the existing dev bypass, and
 * without it they only ever add data to the account that is already signed in.
 */

/**
 * Under DEV_BYPASS_AUTH, this cookie points the dev bypass at a throwaway user
 * a scenario created, instead of the fixed Dev User. It is ignored entirely
 * when the bypass is off, and only ids carrying the scenario prefix qualify,
 * so it cannot be aimed at a real account even in dev.
 */
export const SCENARIO_USER_COOKIE = "dev_user";
export const SCENARIO_USER_PREFIX = "scenario-";

export function scenarioUserRow(tag: string) {
  return {
    id: tag,
    email: `${tag}@scenario.invalid`,
    name: `Scenario ${tag.slice(SCENARIO_USER_PREFIX.length)}`,
    avatarUrl: "",
  };
}

/** The user id a `dev_user` cookie may select, or null if it names none. */
export function scenarioUserIdFromCookie(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const id = decodeURIComponent(cookieValue);
  if (!id.startsWith(SCENARIO_USER_PREFIX)) return null;
  if (!/^[a-z0-9-]+$/i.test(id)) return null;
  return id;
}

/** Resolve the cookie to a real scenario user, or null (unset / unknown). */
export async function findScenarioUser(
  db: DrizzleD1Database,
  cookieValue: string | undefined
): Promise<SessionUser | null> {
  const id = scenarioUserIdFromCookie(cookieValue);
  if (!id) return null;
  const row = await db.select().from(users).where(eq(users.id, id)).get();
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name ?? "", avatarUrl: row.avatarUrl ?? "" };
}

export type AuthState = { bypass: boolean; user: SessionUser | null };

export type Availability =
  | { ok: true; mode: "scenario-user" }
  | { ok: true; mode: "current-user"; userId: string }
  | { ok: false; reason: string; loginUrl?: string };

/** Whether — and as whom — a scenario can run for this request. */
export function availability(scenario: Scenario, auth: AuthState): Availability {
  if (auth.bypass) return { ok: true, mode: "scenario-user" };
  if (scenario.needs === "fresh-user") {
    return {
      ok: false,
      reason:
        "新規ユーザが必要なシナリオは DEV_BYPASS_AUTH が有効なローカル環境でのみ実行できます。",
    };
  }
  if (!auth.user) {
    return {
      ok: false,
      reason: "ログインが必要です。ログイン後にもう一度開いてください。",
      loginUrl: "/auth/google",
    };
  }
  return { ok: true, mode: "current-user", userId: auth.user.id };
}
