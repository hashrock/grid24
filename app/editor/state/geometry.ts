import type { Point, Segment } from '../types';
import type { MirrorMode, NodeKey, NodeType } from './types';

/**
 * Segments are connected implicitly, by position: two anchors closer than this
 * are the same junction. Every "is this segment attached to that one?" question
 * in the editor goes through here.
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
  const at = key.indexOf('::');
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

/** Drop selection entries whose segment no longer exists. */
export const pruneSelection = (
  selection: ReadonlySet<NodeKey>,
  segments: Segment[]
): ReadonlySet<NodeKey> => {
  if (selection.size === 0) return selection;
  const alive = new Set(segments.map((s) => s.id));
  const next = new Set<NodeKey>();
  selection.forEach((key) => {
    const parsed = parseNodeKey(key);
    if (parsed && alive.has(parsed.segmentId)) next.add(key);
  });
  return next.size === selection.size ? selection : next;
};

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

/**
 * Move every node in `keys`. Returns the *same array* when nothing moves, which
 * is what keeps zero-delta pointer moves (common under grid snapping) out of
 * the undo history and out of React's render path.
 */
export const translateNodes = (
  segments: Segment[],
  keys: ReadonlySet<NodeKey>,
  delta: Point
): Segment[] => {
  if (delta.x === 0 && delta.y === 0) return segments;
  let touched = false;
  const next = segments.map((seg) => {
    const moved = { ...seg };
    let changed = false;
    for (const t of NODE_TYPES) {
      if (!keys.has(pointKey(seg.id, t))) continue;
      moved[t] = { x: moved[t].x + delta.x, y: moved[t].y + delta.y };
      changed = true;
    }
    if (!changed) return seg;
    touched = true;
    return moved;
  });
  return touched ? next : segments;
};

/** Scale the nodes captured in `from` around `origin`. */
export const scaleNodes = (
  segments: Segment[],
  from: Record<NodeKey, Point>,
  origin: Point,
  sx: number,
  sy: number
): Segment[] => {
  let touched = false;
  const next = segments.map((seg) => {
    const moved = { ...seg };
    let changed = false;
    for (const t of NODE_TYPES) {
      const start = from[pointKey(seg.id, t)];
      if (!start) continue;
      const x = origin.x + (start.x - origin.x) * sx;
      const y = origin.y + (start.y - origin.y) * sy;
      if (x === moved[t].x && y === moved[t].y) continue;
      moved[t] = { x, y };
      changed = true;
    }
    if (!changed) return seg;
    touched = true;
    return moved;
  });
  return touched ? next : segments;
};

export const pathSegments = (segments: Segment[], pathId: string): Segment[] =>
  segments.filter((s) => s.pathId === pathId);

/** Group segments by path, preserving first-seen order. */
export const groupByPath = (segments: Segment[]): Map<string, Segment[]> => {
  const groups = new Map<string, Segment[]>();
  for (const s of segments) {
    const list = groups.get(s.pathId);
    if (list) list.push(s);
    else groups.set(s.pathId, [s]);
  }
  return groups;
};

/** The segment *arriving* at `pt` — its `isSmoothP2` flag owns that junction. */
export const incomingAt = (segments: Segment[], pt: Point): Segment | null =>
  segments.find((s) => near(s.p2, pt)) ?? null;

/** The segment *leaving* `pt` — its `c1` is the outgoing handle. */
export const outgoingAt = (segments: Segment[], pt: Point): Segment | null =>
  segments.find((s) => near(s.p1, pt)) ?? null;

/**
 * Reverse a path given its segments in chain order. Ids are preserved so the
 * caller can keep referring to a segment across the flip. Junction smoothness
 * travels with the junction: the flag on reversed[j].p2 is the original flag at
 * that same anchor.
 */
export const reversePath = (segs: Segment[]): Segment[] => {
  const n = segs.length;
  return segs.map((_, j) => {
    const o = segs[n - 1 - j];
    return {
      ...o,
      p1: o.p2,
      c1: o.c2,
      c2: o.c1,
      p2: o.p1,
      isSmoothP2: j < n - 1 ? !!segs[n - 2 - j].isSmoothP2 : false,
    };
  });
};

/**
 * The junction flag lives on the segment arriving at the anchor, so resolve
 * each selected node to that segment's id.
 */
const junctionIds = (segments: Segment[], keys: Iterable<NodeKey>): Set<string> => {
  const ids = new Set<string>();
  for (const key of keys) {
    const parsed = parseNodeKey(key);
    if (!parsed || (parsed.type !== 'p1' && parsed.type !== 'p2')) continue;
    const seg = segments.find((s) => s.id === parsed.segmentId);
    if (!seg) continue;
    if (parsed.type === 'p2') {
      ids.add(seg.id);
    } else {
      const incoming = incomingAt(segments, seg.p1);
      if (incoming) ids.add(incoming.id);
    }
  }
  return ids;
};

/**
 * Flip smooth/corner for the anchors named by `keys`. They all take the state
 * opposite the first one, so a mixed selection lands on a single value. Turning
 * a junction smooth mirrors the outgoing handle onto the incoming one.
 */
export const toggleAnchorsSmooth = (segments: Segment[], keys: Iterable<NodeKey>): Segment[] => {
  const junctions = junctionIds(segments, keys);
  if (junctions.size === 0) return segments;

  const firstId = junctions.values().next().value as string;
  const smooth = !segments.find((s) => s.id === firstId)?.isSmoothP2;

  let updated = segments.map((s) => (junctions.has(s.id) ? { ...s, isSmoothP2: smooth } : s));
  if (!smooth) return updated;

  junctions.forEach((id) => {
    const seg = updated.find((s) => s.id === id);
    if (!seg) return;
    const next = outgoingAt(updated, seg.p2);
    if (!next) return;
    const mirror = reflect(seg.c2, seg.p2);
    updated = updated.map((s) => (s.id === next.id ? { ...s, c1: mirror } : s));
  });
  return updated;
};

/**
 * Keep the handle pair across an anchor consistent after one of them moved.
 * Only applies to a single selected control point — dragging a whole selection
 * moves both sides anyway.
 */
export const applyHandleMirror = (
  before: Segment[],
  after: Segment[],
  selection: ReadonlySet<NodeKey>,
  mode: MirrorMode
): Segment[] => {
  if (mode === 'none' || selection.size !== 1) return after;
  const parsed = parseNodeKey(selection.values().next().value as NodeKey);
  if (!parsed || (parsed.type !== 'c1' && parsed.type !== 'c2')) return after;

  const origin = before.find((s) => s.id === parsed.segmentId);
  const moved = after.find((s) => s.id === parsed.segmentId);
  if (!origin || !moved) return after;

  if (mode === 'break') {
    if (parsed.type === 'c2') {
      if (!origin.isSmoothP2) return after;
      return after.map((s) => (s.id === origin.id ? { ...s, isSmoothP2: false } : s));
    }
    return after.map((s) =>
      s.id !== origin.id && s.isSmoothP2 && near(s.p2, origin.p1) ? { ...s, isSmoothP2: false } : s
    );
  }

  if (parsed.type === 'c2') {
    if (!origin.isSmoothP2) return after;
    const mirror = reflect(moved.c2, moved.p2);
    return after.map((s) => (near(s.p1, moved.p2) ? { ...s, c1: mirror } : s));
  }
  const mirror = reflect(moved.c1, moved.p1);
  return after.map((s) => (s.isSmoothP2 && near(s.p2, moved.p1) ? { ...s, c2: mirror } : s));
};
