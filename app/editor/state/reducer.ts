import type { Point, Segment } from '../types';
import { splitSegment } from '../utils/bezierHelper';
import {
  EMPTY_SELECTION,
  applyHandleMirror,
  expandToControls,
  near,
  parseNodeKey,
  pathSegments,
  pointKey,
  pruneSelection,
  reflect,
  reversePath,
  sameKeys,
  scaleNodes,
  toggleAnchorsSmooth,
  translateNodes,
} from './geometry';
import type { DocAction, DocState, NodeKey } from './types';

const inside = (p: Point, min: Point, max: Point) =>
  p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;

/** Anchor keys (`p1`/`p2`) of every segment in a path. */
const anchorKeysOfPath = (segments: Segment[], pathId: string): Set<NodeKey> => {
  const keys = new Set<NodeKey>();
  for (const s of segments) {
    if (s.pathId !== pathId) continue;
    keys.add(pointKey(s.id, 'p1'));
    keys.add(pointKey(s.id, 'p2'));
  }
  return keys;
};

const withSegments = (state: DocState, segments: Segment[]): DocState =>
  segments === state.segments ? state : { ...state, segments };

const withSelection = (state: DocState, selection: ReadonlySet<NodeKey>): DocState =>
  sameKeys(selection, state.selection) ? state : { ...state, selection };

/**
 * The single place the document changes. Pure and id-free — every new segment
 * id is supplied by the caller — so it can be exercised in tests without React
 * or a uuid stub.
 *
 * Contract: return the *same* state object when an action is a no-op. The
 * history layer uses reference equality to decide whether to record a step, so
 * "gesture that changed nothing" never pollutes undo.
 */
export function docReducer(state: DocState, action: DocAction): DocState {
  switch (action.type) {
    case 'segments/replace': {
      if (state.segments.length === 0 && action.segments.length === 0) {
        return withSelection(state, EMPTY_SELECTION);
      }
      return { segments: action.segments, selection: EMPTY_SELECTION };
    }

    case 'segments/append': {
      if (action.segments.length === 0) return state;
      return { ...state, segments: [...state.segments, ...action.segments] };
    }

    case 'nodes/translate': {
      const moved = translateNodes(state.segments, expandToControls(state.selection), action.delta);
      if (moved === state.segments) return state;
      const segments = applyHandleMirror(state.segments, moved, state.selection, action.mirror ?? 'none');
      return { ...state, segments };
    }

    case 'nodes/scale':
      return withSegments(
        state,
        scaleNodes(state.segments, action.from, action.origin, action.sx, action.sy)
      );

    case 'nodes/delete': {
      if (state.selection.size === 0) return state;

      const anchorSegIds = new Set<string>();
      state.selection.forEach((key) => {
        const parsed = parseNodeKey(key);
        if (parsed && (parsed.type === 'p1' || parsed.type === 'p2')) anchorSegIds.add(parsed.segmentId);
      });

      // Deleting an anchor removes its adjoining segments (Illustrator-style);
      // a path that loses a segment is no longer closed.
      if (anchorSegIds.size > 0) {
        const broken = new Set(
          state.segments.filter((s) => anchorSegIds.has(s.id)).map((s) => s.pathId)
        );
        const segments = state.segments
          .filter((s) => !anchorSegIds.has(s.id))
          .map((s) => (broken.has(s.pathId) && s.isClosed ? { ...s, isClosed: false } : s));
        return { segments, selection: EMPTY_SELECTION };
      }

      // Only control points selected: retract them into their anchors.
      const segments = state.segments.map((s) => {
        let next = s;
        if (state.selection.has(pointKey(s.id, 'c1'))) next = { ...next, c1: { ...next.p1 } };
        if (state.selection.has(pointKey(s.id, 'c2')))
          next = { ...next, c2: { ...next.p2 }, isSmoothP2: false };
        return next;
      });
      return { segments, selection: EMPTY_SELECTION };
    }

    case 'anchor/toggleSmooth': {
      const keys = action.anchorKey ? [action.anchorKey] : state.selection;
      return withSegments(state, toggleAnchorsSmooth(state.segments, keys));
    }

    case 'path/toggleClosed': {
      const pathIds = new Set<string>();
      state.selection.forEach((key) => {
        const parsed = parseNodeKey(key);
        const seg = parsed && state.segments.find((s) => s.id === parsed.segmentId);
        if (seg) pathIds.add(seg.pathId);
      });
      if (pathIds.size === 0) return state;

      let segments = state.segments;
      pathIds.forEach((pathId) => {
        const segs = pathSegments(segments, pathId);
        if (segs.length === 0) return;
        const closed = !segs[0].isClosed;
        const head = segs[0].p1;
        const tailId = segs[segs.length - 1].id;
        segments = segments.map((s) => {
          if (s.pathId !== pathId) return s;
          // Closing snaps the tail back onto the head (segments are in chain order).
          if (closed && s.id === tailId) return { ...s, isClosed: true, p2: { ...head } };
          return { ...s, isClosed: closed };
        });
      });
      return withSegments(state, segments);
    }

    case 'path/reverse': {
      const path = pathSegments(state.segments, action.pathId);
      if (path.length === 0) return state;
      return {
        ...state,
        segments: [...state.segments.filter((s) => s.pathId !== action.pathId), ...reversePath(path)],
      };
    }

    case 'segment/split': {
      const index = state.segments.findIndex((s) => s.id === action.segmentId);
      if (index < 0) return state;
      const target = state.segments[index];
      const [left, right] = splitSegment(target, action.t, action.ids);
      // Keep the original endpoints exact and share the new midpoint, so the
      // two halves stay joined under the position-based connectivity rules.
      const mid: Point = { ...left.p2 };
      const segments = [...state.segments];
      segments.splice(index, 1, { ...left, p1: target.p1, p2: mid }, { ...right, p1: mid, p2: target.p2 });
      return { ...state, segments };
    }

    case 'segment/erase': {
      const segments = state.segments.filter((s) => s.id !== action.segmentId);
      if (segments.length === state.segments.length) return state;
      return { segments, selection: pruneSelection(state.selection, segments) };
    }

    case 'pen/commit': {
      const seg: Segment = {
        id: action.id,
        pathId: action.pathId,
        p1: action.from,
        c1: action.control,
        c2: action.to,
        p2: action.to,
        isSmoothP2: false,
        isClosed: action.closing,
      };
      let segments = [...state.segments, seg];
      if (action.closing) {
        segments = segments.map((s) => (s.pathId === action.pathId ? { ...s, isClosed: true } : s));
      }
      return { segments, selection: new Set([pointKey(seg.id, 'p2')]) };
    }

    case 'pen/join': {
      const bridge: Segment = {
        id: action.id,
        pathId: action.pathId,
        p1: action.from,
        c1: action.control,
        c2: action.target.point,
        p2: action.target.point,
        isSmoothP2: false,
        isClosed: false,
      };
      const other = pathSegments(state.segments, action.target.pathId);
      const rest = state.segments.filter((s) => s.pathId !== action.target.pathId);
      // The bridge lands on the target's head, so a tail hit needs a flip first.
      const merged = (action.target.end === 'tail' ? reversePath(other) : other).map((s) => ({
        ...s,
        pathId: action.pathId,
      }));
      return {
        segments: [...rest, bridge, ...merged],
        selection: new Set([pointKey(bridge.id, 'p2')]),
      };
    }

    case 'pen/dragHandle': {
      const seg = state.segments.find((s) => s.id === action.segmentId);
      if (!seg) return state;
      const segments = state.segments.map((s) => {
        if (s.id === seg.id) return { ...s, c2: reflect(action.point, s.p2), isSmoothP2: true };
        // While closing a path, the start anchor's outgoing handle mirrors too.
        if (seg.isClosed && s.pathId === seg.pathId && near(s.p1, seg.p2)) {
          return { ...s, c1: { ...action.point } };
        }
        return s;
      });
      return { ...state, segments };
    }

    case 'selection/set':
      return withSelection(state, new Set(action.keys));

    case 'selection/toggle': {
      const next = new Set(state.selection);
      for (const key of action.keys) {
        if (next.has(key)) next.delete(key);
        else next.add(key);
      }
      return withSelection(state, next);
    }

    case 'selection/path': {
      const keys = anchorKeysOfPath(state.segments, action.pathId);
      if (keys.size === 0) return state;
      const fully = [...keys].every((k) => state.selection.has(k));
      if (action.additive) {
        const next = new Set(state.selection);
        keys.forEach((k) => (fully ? next.delete(k) : next.add(k)));
        return withSelection(state, next);
      }
      // Clicking an already-selected path keeps the wider selection draggable.
      return fully ? state : withSelection(state, keys);
    }

    case 'selection/box': {
      const keys = new Set<NodeKey>();
      for (const s of state.segments) {
        if (inside(s.p1, action.min, action.max)) keys.add(pointKey(s.id, 'p1'));
        if (inside(s.p2, action.min, action.max)) keys.add(pointKey(s.id, 'p2'));
      }
      return withSelection(state, keys);
    }

    case 'selection/clear':
      return withSelection(state, EMPTY_SELECTION);
  }
}
