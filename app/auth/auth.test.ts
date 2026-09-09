import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "../global.d";
import type { SessionUser } from "../user";
import { sign } from "../utils/session";
import { GUEST_COOKIE, IMPERSONATE_COOKIE, createBypassAuth } from "./bypassAuth";
import { authMiddleware, fixedAuth, type AuthProvider } from "./provider";
import { sessionAuth } from "./sessionAuth";

const devUser: SessionUser = { id: "dev-user", email: "dev@localhost", name: "Dev User", avatarUrl: "" };
const other: SessionUser = { id: "scenario-typical-abc123", email: "s@scenario.invalid", name: "Scenario", avatarUrl: "" };
const SECRET = "test-secret";

/** A one-route app that reports who the middleware resolved. */
function appWith(auth: AuthProvider) {
  return new Hono<Env>()
    .use("*", authMiddleware(auth))
    .get("/whoami", (c) => c.json({ user: c.get("user") }))
    .get("/signin", async (c) => {
      await auth.signIn(c, other);
      return c.text("ok");
    })
    .get("/signout", async (c) => {
      await auth.signOut(c);
      return c.text("ok");
    });
}

const impersonateCookie = async (user: SessionUser, secret = SECRET) =>
  `${IMPERSONATE_COOKIE}=${await sign(btoa(JSON.stringify(user)), secret)}`;

const whoami = async (app: ReturnType<typeof appWith>, env: object, cookie?: string) => {
  const res = await app.request("/whoami", { headers: cookie ? { Cookie: cookie } : {} }, env);
  return (await res.json()) as { user: SessionUser | null };
};

describe("sessionAuth (production)", () => {
  const env = { SESSION_SECRET: SECRET };
  const app = appWith(sessionAuth);

  it("ignores the dev impersonation cookie entirely", async () => {
    expect((await whoami(app, env, await impersonateCookie(other))).user).toBeNull();
  });

  it("ignores the dev guest toggle too", async () => {
    const res = await app.request("/whoami?guest=1", {}, env);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("resolves its own signed session cookie only when the signature holds", async () => {
    const session = `session=${await sign(btoa(JSON.stringify(other)), SECRET)}`;
    expect((await whoami(app, env, session)).user).toEqual(other);
    const forged = `session=${await sign(btoa(JSON.stringify(other)), "wrong")}`;
    expect((await whoami(app, env, forged)).user).toBeNull();
  });
});

describe("bypassAuth (DEV_BYPASS_AUTH)", () => {
  const env = { SESSION_SECRET: SECRET, DEV_BYPASS_AUTH: "1" };
  let provisioned = 0;
  const app = appWith(
    createBypassAuth({ devUser, provisionDevUser: async () => void provisioned++ })
  );

  it("resolves the Dev User by default, provisioning it", async () => {
    const before = provisioned;
    expect((await whoami(app, env)).user).toEqual(devUser);
    expect(provisioned).toBe(before + 1);
  });

  it("resolves a signed impersonation cookie to that user without provisioning", async () => {
    const before = provisioned;
    expect((await whoami(app, env, await impersonateCookie(other))).user).toEqual(other);
    expect(provisioned).toBe(before);
  });

  it("falls back to the Dev User on a forged or garbled cookie", async () => {
    expect((await whoami(app, env, await impersonateCookie(other, "wrong"))).user).toEqual(devUser);
    expect((await whoami(app, env, `${IMPERSONATE_COOKIE}=not-a-token`)).user).toEqual(devUser);
  });

  it("signIn writes a cookie that later requests resolve", async () => {
    const res = await app.request("/signin", {}, env);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith(`${IMPERSONATE_COOKIE}=`))!;
    expect(cookie).toBeDefined();
    expect((await whoami(app, env, cookie)).user).toEqual(other);
  });

  it("guest mode wins over everything and persists via cookie", async () => {
    const res = await app.request("/whoami?guest=1", { headers: { Cookie: await impersonateCookie(other) } }, env);
    expect(((await res.json()) as { user: unknown }).user).toBeNull();
    expect(res.headers.get("set-cookie")).toContain(`${GUEST_COOKIE}=1`);
    expect((await whoami(app, env, `${GUEST_COOKIE}=1`)).user).toBeNull();
    expect((await whoami(app, env, `${GUEST_COOKIE}=1; ${await impersonateCookie(other)}`)).user).toBeNull();
  });

  it("signOut drops impersonation and switches to guest", async () => {
    const res = await app.request("/signout", { headers: { Cookie: await impersonateCookie(other) } }, env);
    const set = res.headers.getSetCookie().join("\n");
    expect(set).toContain(`${IMPERSONATE_COOKIE}=;`);
    expect(set).toContain(`${GUEST_COOKIE}=1`);
  });
});

describe("fixedAuth", () => {
  it("resolves the given user on every request", async () => {
    expect((await whoami(appWith(fixedAuth(other)), {})).user).toEqual(other);
    expect((await whoami(appWith(fixedAuth(null)), {})).user).toBeNull();
  });
});
