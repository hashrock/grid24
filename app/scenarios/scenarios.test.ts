import { describe, expect, it } from "vitest";
import { SCENARIOS, buildScenario, findScenario } from "./index";
import { availability, scenarioUserIdFromCookie, scenarioUserRow } from "./auth";
import { scenarioTag } from "./helpers";
import { LARGE_ICON_COUNT } from "./large";
import { parseContent } from "../lib/svg";
import type { BuildContext } from "./types";

const ctx = (name: string): BuildContext => ({
  userId: "user-1",
  tag: scenarioTag(name, "abc123"),
  now: "2026-09-09T00:00:00.000Z",
});

describe("scenario registry", () => {
  it("has between 3 and 6 scenarios with unique url-safe names", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(3);
    expect(SCENARIOS.length).toBeLessThanOrEqual(6);
    const names = SCENARIOS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9-]*$/);
    for (const n of ["empty", "typical", "large"]) expect(findScenario(n)).toBeDefined();
  });

  it("scenarioTag carries the name and a short random suffix", () => {
    expect(scenarioTag("typical", "abc123")).toBe("scenario-typical-abc123");
    expect(scenarioTag("typical")).toMatch(/^scenario-typical-[0-9a-f]{6}$/);
    expect(scenarioTag("typical")).not.toBe(scenarioTag("typical"));
  });
});

describe.each(SCENARIOS.map((s) => [s.name, s] as const))("scenario %s", (name, scenario) => {
  const plan = buildScenario(scenario, ctx(name));

  it("creates only isolated rows: owner set, tag in every name, fresh unique ids", () => {
    const ids = plan.icons.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const icon of plan.icons) {
      expect(icon.userId).toBe("user-1");
      expect(icon.name).toContain(plan.tag);
      expect(icon.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("stores content the editor can read back without loss", () => {
    for (const icon of plan.icons) {
      const paths = parseContent(icon.content ?? "[]");
      const stored = JSON.parse(icon.content ?? "[]") as unknown[];
      // Every stored segment groups into some path; nothing is dropped as invalid.
      expect(paths.reduce((n, p) => n + p.segments.length, 0)).toBe(stored.length);
      if (icon.tablerSources) expect(() => JSON.parse(icon.tablerSources!)).not.toThrow();
    }
  });

  it("redirects to an app page, and to a created icon when it names one", () => {
    expect(plan.redirectTo.startsWith("/")).toBe(true);
    const m = plan.redirectTo.match(/^\/(?:icons\/([^/]+)\/edit|i\/([^/]+))$/);
    if (m) expect(plan.icons.some((i) => i.id === (m[1] ?? m[2]))).toBe(true);
  });

  it("builds the same plan every time (only generated ids differ)", () => {
    const again = buildScenario(scenario, ctx(name));
    // Segment/path ids are minted per import, so compare geometry, not ids.
    const geometry = (content: string | undefined) =>
      parseContent(content ?? "[]").map((p) => ({
        closed: p.closed,
        segments: p.segments.map(({ id: _id, ...seg }) => seg),
      }));
    const shape = (p: typeof plan) =>
      p.icons.map(({ id: _id, content, ...rest }) => ({ ...rest, geometry: geometry(content) }));
    expect(shape(again)).toEqual(shape(plan));
  });
});

describe("specific scenarios", () => {
  it("empty creates nothing and opens the dashboard", () => {
    const plan = buildScenario(findScenario("empty")!, ctx("empty"));
    expect(plan.icons).toEqual([]);
    expect(plan.redirectTo).toBe("/icons");
  });

  it("typical has a handful of icons, both public and private", () => {
    const plan = buildScenario(findScenario("typical")!, ctx("typical"));
    expect(plan.icons.length).toBeGreaterThanOrEqual(3);
    expect(plan.icons.length).toBeLessThanOrEqual(8);
    expect(plan.icons.some((i) => i.isPublic)).toBe(true);
    expect(plan.icons.some((i) => !i.isPublic)).toBe(true);
  });

  it("large has many icons with distinct updatedAt for stable ordering", () => {
    const plan = buildScenario(findScenario("large")!, ctx("large"));
    expect(plan.icons).toHaveLength(LARGE_ICON_COUNT);
    expect(new Set(plan.icons.map((i) => i.updatedAt)).size).toBe(LARGE_ICON_COUNT);
    expect(plan.icons.some((i) => (i.name ?? "").length > 100)).toBe(true);
  });

  it("editor-blank opens an empty icon; editor-complex a dense one", () => {
    const blank = buildScenario(findScenario("editor-blank")!, ctx("editor-blank"));
    expect(parseContent(blank.icons[0].content!)).toEqual([]);
    const complex = buildScenario(findScenario("editor-complex")!, ctx("editor-complex"));
    expect(parseContent(complex.icons[0].content!).length).toBeGreaterThan(10);
  });

  it("public-icon publishes its icon and wants a guest viewer", () => {
    const s = findScenario("public-icon")!;
    const plan = buildScenario(s, ctx("public-icon"));
    expect(plan.icons[0].isPublic).toBe(true);
    expect(s.viewAsGuest).toBe(true);
  });
});

describe("availability", () => {
  const user = { id: "u", email: "u@example.com", name: "U", avatarUrl: "" };
  const fresh = findScenario("empty")!;
  const any = findScenario("typical")!;

  it("uses a throwaway scenario user whenever the dev bypass is on", () => {
    expect(availability(fresh, { bypass: true, user: null })).toEqual({ ok: true, mode: "scenario-user" });
    expect(availability(any, { bypass: true, user })).toEqual({ ok: true, mode: "scenario-user" });
  });

  it("never fakes a fresh user without the bypass", () => {
    expect(availability(fresh, { bypass: false, user }).ok).toBe(false);
    expect(availability(fresh, { bypass: false, user: null }).ok).toBe(false);
  });

  it("without the bypass, adds to the signed-in account or asks to log in", () => {
    expect(availability(any, { bypass: false, user })).toEqual({ ok: true, mode: "current-user", userId: "u" });
    const denied = availability(any, { bypass: false, user: null });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.loginUrl).toBe("/auth/google");
  });
});

describe("dev_user cookie", () => {
  it("accepts only scenario-prefixed ids", () => {
    expect(scenarioUserIdFromCookie("scenario-typical-abc123")).toBe("scenario-typical-abc123");
    expect(scenarioUserIdFromCookie("dev-user")).toBeNull();
    expect(scenarioUserIdFromCookie("scenario-x; evil")).toBeNull();
    expect(scenarioUserIdFromCookie(undefined)).toBeNull();
  });

  it("scenarioUserRow derives a unique email from the tag", () => {
    const row = scenarioUserRow("scenario-typical-abc123");
    expect(row.id).toBe("scenario-typical-abc123");
    expect(row.email).toBe("scenario-typical-abc123@scenario.invalid");
  });
});
