import { Hono } from "hono";
import { inertia } from "@hono/inertia";
import { googleAuth } from "@hono/oauth-providers/google";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import { rootView } from "./root-view";
import { users, icons } from "./db/schema";
import { getSession, setSession, clearSession } from "./utils/session";
import { TABLER_ICONS } from "./lib/tablerIcons";
import { pathsToSegments } from "./lib/pathImport";
import type { Env } from "./global.d";

const DEV_USER = {
  id: "dev-user",
  email: "dev@localhost",
  name: "Dev User",
  avatarUrl: "",
};

/**
 * First-run seed: a few Tabler starter icons, inserted when a user opens their
 * (still empty) dashboard, so there's something to open and edit right away.
 * They start private, like any newly created icon.
 */
const STARTER_ICON_COUNT = 3;

async function seedStarterIcons(db: DrizzleD1Database, userId: string) {
  const now = new Date().toISOString();
  const rows = TABLER_ICONS.slice(0, STARTER_ICON_COUNT).map((icon) => ({
    id: crypto.randomUUID(),
    userId,
    name: icon.name,
    content: JSON.stringify(pathsToSegments(icon.paths)),
    isPublic: false,
    tablerSources: JSON.stringify([icon.name]),
    createdAt: now,
    updatedAt: now,
  }));
  if (rows.length > 0) await db.insert(icons).values(rows);
}

const app = new Hono<Env>();

// --- Auth middleware (dummy auth for now; OAuth can slot in later) ---
app.use("*", async (c, next) => {
  // Dummy/dev auth: a fixed Dev User, auto-provisioned in the DB.
  // `?guest=1` (persisted in a cookie) previews the logged-out experience.
  if (c.env.DEV_BYPASS_AUTH) {
    const cookie = c.req.header("Cookie") || "";
    let guest = /(?:^|;\s*)dev_guest=1(?:;|$)/.test(cookie);
    const q = new URL(c.req.url).searchParams.get("guest");
    if (q !== null) {
      guest = q !== "0";
      c.header(
        "Set-Cookie",
        guest
          ? "dev_guest=1; Path=/; SameSite=Lax"
          : "dev_guest=; Path=/; Max-Age=0; SameSite=Lax"
      );
    }
    if (guest) {
      c.set("user", null);
      return next();
    }
    const db = drizzle(c.env.DB);
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, DEV_USER.id))
      .get();
    if (!existing) {
      await db.insert(users).values({
        id: DEV_USER.id,
        email: DEV_USER.email,
        name: DEV_USER.name,
        avatarUrl: DEV_USER.avatarUrl,
      });
    }
    c.set("user", DEV_USER);
    return next();
  }
  c.set("user", await getSession(c));
  return next();
});

// --- Inertia middleware ---
app.use(inertia({ rootView }));

// --- Auth (full-page redirects, not Inertia) ---
app.get(
  "/auth/google",
  // Dev bypass: no OAuth round-trip, just leave guest mode.
  async (c, next) => {
    if (!c.env.DEV_BYPASS_AUTH) return next();
    c.header("Set-Cookie", "dev_guest=; Path=/; Max-Age=0; SameSite=Lax");
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

    await setSession(c, {
      id: userId,
      email: googleUser.email,
      name: googleUser.name || "",
      avatarUrl: googleUser.picture || "",
    });

    return c.redirect("/icons");
  }
);

app.get("/auth/logout", (c) => {
  clearSession(c);
  if (c.env.DEV_BYPASS_AUTH) {
    // Dev bypass would sign us straight back in; show the guest view instead.
    c.header("Set-Cookie", "dev_guest=1; Path=/; SameSite=Lax", { append: true });
  }
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
    return c.render("Gallery", { user: c.get("user"), icons: rows });
  })
  // Signed-in dashboard: my icons.
  .get("/icons", async (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/");
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
    if (myIcons.length === 0) {
      await seedStarterIcons(db, user.id);
      myIcons = await listMine();
    }
    return c.render("Icons/Index", { user, icons: myIcons });
  })
  .post("/icons", async (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/");
    const body = await c.req
      .json<{ name?: string; content?: string }>()
      .catch(() => ({}) as { name?: string; content?: string });
    const db = drizzle(c.env.DB);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(icons).values({
      id,
      userId: user.id,
      name: body.name || "Untitled",
      content: body.content ?? "[]",
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    });
    return c.redirect(`/icons/${id}/edit`, 303);
  })
  .delete("/icons/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/");
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
    if (!user) return c.redirect("/");
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

export default routes;
