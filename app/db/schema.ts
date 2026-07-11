import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// A stroke icon authored by a user. `content` holds the editor's serialized
// Segment[] as JSON; the public SVG is rendered from it on demand.
export const icons = sqliteTable("icons", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull().default("Untitled"),
  /** JSON.stringify(Segment[]) — the vector data the editor round-trips. */
  content: text("content").notNull().default("[]"),
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
  /**
   * Provenance: JSON array of Tabler icon names this icon was built from
   * (via the "search & import" dialog). Used to credit Tabler on public pages.
   * Null / "[]" means fully original. Over-credits by design — a name stays
   * even if the imported strokes are later deleted.
   */
  tablerSources: text("tabler_sources"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
