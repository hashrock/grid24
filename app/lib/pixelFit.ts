import type { Path, Point } from "../editor/types";

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
 *   1. the stroke width is rounded to whole device pixels (at least one), and
 *   2. every anchor is moved so a stroke of that width centred on it has its
 *      edges on pixel boundaries — on a pixel's centre for an odd width, on a
 *      pixel boundary for an even one.
 * Control points travel with their anchor, so curves keep their shape. The
 * snap is a pure function of the coordinate, so anchors that coincide before
 * fitting still coincide after it and joins never come apart.
 */

export type FitResult = {
  paths: Path[];
  /** The rounded stroke width, in grid units (what the SVG should say). */
  strokeWidth: number;
};

const GRID = 24;

/** Move a control point by the same amount its anchor moved. */
const follow = (c: Point, from: Point, to: Point): Point => ({
  x: c.x + to.x - from.x,
  y: c.y + to.y - from.y,
});

/** Fit to `size` device pixels; with `enabled` off, the input passes through. */
export function fitToPixels(
  paths: Path[],
  size: number,
  strokeWidth: number,
  enabled = true,
): FitResult {
  const k = size / GRID; // device px per grid unit
  if (!enabled || !(k > 0) || !(strokeWidth > 0)) return { paths, strokeWidth };

  const devicePx = Math.max(1, Math.round(strokeWidth * k));
  const offset = (devicePx % 2) / 2; // 0.5 puts an odd stroke on pixel centres
  const snap = (v: number) => (Math.round(v * k - offset) + offset) / k;
  const snapPt = (p: Point): Point => ({ x: snap(p.x), y: snap(p.y) });

  const fitted = paths.map((path) => ({
    ...path,
    segments: path.segments.map((s) => {
      const p1 = snapPt(s.p1);
      const p2 = snapPt(s.p2);
      return { ...s, p1, c1: follow(s.c1, s.p1, p1), c2: follow(s.c2, s.p2, p2), p2 };
    }),
  }));
  return { paths: fitted, strokeWidth: devicePx / k };
}
