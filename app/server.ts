import { Hono } from "hono";
import { inertia } from "@hono/inertia";
import { googleAuth } from "@hono/oauth-providers/google";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import { rootView } from "./root-view";
import { users, icons } from "./db/schema";
import { createIcon, seedStarterIcons } from "./db/icons";
import { DEV_USER, authMiddleware, envAuth, type AuthProvider } from "./auth";
import { scenariosRouter } from "./scenarios";
import type { Env } from "./global.d";
import type { NotFoundResponse } from "hono/types";

export type AppOptions = {
  /**
   * Who a request belongs to. Defaults to the deployed behaviour (session
   * cookie, or the dev bypass under DEV_BYPASS_AUTH); tests hand in a fixed
   * user so handlers can be exercised without cookies or a database.
   */
  auth?: AuthProvider;
};

/** Where signed-out visitors of a signed-in-only page are sent, with the reason. */
export const LOGIN_REQUIRED = "/?notice=login-required";

/**
 * A 404 page a person can act on: the bare "404 Not Found" text left users of
 * a private / deleted icon link with nothing to click.
 */
export function notFoundHtml(): string {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>見つかりません — chibicon</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#e5e5e5;font-family:system-ui,sans-serif;text-align:center;padding:24px}
h1{font-size:20px;margin:0 0 12px}p{color:#a3a3a3;font-size:14px;line-height:1.7;margin:0 0 20px}a{display:inline-block;color:#fff;border:1px solid #525252;border-radius:8px;padding:8px 16px;text-decoration:none;font-size:14px}a:hover{border-color:#fff}</style></head>
<body><main><h1>ページが見つかりません</h1><p>アイコンが非公開になったか、削除された可能性があります。<br>リンクの送り主に確認するか、ギャラリーから探してみてください。</p><a href="/">ギャラリーへ戻る</a></main></body></html>`;
}

export function createApp({ auth = envAuth }: AppOptions = {}) {
  const app = new Hono<Env>();

  // @hono/inertia types the not-found handler as a text response; the cast
  // keeps the HTML page while satisfying that declaration.
  app.notFound((c) => c.html(notFoundHtml(), 404) as unknown as NotFoundResponse);

  // --- Auth middleware: the provider decides, routes only read c.get("user") ---
  app.use("*", authMiddleware(auth));

  // --- Inertia middleware ---
  app.use(inertia({ rootView }));

  // --- Auth (full-page redirects, not Inertia) ---
  app.get(
    "/auth/google",
    // Dev bypass: no OAuth round-trip, sign straight in as the Dev User.
    async (c, next) => {
      if (!c.env.DEV_BYPASS_AUTH) return next();
      await auth.signIn(c, DEV_USER);
      return c.redirect("/icons");
    },
    googleAuth({ scope: ["openid", "email", "profile"], prompt: "select_account" }),
    async (c) => {
      const googleUser = c.get("user-google");
      if (!googleUser?.email) return c.redirect("/?error=auth");

      const db = drizzle(c.env.DB);
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, googleUser.email))
        .get();

      let userId: string;
      if (existing) {
        userId = existing.id;
        await db
          .update(users)
          .set({
            name: googleUser.name || existing.name,
            avatarUrl: googleUser.picture || existing.avatarUrl,
          })
          .where(eq(users.id, existing.id));
      } else {
        userId = crypto.randomUUID();
        await db.insert(users).values({
          id: userId,
          email: googleUser.email,
          name: googleUser.name || null,
          avatarUrl: googleUser.picture || null,
          createdAt: new Date().toISOString(),
        });
      }

      await auth.signIn(c, {
        id: userId,
        email: googleUser.email,
        name: googleUser.name || "",
        avatarUrl: googleUser.picture || "",
      });

      return c.redirect("/icons");
    }
  );

  app.get("/auth/logout", async (c) => {
    await auth.signOut(c);
    return c.redirect("/");
  });

  // --- JSON API: debounced autosave from the editor (not Inertia) ---
  app.put("/api/icons/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const db = drizzle(c.env.DB);
    const icon = await db.select().from(icons).where(eq(icons.id, id)).get();
    if (!icon || icon.userId !== user.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json<{
      name?: string;
      content?: string;
      isPublic?: boolean;
      tablerSources?: string[];
    }>();

    await db
      .update(icons)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.content !== undefined && { content: body.content }),
        ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
        ...(body.tablerSources !== undefined && {
          tablerSources: JSON.stringify(body.tablerSources),
        }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(icons.id, id));

    return c.json({ ok: true });
  });

  // --- UI-test scenarios: seed an isolated initial state, then redirect ---
  app.route("/__scenarios", scenariosRouter(auth));

  // --- Inertia pages ---
  const routes = app
    // Public landing: the gallery of everyone's published icons.
    .get("/", async (c) => {
      const db = drizzle(c.env.DB);
      const rows = await db
        .select({
          id: icons.id,
          name: icons.name,
          content: icons.content,
          updatedAt: icons.updatedAt,
          authorName: users.name,
        })
        .from(icons)
        .innerJoin(users, eq(icons.userId, users.id))
        .where(eq(icons.isPublic, true))
        .orderBy(desc(icons.updatedAt))
        .limit(120);
      // `/icons` (and the editor) send signed-out visitors here with
      // `?notice=login-required` so the page can say why, instead of a
      // silent bounce to the gallery.
      const notice = c.req.query("notice") === "login-required" ? "login-required" : null;
      return c.render("Gallery", { user: c.get("user"), icons: rows, notice });
    })
    // Signed-in dashboard: my icons.
    .get("/icons", async (c) => {
      const user = c.get("user");
      if (!user) return c.redirect(LOGIN_REQUIRED);
      const db = drizzle(c.env.DB);
      const listMine = () =>
        db
          .select({
            id: icons.id,
            name: icons.name,
            content: icons.content,
            isPublic: icons.isPublic,
            updatedAt: icons.updatedAt,
          })
          .from(icons)
          .where(eq(icons.userId, user.id))
          .orderBy(desc(icons.updatedAt));
      let myIcons = await listMine();
      // First visit: plant the starters and tell the page so it can explain
      // where those icons came from (they are not the user's own work).
      let seeded = false;
      if (myIcons.length === 0) {
        await seedStarterIcons(db, user.id);
        myIcons = await listMine();
        seeded = true;
      }
      return c.render("Icons/Index", { user, icons: myIcons, seeded });
    })
    .post("/icons", async (c) => {
      const user = c.get("user");
      if (!user) return c.redirect(LOGIN_REQUIRED);
      const body = await c.req
        .json<{ name?: string; content?: string }>()
        .catch(() => ({}) as { name?: string; content?: string });
      const icon = await createIcon(drizzle(c.env.DB), {
        userId: user.id,
        name: body.name,
        content: body.content,
      });
      return c.redirect(`/icons/${icon.id}/edit`, 303);
    })
    .delete("/icons/:id", async (c) => {
      const user = c.get("user");
      if (!user) return c.redirect(LOGIN_REQUIRED);
      const db = drizzle(c.env.DB);
      const icon = await db
        .select()
        .from(icons)
        .where(eq(icons.id, c.req.param("id")))
        .get();
      if (icon && icon.userId === user.id) {
        await db.delete(icons).where(eq(icons.id, icon.id));
      }
      return c.redirect("/icons", 303);
    })
    .get("/icons/:id/edit", async (c) => {
      const user = c.get("user");
      if (!user) return c.redirect(LOGIN_REQUIRED);
      const db = drizzle(c.env.DB);
      const icon = await db
        .select()
        .from(icons)
        .where(eq(icons.id, c.req.param("id")))
        .get();
      if (!icon || icon.userId !== user.id) return c.notFound();
      return c.render("Icons/Edit", {
        user,
        icon: {
          id: icon.id,
          name: icon.name,
          content: icon.content,
          isPublic: icon.isPublic,
          tablerSources: icon.tablerSources,
        },
      });
    })
    // Public individual icon page. Visible if public, or to its owner.
    .get("/i/:id", async (c) => {
      const db = drizzle(c.env.DB);
      const icon = await db
        .select({
          id: icons.id,
          name: icons.name,
          content: icons.content,
          isPublic: icons.isPublic,
          userId: icons.userId,
          updatedAt: icons.updatedAt,
          tablerSources: icons.tablerSources,
          authorName: users.name,
        })
        .from(icons)
        .innerJoin(users, eq(icons.userId, users.id))
        .where(eq(icons.id, c.req.param("id")))
        .get();
      const user = c.get("user");
      if (!icon) return c.notFound();
      if (!icon.isPublic && (!user || icon.userId !== user.id)) {
        return c.notFound();
      }
      const isOwner = !!user && icon.userId === user.id;
      return c.render("Icons/Show", {
        user,
        icon: {
          id: icon.id,
          name: icon.name,
          content: icon.content,
          isPublic: icon.isPublic,
          authorName: icon.authorName,
          updatedAt: icon.updatedAt,
          tablerSources: icon.tablerSources,
        },
        isOwner,
      });
    });

  return routes;
}

export default createApp();
