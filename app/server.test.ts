import { describe, expect, it } from "vitest";
import { createApp } from "./server";
import { fixedAuth } from "./auth";
import type { SessionUser } from "./user";
import type { Env } from "./global.d";

/**
 * Handlers exercised with an injected AuthProvider: no cookies, no OAuth, and
 * — for the routes chosen here — no database either, so `env` can stay empty.
 */
const user: SessionUser = { id: "u-1", email: "u@example.com", name: "Pat", avatarUrl: "" };

describe("createApp({ auth })", () => {
  it("signed-out requests to the dashboard are sent to the landing page", async () => {
    const res = await createApp({ auth: fixedAuth(null) }).request("/icons", {}, {});
    expect(res.status).toBe(302);
    // With the reason, so the landing page can say "log in first" instead of
    // silently showing the gallery.
    expect(res.headers.get("location")).toBe("/?notice=login-required");
  });

  it("an unknown page gets a 404 with a way back, not bare text", async () => {
    const res = await createApp({ auth: fixedAuth(null) }).request("/no-such-page", {}, {});
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("ページが見つかりません");
    expect(html).toContain('href="/"');
  });

  it("signed-out autosave is rejected with 401", async () => {
    const res = await createApp({ auth: fixedAuth(null) }).request(
      "/api/icons/x",
      { method: "PUT", body: "{}" },
      {}
    );
    expect(res.status).toBe(401);
  });

  it("the scenario list shows who is signed in and what that allows", async () => {
    const res = await createApp({ auth: fixedAuth(user) }).request("/__scenarios", {}, {});
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ログイン中 (Pat)");
    // Without the bypass a fresh-user scenario is off the table, the rest are on.
    expect(html).toMatch(/href="\/__scenarios\/empty">empty<\/a> <span class="ng">/);
    expect(html).toMatch(/href="\/__scenarios\/typical">typical<\/a> <span class="ok">/);
  });

  it("a fresh-user scenario is refused as JSON without touching the database", async () => {
    const res = await createApp({ auth: fixedAuth(user) }).request(
      "/__scenarios/empty?format=json",
      {},
      {}
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("DEV_BYPASS_AUTH") });
  });

  it("a signed-out visitor is asked to log in", async () => {
    const res = await createApp({ auth: fixedAuth(null) }).request(
      "/__scenarios/typical",
      { headers: { Accept: "application/json" } },
      {}
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ loginUrl: "/auth/google" });
  });
});

/**
 * Just enough D1 for the single-table lookup `GET /i/:id.svg` makes: Drizzle
 * asks a prepared statement for raw rows, so the stub answers with that
 * route's selected columns, in the order its `select()` names them.
 */
type IconRow = {
  id: string;
  content: string;
  isPublic: boolean;
  userId: string;
  updatedAt: string;
};

const iconDb = (rows: IconRow[]) =>
  ({
    prepare: () => ({
      bind: (...params: unknown[]) => ({
        raw: async () =>
          rows
            .filter((r) => params.includes(r.id))
            .map((r) => [r.content, r.isPublic ? 1 : 0, r.userId, r.updatedAt]),
      }),
    }),
  }) as unknown as Env["Bindings"]["DB"];

/** A single horizontal stroke — enough to tell "drew something" from "didn't". */
const CONTENT = JSON.stringify([
  {
    id: "s1",
    pathId: "p1",
    p1: { x: 4, y: 12 },
    c1: { x: 4, y: 12 },
    c2: { x: 20, y: 12 },
    p2: { x: 20, y: 12 },
  },
]);

const published: IconRow = {
  id: "pub",
  content: CONTENT,
  isPublic: true,
  userId: "u-2",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const draft: IconRow = { ...published, id: "draft", isPublic: false, userId: user.id };

const svgEnv = { DB: iconDb([published, draft]) } as Env["Bindings"];

describe("GET /i/:id.svg", () => {
  it("serves a public icon as an SVG file anyone can hotlink", async () => {
    const res = await createApp({ auth: fixedAuth(null) }).request("/i/pub.svg", {}, svgEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("public");
    const svg = await res.text();
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path ");
  });

  it("shapes the file from the query string", async () => {
    const res = await createApp({ auth: fixedAuth(null) }).request(
      "/i/pub.svg?size=48&color=ff5722&stroke=1.5",
      {},
      svgEnv
    );
    const svg = await res.text();
    expect(svg).toContain('width="48" height="48"');
    expect(svg).toContain('stroke="#ff5722"');
    expect(svg).toContain('stroke-width="1.5"');
  });

  it("hides an unpublished icon from everyone but its owner", async () => {
    const hidden = await createApp({ auth: fixedAuth(null) }).request("/i/draft.svg", {}, svgEnv);
    expect(hidden.status).toBe(404);
    // Plain text, not the HTML 404 page — the caller here is an <img>.
    expect(hidden.headers.get("content-type")).toContain("text/plain");

    const owner = await createApp({ auth: fixedAuth(user) }).request("/i/draft.svg", {}, svgEnv);
    expect(owner.status).toBe(200);
    // Never in a shared cache: the next visitor must not be handed a draft.
    expect(owner.headers.get("cache-control")).toBe("private, no-store");
  });

  it("404s an id nobody owns", async () => {
    const res = await createApp({ auth: fixedAuth(user) }).request("/i/nope.svg", {}, svgEnv);
    expect(res.status).toBe(404);
  });

  it("re-serves a cached file as 304", async () => {
    const app = createApp({ auth: fixedAuth(null) });
    const first = await app.request("/i/pub.svg", {}, svgEnv);
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    const again = await app.request("/i/pub.svg", { headers: { "If-None-Match": etag } }, svgEnv);
    expect(again.status).toBe(304);
  });

  it("leaves the icon page to the page route", async () => {
    // Same prefix, no `.svg`: this must reach `/i/:id`, whose miss is the
    // HTML 404 with a way back — not this route's plain text.
    const res = await createApp({ auth: fixedAuth(null) }).request("/i/pub", {}, svgEnv);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("ページが見つかりません");
  });
});
