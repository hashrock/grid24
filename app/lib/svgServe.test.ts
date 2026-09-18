import { describe, expect, it } from "vitest";
import { parseContent } from "./svg";
import {
  DEFAULT_COLOR,
  DEFAULT_SVG_PARAMS,
  iconSvgResponse,
  parseColor,
  parseSvgParams,
  renderIconSvg,
  svgEtag,
} from "./svgServe";

const content = JSON.stringify([
  {
    id: "s1",
    pathId: "p1",
    p1: { x: 4, y: 12 },
    c1: { x: 4, y: 12 },
    c2: { x: 20, y: 12 },
    p2: { x: 20, y: 12 },
  },
]);
const paths = parseContent(content);

describe("parseColor", () => {
  it("takes hex with or without the #, normalized", () => {
    expect(parseColor("#FF5722")).toBe("#ff5722");
    // `#` has to be percent-encoded in a query string, so bare hex is allowed.
    expect(parseColor("ff5722")).toBe("#ff5722");
    expect(parseColor("fff")).toBe("#fff");
    expect(parseColor("ff5722cc")).toBe("#ff5722cc");
  });

  it("takes CSS color keywords and currentColor", () => {
    expect(parseColor("red")).toBe("red");
    expect(parseColor("currentcolor")).toBe("currentColor");
    expect(parseColor(undefined)).toBe(DEFAULT_COLOR);
    expect(parseColor("  ")).toBe(DEFAULT_COLOR);
  });

  it("falls back rather than letting anything else into the markup", () => {
    for (const bad of [
      '" onload="alert(1)',
      "url(javascript:alert(1))",
      "#ff572",
      "rgb(1,2,3)",
      "#ff5722; x",
    ]) {
      expect(parseColor(bad)).toBe(DEFAULT_COLOR);
    }
  });
});

describe("parseSvgParams", () => {
  it("defaults an empty query", () => {
    expect(parseSvgParams({})).toEqual(DEFAULT_SVG_PARAMS);
  });

  it("clamps to sizes and weights an icon can actually be drawn at", () => {
    expect(parseSvgParams({ size: "48" }).size).toBe(48);
    expect(parseSvgParams({ size: "0" }).size).toBe(1);
    expect(parseSvgParams({ size: "99999" }).size).toBe(1024);
    expect(parseSvgParams({ size: "31.6" }).size).toBe(32);
    expect(parseSvgParams({ stroke: "1.5" }).strokeWidth).toBe(1.5);
    expect(parseSvgParams({ stroke: "-3" }).strokeWidth).toBe(0);
    expect(parseSvgParams({ stroke: "100" }).strokeWidth).toBe(8);
  });

  it("ignores junk instead of rendering NaN", () => {
    expect(parseSvgParams({ size: "big", stroke: "thick" })).toEqual(DEFAULT_SVG_PARAMS);
  });
});

describe("renderIconSvg", () => {
  it("puts the requested size, color and weight on the root element", () => {
    const svg = renderIconSvg(paths, parseSvgParams({ size: "48", color: "ff5722", stroke: "1.5" }));
    expect(svg).toContain('width="48" height="48"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke="#ff5722"');
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).toContain("<path ");
  });

  it("renders an empty icon as a valid empty document, not a broken one", () => {
    const svg = renderIconSvg([], DEFAULT_SVG_PARAMS);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).not.toContain("<path");
  });
});

describe("svgEtag", () => {
  it("changes when the icon is saved or the query changes", () => {
    const a = svgEtag("2026-09-01T00:00:00.000Z", DEFAULT_SVG_PARAMS);
    expect(a).toBe(svgEtag("2026-09-01T00:00:00.000Z", DEFAULT_SVG_PARAMS));
    expect(a).not.toBe(svgEtag("2026-09-02T00:00:00.000Z", DEFAULT_SVG_PARAMS));
    expect(a).not.toBe(svgEtag("2026-09-01T00:00:00.000Z", parseSvgParams({ size: "48" })));
    expect(a).toMatch(/^"[0-9a-z]+"$/);
  });
});

describe("iconSvgResponse", () => {
  const base = { paths, updatedAt: "2026-09-01T00:00:00.000Z", params: DEFAULT_SVG_PARAMS };

  it("serves an SVG file that any site may embed", async () => {
    const res = iconSvgResponse({ ...base, isPublic: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await res.text()).toContain("<svg");
  });

  it("lets shared caches keep a public icon, but never an unpublished one", () => {
    expect(iconSvgResponse({ ...base, isPublic: true }).headers.get("cache-control")).toContain(
      "public"
    );
    expect(iconSvgResponse({ ...base, isPublic: false }).headers.get("cache-control")).toBe(
      "private, no-store"
    );
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const etag = svgEtag(base.updatedAt, base.params);
    const res = iconSvgResponse({ ...base, isPublic: true, ifNoneMatch: `W/"other", ${etag}` });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBe(etag);
  });

  it("re-sends the file when the cached validator is stale", async () => {
    const res = iconSvgResponse({ ...base, isPublic: true, ifNoneMatch: '"stale"' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<path");
  });
});
