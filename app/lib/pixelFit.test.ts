import { describe, expect, it } from "vitest";
import type { Path, Point } from "../editor/types";
import { fitToPixels } from "./pixelFit";

const line = (a: Point, b: Point, id = "s"): Path => ({
  id: `p-${id}`,
  closed: false,
  segments: [{ id, p1: a, c1: a, c2: b, p2: b }],
});

/** Device-pixel x of each anchor's stroke edges after fitting. */
const edges = (paths: Path[], size: number, strokeWidth: number) => {
  const k = size / 24;
  const s = paths[0].segments[0];
  return [s.p1.x * k - (strokeWidth * k) / 2, s.p1.x * k + (strokeWidth * k) / 2];
};

const isWhole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;

describe("fitToPixels", () => {
  it("leaves an integer-grid icon untouched at its native 24px / 2", () => {
    const paths = [line({ x: 4, y: 12 }, { x: 20, y: 12 })];
    expect(fitToPixels(paths, 24, 2)).toEqual({ paths, strokeWidth: 2 });
  });

  it("rounds the stroke to whole device pixels, never below one", () => {
    const paths = [line({ x: 12, y: 4 }, { x: 12, y: 20 })];
    expect(fitToPixels(paths, 24, 1.5).strokeWidth).toBe(2);
    expect(fitToPixels(paths, 16, 2).strokeWidth).toBe(1.5); // 1.33px → 1px
    expect(fitToPixels(paths, 24, 0.25).strokeWidth).toBe(1);
  });

  it("puts both edges of a vertical stroke on pixel boundaries", () => {
    for (const size of [12, 16, 20, 24, 32, 48]) {
      for (const w of [1, 1.5, 2, 2.5, 3]) {
        for (const x of [3, 7.5, 12, 18.5]) {
          const fitted = fitToPixels([line({ x, y: 4 }, { x, y: 20 })], size, w);
          for (const e of edges(fitted.paths, size, fitted.strokeWidth)) {
            expect(isWhole(e), `size ${size} stroke ${w} x ${x}`).toBe(true);
          }
        }
      }
    }
  });

  it("keeps coincident anchors coincident and moves handles with them", () => {
    const a = { x: 5, y: 5 };
    const b = { x: 13.5, y: 9 };
    const c = { x: 19, y: 17.5 };
    const path: Path = {
      id: "p",
      closed: false,
      segments: [
        { id: "1", p1: a, c1: { x: 6, y: 9 }, c2: { x: 11, y: 9 }, p2: b },
        { id: "2", p1: b, c1: { x: 16, y: 9 }, c2: c, p2: c },
      ],
    };
    const [fitted] = fitToPixels([path], 16, 1.5).paths;
    const [s1, s2] = fitted.segments;
    expect(s1.p2).toEqual(s2.p1);
    // c2 kept its offset from p2, c1 from p1.
    expect(s1.c2.x - s1.p2.x).toBeCloseTo(11 - 13.5);
    expect(s2.c1.x - s2.p1.x).toBeCloseTo(16 - 13.5);
  });

  it("is a no-op with no stroke to fit", () => {
    const paths = [line({ x: 3.3, y: 4 }, { x: 3.3, y: 20 })];
    expect(fitToPixels(paths, 16, 0).paths).toBe(paths);
  });
});
