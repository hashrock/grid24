import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { icons, users } from "./schema";
import { TABLER_ICONS, type TablerIcon } from "../lib/tablerIcons";
import { parsePathDataList } from "../lib/pathImport";
import { serializeContent } from "../lib/svg";

/**
 * Small domain layer over the `users` / `icons` tables, shared by the app
 * routes and the UI-test scenarios so neither has to hand-roll inserts.
 */

export type NewIcon = typeof icons.$inferInsert;
export type NewUser = typeof users.$inferInsert;

/**
 * First-run seed: a few Tabler starter icons, inserted when a user opens their
 * (still empty) dashboard, so there's something to open and edit right away.
 * They start private, like any newly created icon.
 */
export const STARTER_ICON_COUNT = 3;

/**
 * D1 caps bound parameters per statement (100), so a multi-row insert is
 * split into chunks small enough to stay under it with every column set.
 */
const INSERT_CHUNK = 10;

/** Editor content (stored JSON) for one Tabler icon's strokes. */
export function tablerContent(icon: TablerIcon): string {
  return serializeContent(parsePathDataList(icon.paths));
}

/** Editor content merging the strokes of several Tabler icons into one document. */
export function combinedTablerContent(list: readonly TablerIcon[]): string {
  return serializeContent(parsePathDataList(list.flatMap((i) => i.paths)));
}

/** Insert rows for the starter set. Pure: the caller decides when to insert. */
export function starterIconRows(
  userId: string,
  now = new Date().toISOString()
): NewIcon[] {
  return TABLER_ICONS.slice(0, STARTER_ICON_COUNT).map((icon) => ({
    id: crypto.randomUUID(),
    userId,
    name: icon.name,
    content: tablerContent(icon),
    isPublic: false,
    tablerSources: JSON.stringify([icon.name]),
    createdAt: now,
    updatedAt: now,
  }));
}

export async function insertIcons(db: DrizzleD1Database, rows: NewIcon[]) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(icons).values(rows.slice(i, i + INSERT_CHUNK));
  }
}

export async function seedStarterIcons(db: DrizzleD1Database, userId: string) {
  await insertIcons(db, starterIconRows(userId));
}

/** Insert the user unless a row with that id already exists. */
export async function ensureUser(db: DrizzleD1Database, user: NewUser) {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  if (!existing) await db.insert(users).values(user);
}
