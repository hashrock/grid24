import type { Path, Point, Segment } from '../types';
import { splitSegment } from '../utils/bezierHelper';
import {
  EMPTY_SELECTION,
  applyHandleMirror,
  eachSegment,
  expandToControls,
  findPath,
  locateSegment,
  mapPath,
  mapPathSegments,
  mapPaths,
  mapSegments,
  parseNodeKey,
  pathIds,
  pointKey,
  pruneSelection,
  reflect,
  removeSegments,
  reversePath,
  sameKeys,
  scaleNodes,
  toggleAnchorsSmooth,
  translateNodes,
} from './geometry';
import type { DocAction, DocState, NodeKey } from './types';

const inside = (p: Point, min: Point, max: Point) =>
  p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;

const anchorKeysOfPath = (path: Path): Set<NodeKey> => {
  const keys = new Set<NodeKey>();
  for (const s of path.segments) {
    keys.add(pointKey(s.id, 'p1'));
    keys.add(pointKey(s.id, 'p2'));
  }
  return keys;
};

/** Paths the selection reaches, in document order. */
const selectedPaths = (state: DocState): Path[] => {
  const ids = new Set<string>();
  state.selection.forEach((key) => {
    const parsed = parseNodeKey(key);
    if (parsed) ids.add(parsed.segmentId);
  });
  return state.paths.filter((p) => p.segments.some((s) => ids.has(s.id)));
};

const withPaths = (state: DocState, paths: Path[]): DocState =>
  paths === state.paths ? state : { ...state, paths };

const withSelection = (state: DocState, selection: ReadonlySet<NodeKey>): DocState =>
  sameKeys(selection, state.selection) ? state : { ...state, selection };

/**
 * Selecting a group of anchors at once (a whole path, or one segment's pair).
 * Shift toggles the group; a plain click on something already fully selected
 * keeps the wider selection so it stays draggable as one.
 */
const applyGroupSelection = (
  state: DocState,
  keys: Set<NodeKey>,
  additive: boolean
): DocState => {
  const fully = [...keys].every((k) => state.selection.has(k));
  if (additive) {
    const next = new Set(state.selection);
    keys.forEach((k) => (fully ? next.delete(k) : next.add(k)));
    return withSelection(state, next);
  }
  return fully ? state : withSelection(state, keys);
};

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
    case 'paths/replace': {
      if (state.paths.length === 0 && action.paths.length === 0) {
        return withSelection(state, EMPTY_SELECTION);
      }
      return { paths: action.paths, selection: EMPTY_SELECTION };
    }

    case 'paths/append': {
      if (action.paths.length === 0) return state;
      return { ...state, paths: [...state.paths, ...action.paths] };
    }

    case 'nodes/translate': {
      const moved = translateNodes(state.paths, expandToControls(state.selection), action.delta);
      if (moved === state.paths) return state;
      return { ...state, paths: applyHandleMirror(state.paths, moved, state.selection, action.mirror ?? 'none') };
    }

    case 'nodes/scale':
      return withPaths(state, scaleNodes(state.paths, action.from, action.origin, action.sx, action.sy));

    case 'nodes/delete': {
      if (state.selection.size === 0) return state;

      const anchorSegIds = new Set<string>();
      state.selection.forEach((key) => {
        const parsed = parseNodeKey(key);
        if (parsed && (parsed.type === 'p1' || parsed.type === 'p2')) anchorSegIds.add(parsed.segmentId);
      });

      // Deleting an anchor removes its adjoining segments (Illustrator-style).
      // A hole in the middle of a chain splits the path in two.
      if (anchorSegIds.size > 0) {
        // Ids are minted against every path in the document, not just the ones
        // already visited, so a split can't land on a later path's id.
        const taken = pathIds(state.paths);
        const paths: Path[] = [];
        for (const path of state.paths) {
          const out = removeSegments(path, anchorSegIds, taken);
          for (const p of out) taken.add(p.id);
          paths.push(...out);
        }
        return { paths, selection: EMPTY_SELECTION };
      }

      // Only control points selected: retract them into their anchors.
      const paths = mapSegments(state.paths, (s) => {
        let next = s;
        if (state.selection.has(pointKey(s.id, 'c1'))) next = { ...next, c1: { ...next.p1 } };
        if (state.selection.has(pointKey(s.id, 'c2')))
          next = { ...next, c2: { ...next.p2 }, isSmoothP2: false };
        return next;
      });
      return { paths, selection: EMPTY_SELECTION };
    }

    case 'anchor/toggleSmooth': {
      const keys = action.anchorKey ? [action.anchorKey] : state.selection;
      return withPaths(state, toggleAnchorsSmooth(state.paths, keys));
    }

    case 'path/toggleClosed': {
      const targets = selectedPaths(state);
      if (targets.length === 0) return state;
      const ids = new Set(targets.map((p) => p.id));
      return withPaths(
        state,
        mapPaths(state.paths, (path) => {
          if (!ids.has(path.id) || path.segments.length === 0) return path;
          const closed = !path.closed;
          if (!closed) return { ...path, closed };
          // Closing snaps the tail back onto the head.
          const head = path.segments[0].p1;
          const last = path.segments.length - 1;
          return {
            ...path,
            closed,
            segments: path.segments.map((s, i) => (i === last ? { ...s, p2: { ...head } } : s)),
          };
        })
      );
    }

    case 'path/reverse':
      return withPaths(state, mapPath(state.paths, action.pathId, reversePath));

    case 'segment/split': {
      const found = locateSegment(state.paths, action.segmentId);
      if (!found) return state;
      const [left, right] = splitSegment(found.segment, action.t, action.ids);
      // Keep the original endpoints exact and share the new midpoint.
      const mid: Point = { ...left.p2 };
      const halves: Segment[] = [
        { ...left, p1: found.segment.p1, p2: mid },
        { ...right, p1: mid, p2: found.segment.p2 },
      ];
      return withPaths(
        state,
        mapPath(state.paths, found.path.id, (path) => ({
          ...path,
          segments: path.segments.toSpliced(found.index, 1, ...halves),
        }))
      );
    }

    case 'segment/erase': {
      const found = locateSegment(state.paths, action.segmentId);
      if (!found) return state;
      const remove = new Set([action.segmentId]);
      const taken = pathIds(state.paths);
      const paths: Path[] = [];
      for (const path of state.paths) {
        if (path.id !== found.path.id) {
          paths.push(path);
          continue;
        }
        const out = removeSegments(path, remove, taken);
        for (const p of out) taken.add(p.id);
        paths.push(...out);
      }
      return { paths, selection: pruneSelection(state.selection, paths) };
    }

    case 'pen/commit': {
      const seg: Segment = {
        id: action.id,
        p1: action.from,
        c1: action.control,
        c2: action.to,
        p2: action.to,
        isSmoothP2: false,
      };
      const selection = new Set([pointKey(seg.id, 'p2')]);
      const existing = findPath(state.paths, action.pathId);
      if (!existing) {
        return {
          paths: [...state.paths, { id: action.pathId, closed: action.closing, segments: [seg] }],
          selection,
        };
      }
      return {
        paths: mapPath(state.paths, action.pathId, (path) => ({
          ...path,
          closed: action.closing || path.closed,
          segments: [...path.segments, seg],
        })),
        selection,
      };
    }

    case 'pen/join': {
      const target = findPath(state.paths, action.target.pathId);
      if (!target) return state;
      const bridge: Segment = {
        id: action.id,
        p1: action.from,
        c1: action.control,
        c2: action.target.point,
        p2: action.target.point,
        isSmoothP2: false,
      };
      // The bridge lands on the target's head, so a tail hit needs a flip first.
      const adopted = action.target.end === 'tail' ? reversePath(target) : target;
      const paths = state.paths
        .filter((p) => p.id !== action.target.pathId)
        .map((p) =>
          p.id === action.pathId
            ? { ...p, segments: [...p.segments, bridge, ...adopted.segments] }
            : p
        );
      return { paths, selection: new Set([pointKey(bridge.id, 'p2')]) };
    }

    case 'pen/dragHandle': {
      const found = locateSegment(state.paths, action.segmentId);
      if (!found) return state;
      const { path, segment, index } = found;
      // While closing a path, the start anchor's outgoing handle mirrors too.
      const wrap = path.closed && index === path.segments.length - 1 ? path.segments[0] : null;
      return withPaths(
        state,
        mapPath(state.paths, path.id, (p) =>
          mapPathSegments(p, (s) => {
            if (s.id === segment.id) return { ...s, c2: reflect(action.point, s.p2), isSmoothP2: true };
            if (wrap && s.id === wrap.id) return { ...s, c1: { ...action.point } };
            return s;
          })
        )
      );
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
      const path = findPath(state.paths, action.pathId);
      if (!path || path.segments.length === 0) return state;
      return applyGroupSelection(state, anchorKeysOfPath(path), action.additive);
    }

    case 'selection/segment': {
      const found = locateSegment(state.paths, action.segmentId);
      if (!found) return state;
      const keys = new Set([
        pointKey(found.segment.id, 'p1'),
        pointKey(found.segment.id, 'p2'),
      ]);
      return applyGroupSelection(state, keys, action.additive);
    }

    case 'selection/box': {
      const keys = new Set<NodeKey>();
      if (action.mode === 'paths') {
        // Object mode: a path is caught whole as soon as one anchor is inside.
        for (const path of state.paths) {
          const touched = path.segments.some(
            (s) => inside(s.p1, action.min, action.max) || inside(s.p2, action.min, action.max)
          );
          if (touched) anchorKeysOfPath(path).forEach((k) => keys.add(k));
        }
      } else {
        for (const { segment } of eachSegment(state.paths)) {
          if (inside(segment.p1, action.min, action.max)) keys.add(pointKey(segment.id, 'p1'));
          if (inside(segment.p2, action.min, action.max)) keys.add(pointKey(segment.id, 'p2'));
        }
      }
      return withSelection(state, keys);
    }

    case 'selection/clear':
      return withSelection(state, EMPTY_SELECTION);
  }
}
