import type { NewIcon } from "../db/icons";
import type { BuildContext } from "./types";

/** Short random suffix so repeated runs never collide by name. */
export function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 6);
}

export function scenarioTag(name: string, suffix = randomSuffix()): string {
  return `scenario-${name}-${suffix}`;
}

/** Minutes before `ctx.now`, so lists ordered by updatedAt are deterministic. */
export function minutesAgo(now: string, minutes: number): string {
  return new Date(new Date(now).getTime() - minutes * 60_000).toISOString();
}

type IconSpec = {
  name: string;
  content: string;
  isPublic?: boolean;
  tablerSources?: string[];
  /** Age in minutes; newer icons sort first on the dashboard. */
  ageMinutes?: number;
};

/** A row for the scenario's user, with the tag prefixed to the display name. */
export function iconRow(ctx: BuildContext, spec: IconSpec): NewIcon {
  const at = minutesAgo(ctx.now, spec.ageMinutes ?? 0);
  return {
    id: crypto.randomUUID(),
    userId: ctx.userId,
    name: `${ctx.tag} ${spec.name}`,
    content: spec.content,
    isPublic: spec.isPublic ?? false,
    tablerSources: spec.tablerSources ? JSON.stringify(spec.tablerSources) : null,
    createdAt: at,
    updatedAt: at,
  };
}

export const editUrl = (id: string) => `/icons/${id}/edit`;
export const showUrl = (id: string) => `/i/${id}`;
