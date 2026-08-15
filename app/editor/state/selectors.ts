import type { Path, Point, Segment } from '../types';
import { NODE_TYPES, eachSegment, expandToControls, parseNodeKey, pointKey } from './geometry';
import type { NodeKey } from './types';

/**
 * Derived views of the document. Pure functions of (paths, selection) so the
 * Canvas can `useMemo` them and the specs can assert them directly.
 */

/** Every segment paired with the path it belongs to, for flat rendering. */
export interface PlacedSegment {
  segment: Segment;
  path: Path;
}

export const placedSegments = (paths: Path[]): PlacedSegment[] => [...eachSegment(paths)];

/** Path ids the selection touches — these are the paths that show their anchors. */
export const selectedPathIds = (paths: Path[], selection: ReadonlySet<NodeKey>): Set<string> => {
  const segmentIds = new Set<string>();
  selection.forEach((key) => {
    const parsed = parseNodeKey(key);
    if (parsed) segmentIds.add(parsed.segmentId);
  });
  const ids = new Set<string>();
  if (segmentIds.size === 0) return ids;
  for (const path of paths) {
    if (path.segments.some((s) => segmentIds.has(s.id))) ids.add(path.id);
  }
  return ids;
};

export const pathIdOfSegment = (paths: Path[], segmentId: string | null): string | null => {
  if (!segmentId) return null;
  for (const path of paths) {
    if (path.segments.some((s) => s.id === segmentId)) return path.id;
  }
  return null;
};

export interface Endpoint {
  pathId: string;
  end: 'head' | 'tail';
  point: Point;
}

/**
 * Free ends of open paths. Pen mode uses these to continue an existing path or
 * to join two of them.
 */
export const openEndpoints = (paths: Path[]): Endpoint[] => {
  const eps: Endpoint[] = [];
  for (const path of paths) {
    if (path.closed || path.segments.length === 0) continue;
    eps.push({ pathId: path.id, end: 'head', point: path.segments[0].p1 });
    eps.push({
      pathId: path.id,
      end: 'tail',
      point: path.segments[path.segments.length - 1].p2,
    });
  }
  return eps;
};

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

/** Bounding box of the selection, controls included. */
export const selectionBounds = (paths: Path[], selection: ReadonlySet<NodeKey>): Bounds | null => {
  const keys = expandToControls(selection);
  if (keys.size === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const { segment } of eachSegment(paths)) {
    for (const type of NODE_TYPES) {
      if (!keys.has(pointKey(segment.id, type))) continue;
      const p = segment[type];
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      found = true;
    }
  }
  if (!found) return null;
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
};

/**
 * How many *distinct* anchors the selection covers. Coincident anchors from
 * neighbouring segments are one anchor, and the transform box only makes sense
 * above one — otherwise there is nothing to scale.
 */
export const uniqueSelectedAnchors = (
  paths: Path[],
  selection: ReadonlySet<NodeKey>
): number => {
  const positions: Point[] = [];
  for (const { segment } of eachSegment(paths)) {
    for (const type of NODE_TYPES) {
      if (!selection.has(pointKey(segment.id, type))) continue;
      positions.push(type === 'p1' || type === 'c1' ? segment.p1 : segment.p2);
    }
  }
  const unique: Point[] = [];
  for (const p of positions) {
    if (!unique.some((u) => Math.hypot(u.x - p.x, u.y - p.y) < 0.001)) unique.push(p);
  }
  return unique.length;
};
