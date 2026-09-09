import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../global.d";
import type { AuthProvider } from "../auth/provider";
import { ensureUser, insertIcons } from "../db/icons";
import { availability, scenarioUser, type AuthState } from "./access";
import { editUrl, scenarioTag, showUrl } from "./helpers";
import type { BuildContext, Scenario, ScenarioPlan } from "./types";
import { empty } from "./empty";
import { typical } from "./typical";
import { large } from "./large";
import { editorBlank } from "./editor-blank";
import { editorComplex } from "./editor-complex";
import { publicIcon } from "./public-icon";

export const SCENARIOS: readonly Scenario[] = [
  empty,
  typical,
  large,
  editorBlank,
  editorComplex,
  publicIcon,
];

export const findScenario = (name: string) => SCENARIOS.find((s) => s.name === name);

/** Pure: the rows and redirect for a scenario, given who owns the data. */
export function buildScenario(
  scenario: Scenario,
  ctx: BuildContext
): ScenarioPlan & { tag: string } {
  return { tag: ctx.tag, ...scenario.build(ctx) };
}

/** What `?format=json` returns; also what the redirect is derived from. */
export type ScenarioResult = {
  scenario: string;
  tag: string;
  redirectTo: string;
  /** Which account owns the created data and how the browser is signed in. */
  user: { id: string; mode: "scenario-user" | "current-user" };
  /** Whether the target page is opened signed in or as a guest. */
  viewer: "user" | "guest";
  icons: { id: string; name: string; isPublic: boolean; editUrl: string; showUrl: string }[];
};

const wantsJson = (accept: string | undefined, format: string | undefined) =>
  format === "json" || (accept ?? "").split(",").some((t) => t.trim().startsWith("application/json"));

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function listPage(auth: AuthState, error: string | undefined): string {
  const mode = auth.bypass
    ? "DEV_BYPASS_AUTH 有効: 各シナリオは専用の新規ユーザを作ってログインします。"
    : auth.user
      ? `ログイン中 (${escapeHtml(auth.user.name || auth.user.email)}): データはこのアカウントに追加されます。`
      : "未ログイン: ログインが必要なシナリオは実行できません。";
  const items = SCENARIOS.map((s) => {
    const a = availability(s, auth);
    const status = a.ok
      ? `<span class="ok">利用可</span>`
      : `<span class="ng">利用不可</span> <small>${escapeHtml(a.reason)}</small>` +
        (a.loginUrl ? ` <a href="${a.loginUrl}">ログイン</a>` : "");
    return `<li>
      <div class="head"><a class="name" href="/__scenarios/${s.name}">${s.name}</a> ${status}</div>
      <p>${escapeHtml(s.description)}</p>
      <div class="links"><a href="/__scenarios/${s.name}">開く</a> · <a href="/__scenarios/${s.name}?format=json">JSON</a></div>
    </li>`;
  }).join("");
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>UI テストシナリオ - chibicon</title>
<style>
body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;max-width:52rem;margin:0 auto;padding:2rem 1.5rem;line-height:1.5}
a{color:#93c5fd}h1{font-size:1.5rem}ul{list-style:none;padding:0}li{border:1px solid #262626;border-radius:.75rem;padding:1rem;margin:.75rem 0}
.name{font-weight:600;font-size:1.1rem}.ok{color:#4ade80}.ng{color:#f87171}small{color:#a3a3a3}p{margin:.5rem 0;color:#d4d4d4}.links{font-size:.9rem}
.mode,.error{padding:.75rem 1rem;border-radius:.5rem;margin:1rem 0}.mode{background:#171717}.error{background:#450a0a;color:#fecaca}
</style></head><body>
<h1>UI テストシナリオ</h1>
<p>URL を開くだけで所定の初期状態を<strong>新規に</strong>作り、対象画面へ 303 リダイレクトします。<code>?format=json</code> で作成結果を JSON で返します。既存データは変更しません。</p>
<div class="mode">${mode}</div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
<ul>${items}</ul>
<p><a href="/">← アプリへ</a></p>
</body></html>`;
}

/**
 * Hono sub-app; mount at `/__scenarios` after the auth middleware. Signing
 * the browser in as the scenario's user goes through the app's AuthProvider,
 * so this module owns no cookie of its own.
 */
export const scenariosRouter = (auth: AuthProvider) =>
  new Hono<Env>()
  .get("/", (c) => {
    const state: AuthState = { bypass: !!c.env.DEV_BYPASS_AUTH, user: c.get("user") };
    return c.html(listPage(state, c.req.query("error")));
  })
  .get("/:name", async (c) => {
    const json = wantsJson(c.req.header("Accept"), c.req.query("format"));
    const scenario = findScenario(c.req.param("name"));
    if (!scenario) {
      return json ? c.json({ error: "Unknown scenario" }, 404) : c.notFound();
    }

    const state: AuthState = { bypass: !!c.env.DEV_BYPASS_AUTH, user: c.get("user") };
    const avail = availability(scenario, state);
    if (!avail.ok) {
      if (json) return c.json({ error: avail.reason, loginUrl: avail.loginUrl }, avail.loginUrl ? 401 : 409);
      return c.redirect(`/__scenarios?error=${encodeURIComponent(`${scenario.name}: ${avail.reason}`)}`, 303);
    }

    const db = drizzle(c.env.DB);
    const tag = scenarioTag(scenario.name);
    let userId: string;
    if (avail.mode === "scenario-user") {
      const user = scenarioUser(tag);
      await ensureUser(db, user);
      userId = user.id;
    } else {
      userId = avail.userId;
    }

    const plan = buildScenario(scenario, { userId, tag, now: new Date().toISOString() });
    await insertIcons(db, plan.icons);

    // Sign the browser in for the target page: as the throwaway user, or out
    // altogether when the page is meant to be seen as a visitor. Only the
    // throwaway case is steered; a real signed-in account is left as it is.
    const viewer: ScenarioResult["viewer"] =
      avail.mode === "scenario-user" && scenario.viewAsGuest ? "guest" : "user";
    if (avail.mode === "scenario-user") {
      if (viewer === "guest") await auth.signOut(c);
      else await auth.signIn(c, scenarioUser(tag));
    }

    if (json) {
      const result: ScenarioResult = {
        scenario: scenario.name,
        tag,
        redirectTo: plan.redirectTo,
        user: { id: userId, mode: avail.mode },
        viewer,
        icons: plan.icons.map((i) => ({
          id: i.id,
          name: i.name ?? "",
          isPublic: i.isPublic ?? false,
          editUrl: editUrl(i.id),
          showUrl: showUrl(i.id),
        })),
      };
      return c.json(result);
    }
    return c.redirect(plan.redirectTo, 303);
  });
