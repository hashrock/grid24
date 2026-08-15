import type { Path, Point, Segment } from '../types';
import type { MirrorMode, NodeKey, NodeType } from './types';

/**
 * Junctions between *paths* are implicit, by position: two anchors closer than
 * this are the same point. (Within a path, adjacency is structural — it's the
 * array order — so this only matters where separate paths meet.)
 */
export const EPS = 0.001;

export const near = (a: Point, b: Point, eps = EPS): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) < eps;

/** Mirror `p` through `center` — the smooth-handle relationship. */
export const reflect = (p: Point, center: Point): Point => ({
  x: center.x - (p.x - center.x),
  y: center.y - (p.y - center.y),
});

export const NODE_TYPES = ['p1', 'c1', 'c2', 'p2'] as const;

export const pointKey = (segmentId: string, type: NodeType): NodeKey => `${segmentId}::${type}`;

export const parseNodeKey = (key: NodeKey): { segmentId: string; type: NodeType } | null => {
  const at = key.lastIndexOf('::');
  if (at < 0) return null;
  const type = key.slice(at + 2) as NodeType;
  if (!(NODE_TYPES as readonly string[]).includes(type)) return null;
  return { segmentId: key.slice(0, at), type };
};

export const EMPTY_SELECTION: ReadonlySet<NodeKey> = new Set<NodeKey>();

export const sameKeys = (a: ReadonlySet<NodeKey>, b: ReadonlySet<NodeKey>): boolean => {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
};

// --- Structure-preserving maps ---------------------------------------------
// Every one of these returns the *same object* when nothing changed. The
// history layer checks the document by reference to decide whether an action
// deserves an undo step, so the identity has to survive both nesting levels.

export const mapPaths = (paths: Path[], fn: (path: Path) => Path): Path[] => {
  let changed = false;
  const next = paths.map((p) => {
    const r = fn(p);
    if (r !== p) changed = true;
    return r;
  });
  return changed ? next : paths;
};

export const mapPathSegments = (path: Path, fn: (seg: Segment) => Segment): Path => {
  let changed = false;
  const segments = path.segments.map((s) => {
    const r = fn(s);
    if (r !== s) changed = true;
    return r;
  });
  return changed ? { ...path, segments } : path;
};

export const mapSegments = (paths: Path[], fn: (seg: Segment, path: Path) => Segment): Path[] =>
  mapPaths(paths, (path) => mapPathSegments(path, (seg) => fn(seg, path)));

/** Update one path by id, leaving the rest untouched by reference. */
export const mapPath = (paths: Path[], pathId: string, fn: (path: Path) => Path): Path[] =>
  mapPaths(paths, (p) => (p.id === pathId ? fn(p) : p));

// --- Lookups ---------------------------------------------------------------

export function* eachSegment(paths: Path[]): Generator<{ segment: Segment; path: Path }> {
  for (const path of paths) for (const segment of path.segments) yield { segment, path };
}

export const allSegments = (paths: Path[]): Segment[] => paths.flatMap((p) => p.segments);

export const findPath = (paths: Path[], pathId: string): Path | null =>
  paths.find((p) => p.id === pathId) ?? null;

export const locateSegment = (
  paths: Path[],
  segmentId: string
): { path: Path; segment: Segment; index: number } | null => {
  for (const path of paths) {
    const index = path.segments.findIndex((s) => s.id === segmentId);
    if (index >= 0) return { path, segment: path.segments[index], index };
  }
  return null;
};

/** The segment *arriving* at `pt` — its `isSmoothP2` flag owns that junction. */
export const incomingAt = (paths: Path[], pt: Point): Segment | null => {
  for (const { segment } of eachSegment(paths)) if (near(segment.p2, pt)) return segment;
  return null;
};

/** The segment *leaving* `pt` — its `c1` is the outgoing handle. */
export const outgoingAt = (paths: Path[], pt: Point): Segment | null => {
  for (const { segment } of eachSegment(paths)) if (near(segment.p1, pt)) return segment;
  return null;
};

/** A path id not in `taken`, derived from `base` so it stays deterministic. */
export const freshPathId = (taken: ReadonlySet<string>, base: string): string => {
  let i = 1;
  while (taken.has(`${base}/${i}`)) i++;
  return `${base}/${i}`;
};

export const pathIds = (paths: Path[]): Set<string> => new Set(paths.map((p) => p.id));

// --- Selection -------------------------------------------------------------

/** Selecting an anchor implicitly grabs the control point attached to it. */
export const expandToControls = (selection: ReadonlySet<NodeKey>): Set<NodeKey> => {
  const out = new Set<NodeKey>();
  selection.forEach((key) => {
    out.add(key);
    const parsed = parseNodeKey(key);
    if (!parsed) return;
    if (parsed.type === 'p1') out.add(pointKey(parsed.segmentId, 'c1'));
    if (parsed.type === 'p2') out.add(pointKey(parsed.segmentId, 'c2'));
  });
  return out;
};

/** Drop selection entries whose segment no longer exists. */
export const pruneSelection = (
  selection: ReadonlySet<NodeKey>,
  paths: Path[]
): ReadonlySet<NodeKey> => {
  if (selection.size === 0) return selection;
  const alive = new Set(allSegments(paths).map((s) => s.id));
  const next = new Set<NodeKey>();
  selection.forEach((key) => {
    const parsed = parseNodeKey(key);
    if (parsed && alive.has(parsed.segmentId)) next.add(key);
  });
  return next.size === selection.size ? selection : next;
};

// --- Editing primitives ----------------------------------------------------

/**
 * Move every node in `keys`. Returns the same document when nothing moves,
 * which keeps zero-delta pointer moves (common under grid snapping) out of the
 * undo history and out of React's render path.
 */
export const translateNodes = (paths: Path[], keys: ReadonlySet<NodeKey>, delta: Point): Path[] => {
  if (delta.x === 0 && delta.y === 0) return paths;
  return mapSegments(paths, (seg) => {
    let moved = seg;
    for (const t of NODE_TYPES) {
      if (!keys.has(pointKey(seg.id, t))) continue;
      if (moved === seg) moved = { ...seg };
      moved[t] = { x: moved[t].x + delta.x, y: moved[t].y + delta.y };
    }
    return moved;
  });
};

/** Scale the nodes captured in `from` around `origin`. */
export const scaleNodes = (
  paths: Path[],
  from: Record<NodeKey, Point>,
  origin: Point,
  sx: number,
  sy: number
): Path[] =>
  mapSegments(paths, (seg) => {
    let moved = seg;
    for (const t of NODE_TYPES) {
      const start = from[pointKey(seg.id, t)];
      if (!start) continue;
      const x = origin.x + (start.x - origin.x) * sx;
      const y = origin.y + (start.y - origin.y) * sy;
      if (x === seg[t].x && y === seg[t].y) continue;
      if (moved === seg) moved = { ...seg };
      moved[t] = { x, y };
    }
    return moved;
  });

/**
 * Reverse a path's direction. Ids are preserved so callers can keep referring
 * to a segment across the flip. Junction smoothness travels with the junction:
 * the flag on reversed[j].p2 is the original flag at that same anchor.
 */
export const reversePath = (path: Path): Path => {
  const segs = path.segments;
  const n = segs.length;
  return {
    ...path,
    segments: segs.map((_, j) => {
      const o = segs[n - 1 - j];
      return {
        ...o,
        p1: o.p2,
        c1: o.c2,
        c2: o.c1,
        p2: o.p1,
        isSmoothP2: j < n - 1 ? !!segs[n - 2 - j].isSmoothP2 : false,
      };
    }),
  };
};

/**
 * Remove segments from a path. A gap in the middle genuinely breaks the chain,
 * so the survivors come back as separate paths — with the flat `pathId` model
 * they used to stay grouped and render a phantom line across the hole. A closed
 * path is rotated to start after the first hole, so cutting one segment out of
 * a loop yields a single open path rather than two.
 */
export const removeSegments = (
  path: Path,
  remove: ReadonlySet<string>,
  /** Every path id already in use, so a split can mint one that is free. */
  taken: ReadonlySet<string>
): Path[] => {
  const n = path.segments.length;
  const keep = path.segments.map((s) => !remove.has(s.id));
  if (keep.every(Boolean)) return [path];
  if (!keep.some(Boolean)) return [];

  const offset = path.closed ? keep.indexOf(false) + 1 : 0;
  const runs: Segment[][] = [];
  let run: Segment[] = [];
  for (let k = 0; k < n; k++) {
    const i = (k + offset) % n;
    if (keep[i]) {
      run.push(path.segments[i]);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);

  const used = new Set(taken);
  const out: Path[] = [];
  for (const segments of runs) {
    // The first survivor keeps the path's identity; later ones need new ids.
    const id = out.length === 0 ? path.id : freshPathId(used, path.id);
    used.add(id);
    out.push({ id, closed: false, segments });
  }
  return out;
};

/**
 * The junction flag lives on the segment arriving at the anchor, so resolve
 * each selected node to that segment's id.
 */
const junctionIds = (paths: Path[], keys: Iterable<NodeKey>): Set<string> => {
  const ids = new Set<string>();
  for (const key of keys) {
    const parsed = parseNodeKey(key);
    if (!parsed || (parsed.type !== 'p1' && parsed.type !== 'p2')) continue;
    const found = locateSegment(paths, parsed.segmentId);
    if (!found) continue;
    if (parsed.type === 'p2') {
      ids.add(found.segment.id);
    } else {
      // Within a path the predecessor is the previous array entry; a closed
      // path wraps around to the last one.
      const prev =
        found.index > 0
          ? found.path.segments[found.index - 1]
          : found.path.closed
            ? found.path.segments[found.path.segments.length - 1]
            : incomingAt(paths, found.segment.p1);
      if (prev) ids.add(prev.id);
    }
  }
  return ids;
};

/**
 * Flip smooth/corner for the anchors named by `keys`. They all take the state
 * opposite the first one, so a mixed selection lands on a single value. Turning
 * a junction smooth mirrors the outgoing handle onto the incoming one.
 */
export const toggleAnchorsSmooth = (paths: Path[], keys: Iterable<NodeKey>): Path[] => {
  const junctions = junctionIds(paths, keys);
  if (junctions.size === 0) return paths;

  const firstId = junctions.values().next().value as string;
  const smooth = !locateSegment(paths, firstId)?.segment.isSmoothP2;

  let updated = mapSegments(paths, (seg) =>
    junctions.has(seg.id) ? { ...seg, isSmoothP2: smooth } : seg
  );
  if (!smooth) return updated;

  junctions.forEach((id) => {
    const found = locateSegment(updated, id);
    if (!found) return;
    const { path, segment, index } = found;
    const next =
      index < path.segments.length - 1
        ? path.segments[index + 1]
        : path.closed
          ? path.segments[0]
          : outgoingAt(updated, segment.p2);
    if (!next) return;
    const mirror = reflect(segment.c2, segment.p2);
    updated = mapSegments(updated, (s) => (s.id === next.id ? { ...s, c1: mirror } : s));
  });
  return updated;
};

/**
 * Keep the handle pair across an anchor consistent after one of them moved.
 * Only applies to a single selected control point — dragging a whole selection
 * moves both sides anyway.
 */
export const applyHandleMirror = (
  before: Path[],
  after: Path[],
  selection: ReadonlySet<NodeKey>,
  mode: MirrorMode
): Path[] => {
  if (mode === 'none' || selection.size !== 1) return after;
  const parsed = parseNodeKey(selection.values().next().value as NodeKey);
  if (!parsed || (parsed.type !== 'c1' && parsed.type !== 'c2')) return after;

  const origin = locateSegment(before, parsed.segmentId);
  const moved = locateSegment(after, parsed.segmentId)?.segment;
  if (!origin || !moved) return after;

  // The segment on the other side of the anchor the handle hangs from.
  const { path, index } = origin;
  const partner =
    parsed.type === 'c2'
      ? index < path.segments.length - 1
        ? path.segments[index + 1]
        : path.closed
          ? path.segments[0]
          : outgoingAt(before, origin.segment.p2)
      : index > 0
        ? path.segments[index - 1]
        : path.closed
          ? path.segments[path.segments.length - 1]
          : incomingAt(before, origin.segment.p1);

  if (mode === 'break') {
    // Alt-drag splits the pair: whichever segment owns the junction flag drops it.
    const junction = parsed.type === 'c2' ? origin.segment : partner;
    if (!junction?.isSmoothP2) return after;
    return mapSegments(after, (s) => (s.id === junction.id ? { ...s, isSmoothP2: false } : s));
  }

  if (parsed.type === 'c2') {
    if (!origin.segment.isSmoothP2 || !partner) return after;
    const mirror = reflect(moved.c2, moved.p2);
    return mapSegments(after, (s) => (s.id === partner.id ? { ...s, c1: mirror } : s));
  }
  if (!partner?.isSmoothP2) return after;
  const mirror = reflect(moved.c1, moved.p1);
  return mapSegments(after, (s) => (s.id === partner.id ? { ...s, c2: mirror } : s));
};
