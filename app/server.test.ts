import { describe, expect, it } from "vitest";
import { createApp } from "./server";
import { fixedAuth } from "./auth";
import type { SessionUser } from "./user";

/**
 * Handlers exercised with an injected AuthProvider: no cookies, no OAuth, and
 * — for the routes chosen here — no database either, so `env` can stay empty.
 */
const user: SessionUser = { id: "u-1", email: "u@example.com", name: "Pat", avatarUrl: "" };

describe("createApp({ auth })", () => {
  it("signed-out requests to the dashboard are sent to the landing page", async () => {
    const res = await createApp({ auth: fixedAuth(null) }).request("/icons", {}, {});
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
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
