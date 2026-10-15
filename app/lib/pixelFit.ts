import type { Path, Point, RenderStyle } from "../editor/types";

/**
 * Pixel fitting ("hinting") for stroke icons.
 *
 * An icon drawn on the 24-unit grid with a 2-unit stroke is only crisp at
 * exactly 24px: there a stroke centred on an integer coordinate covers whole
 * pixels. Change the size or the stroke width and the stroke's edges land
 * mid-pixel — a 1.5 stroke, or any stroke at 16px, smears into two
 * half-grey columns. That is the "alignment shifts with the weight" problem.
 *
 * Fitting fixes it for one concrete (size, stroke) pair:
 *   1. the stroke width becomes a whole number of device pixels, looked up in
 *      `STROKE_PX` (see `strokePx`), and
 *   2. every anchor is moved so a stroke of that width centred on it has its
 *      edges on pixel boundaries — on a pixel's centre for an odd width, on a
 *      pixel boundary for an even one.
 * Control points travel with their anchor, so curves keep their shape. The
 * snap is a pure function of the coordinate, so anchors that coincide before
 * fitting still coincide after it and joins never come apart.
 *
 * One exception to "pure function of the coordinate": a `butt` cap ends the
 * stroke exactly at the anchor, so on an odd width the end of an open path
 * would stop mid-pixel. Ends that run along an axis are snapped to a pixel
 * boundary along that axis instead (see `fitButtEnds`).
 */

export type FitResult = {
  paths: Path[];
  /** The fitted stroke width, in grid units (what the SVG should say). */
  strokeWidth: number;
};

export type LineCap = RenderStyle["strokeLinecap"];

const GRID = 24;

/** Sizes the stroke table is written for. */
export const STROKE_SIZES = [16, 20, 24, 28, 32, 40, 48] as const;

/**
 * Stroke width in device pixels, per design weight (the stroke in grid units,
 * i.e. its width at 24px) and display size. This is the spec of record —
 * edit a cell here to change how a weight renders at a size.
 *
 * Written by one rule, so the rows stay apart and never get lighter as the
 * size grows: the nearest whole pixel, with a tie broken *away from* the
 * default 2 — lighter weights round down, heavier ones up — so 1.5 and 2.5
 * stay distinguishable from 2 at the native 24px. Sizes or weights outside
 * the table fall back to that same rule (`roundStroke`).
 */
export const STROKE_PX: Record<number, Record<(typeof STROKE_SIZES)[number], number>> = {
  //    16    20    24    28    32    40    48
  1:   { 16: 1, 20: 1, 24: 1, 28: 1, 32: 1, 40: 2, 48: 2 },
  1.5: { 16: 1, 20: 1, 24: 1, 28: 2, 32: 2, 40: 2, 48: 3 },
  2:   { 16: 1, 20: 2, 24: 2, 28: 2, 32: 3, 40: 3, 48: 4 },
  2.5: { 16: 2, 20: 2, 24: 3, 28: 3, 32: 3, 40: 4, 48: 5 },
  3:   { 16: 2, 20: 3, 24: 3, 28: 4, 32: 4, 40: 5, 48: 6 },
};

/** The table's rule, for any weight and size: nearest pixel, ties away from 2. */
function roundStroke(strokeWidth: number, size: number): number {
  const px = (strokeWidth * size) / GRID;
  const nearest = strokeWidth < 2 ? Math.ceil(px - 0.5) : Math.floor(px + 0.5);
  return Math.max(1, nearest);
}

/** Device pixels a stroke of `strokeWidth` (grid units) gets at `size` px. */
export function strokePx(strokeWidth: number, size: number): number {
  const row = STROKE_PX[strokeWidth] as Record<number, number> | undefined;
  return row?.[size] ?? roundStroke(strokeWidth, size);
}

/** Move a control point by the same amount its anchor moved. */
const follow = (c: Point, from: Point, to: Point): Point => ({
  x: c.x + to.x - from.x,
  y: c.y + to.y - from.y,
});

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Fit to `size` device pixels; with `enabled` off, the input passes through. */
export function fitToPixels(
  paths: Path[],
  size: number,
  strokeWidth: number,
  enabled = true,
  cap: LineCap = "round",
): FitResult {
  const k = size / GRID; // device px per grid unit
  if (!enabled || !(k > 0) || !(strokeWidth > 0)) return { paths, strokeWidth };

  const devicePx = strokePx(strokeWidth, size);
  const offset = (devicePx % 2) / 2; // 0.5 puts an odd stroke on pixel centres
  const snap = (v: number) => (Math.round(v * k - offset) + offset) / k;
  const snapPt = (p: Point): Point => ({ x: snap(p.x), y: snap(p.y) });

  let fitted = paths.map((path) => ({
    ...path,
    segments: path.segments.map((s) => {
      const p1 = snapPt(s.p1);
      const p2 = snapPt(s.p2);
      return { ...s, p1, c1: follow(s.c1, s.p1, p1), c2: follow(s.c2, s.p2, p2), p2 };
    }),
  }));
  // Only an odd butt stroke ends mid-pixel; square caps reach out half the
  // (whole-pixel) width onto a boundary, and round caps are never crisp.
  if (cap === "butt" && offset !== 0) {
    fitted = fitted.map((path, i) => fitButtEnds(path, paths[i], k));
  }
  return { paths: fitted, strokeWidth: devicePx / k };
}

/**
 * Move the two ends of an open path so a butt cap stops on a pixel boundary.
 * Only an end whose stroke runs along an axis is moved, and only along that
 * axis: there the cap edge is a straight pixel column or row. A diagonal end
 * can't be made crisp by moving it, so it is left alone.
 */
function fitButtEnds(path: Path, original: Path, k: number): Path {
  const segs = path.segments;
  if (path.closed || segs.length === 0) return path;
  const first = original.segments[0];
  const last = original.segments[segs.length - 1];
  // A path that ends where it starts has no free end.
  if (same(first.p1, last.p2)) return path;

  const toBoundary = (v: number) => Math.round(v * k) / k;
  /** `p` moved along whichever axis the stroke at it runs on. */
  const fitEnd = (p: Point, from: Point, towards: Point[]): Point => {
    const t = towards.find((q) => !same(q, from));
    if (!t) return p;
    // Snap the drawn coordinate, not the centred one, so the end stays put.
    if (t.y === from.y) return { x: toBoundary(from.x), y: p.y };
    if (t.x === from.x) return { x: p.x, y: toBoundary(from.y) };
    return p;
  };

  const out = segs.map((s) => ({ ...s }));
  const head = out[0];
  const p1 = fitEnd(head.p1, first.p1, [first.c1, first.c2, first.p2]);
  head.c1 = follow(head.c1, head.p1, p1);
  head.p1 = p1;
  const tail = out[out.length - 1];
  const p2 = fitEnd(tail.p2, last.p2, [last.c2, last.c1, last.p1]);
  tail.c2 = follow(tail.c2, tail.p2, p2);
  tail.p2 = p2;
  return { ...path, segments: out };
}
