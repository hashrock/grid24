import type { SessionUser } from "../user";
import type { Scenario } from "./types";

/**
 * Whether — and as whom — a scenario can run. Scenarios never bypass auth on
 * their own: with DEV_BYPASS_AUTH on they sign a throwaway user in through
 * the app's AuthProvider, and without it they only ever add data to the
 * account that is already signed in.
 */

export const SCENARIO_USER_PREFIX = "scenario-";

export function scenarioUser(tag: string): SessionUser {
  return {
    id: tag,
    email: `${tag}@scenario.invalid`,
    name: `Scenario ${tag.slice(SCENARIO_USER_PREFIX.length)}`,
    avatarUrl: "",
  };
}

export type AuthState = { bypass: boolean; user: SessionUser | null };

export type Availability =
  | { ok: true; mode: "scenario-user" }
  | { ok: true; mode: "current-user"; userId: string }
  | { ok: false; reason: string; loginUrl?: string };

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
