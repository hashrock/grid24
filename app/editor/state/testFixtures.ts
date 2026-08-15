import type { Point, Segment } from '../types';
import { EMPTY_SELECTION } from './geometry';
import type { DocState, NodeKey } from './types';

/** Builders for the reducer specs. Not imported by any app code. */

export const pt = (x: number, y: number): Point => ({ x, y });

/** A straight segment: both controls sit on their anchors. */
export const line = (
  id: string,
  pathId: string,
  from: Point,
  to: Point,
  extra: Partial<Segment> = {}
): Segment => ({
  id,
  pathId,
  p1: { ...from },
  c1: { ...from },
  c2: { ...to },
  p2: { ...to },
  isSmoothP2: false,
  isClosed: false,
  ...extra,
});

/** A segment with explicit control points. */
export const curve = (
  id: string,
  pathId: string,
  p1: Point,
  c1: Point,
  c2: Point,
  p2: Point,
  extra: Partial<Segment> = {}
): Segment => ({ id, pathId, p1, c1, c2, p2, isSmoothP2: false, isClosed: false, ...extra });

export const doc = (segments: Segment[], selection: NodeKey[] = []): DocState => ({
  segments,
  selection: selection.length > 0 ? new Set(selection) : EMPTY_SELECTION,
});

export const byId = (state: DocState, id: string): Segment => {
  const seg = state.segments.find((s) => s.id === id);
  if (!seg) throw new Error(`no segment ${id}`);
  return seg;
};

/**
 * A two-segment path meeting at (10,0) with a smooth junction:
 *   a: (0,0) -> (10,0), outgoing handle at (8,-4)
 *   b: (10,0) -> (20,0), incoming handle parked away from the mirror position
 *      so tests can tell "was mirrored" from "was already there".
 */
export const smoothPair = (): Segment[] => [
  curve('a', 'P', pt(0, 0), pt(0, 0), pt(8, -4), pt(10, 0), { isSmoothP2: true }),
  curve('b', 'P', pt(10, 0), pt(15, 15), pt(20, 0), pt(20, 0)),
];
