import type { Path, Point, Segment } from '../types';
import { EMPTY_SELECTION } from './geometry';
import type { DocState, NodeKey } from './types';

/** Builders for the reducer specs. Not imported by any app code. */

export const pt = (x: number, y: number): Point => ({ x, y });

/** A straight segment: both controls sit on their anchors. */
export const line = (
  id: string,
  from: Point,
  to: Point,
  extra: Partial<Segment> = {}
): Segment => ({
  id,
  p1: { ...from },
  c1: { ...from },
  c2: { ...to },
  p2: { ...to },
  ...extra,
});

/** A segment with explicit control points. */
export const curve = (
  id: string,
  p1: Point,
  c1: Point,
  c2: Point,
  p2: Point,
  extra: Partial<Segment> = {}
): Segment => ({ id, p1, c1, c2, p2, ...extra });

export const path = (id: string, segments: Segment[], closed = false): Path => ({
  id,
  closed,
  segments,
});

/** A chain of straight segments through `points`, one path. */
export const polyline = (id: string, points: Point[], closed = false): Path =>
  path(
    id,
    points.slice(1).map((p, i) => line(`${id}${i + 1}`, points[i], p)),
    closed
  );

export const doc = (paths: Path[], selection: NodeKey[] = []): DocState => ({
  paths,
  selection: selection.length > 0 ? new Set(selection) : EMPTY_SELECTION,
});

export const byId = (state: DocState, id: string): Segment => {
  for (const p of state.paths) {
    const seg = p.segments.find((s) => s.id === id);
    if (seg) return seg;
  }
  throw new Error(`no segment ${id}`);
};

export const pathById = (state: DocState, id: string): Path => {
  const found = state.paths.find((p) => p.id === id);
  if (!found) throw new Error(`no path ${id}`);
  return found;
};

/** Segment ids of each path, for asserting structure after splits and joins. */
export const shape = (state: DocState): string[][] =>
  state.paths.map((p) => p.segments.map((s) => s.id));

/**
 * A two-segment path meeting at (10,0) with a smooth junction:
 *   a: (0,0) -> (10,0), outgoing handle at (8,-4)
 *   b: (10,0) -> (20,0), incoming handle parked away from the mirror position
 *      so tests can tell "was mirrored" from "was already there".
 */
export const smoothPair = (): Path =>
  path('P', [
    curve('a', pt(0, 0), pt(0, 0), pt(8, -4), pt(10, 0), { isSmoothP2: true }),
    curve('b', pt(10, 0), pt(15, 15), pt(20, 0), pt(20, 0)),
  ]);

/** The same pair with the junction already a corner. */
export const cornerPair = (): Path => {
  const p = smoothPair();
  return { ...p, segments: p.segments.map((s) => ({ ...s, isSmoothP2: false })) };
};
