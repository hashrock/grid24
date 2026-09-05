import fc from 'fast-check';
import { expect } from 'vitest';
import type { Path, Point, Segment } from '../types';
import {
  NODE_TYPES,
  allSegments,
  endpointPoint,
  expandToControls,
  parseNodeKey,
  pointKey,
} from './geometry';
import { openEndpoints } from './selectors';
import { docReducer } from './reducer';
import { curve, doc, path as makePath } from './testFixtures';
import type { DocAction, DocState, NodeKey } from './types';

/**
 * Arbitraries and the action driver behind the property specs. Test-only, like
 * `testFixtures.ts` — no app code imports this.
 */

/** What an arbitrary produces. fast-check 4 ships no equivalent of its own. */
export type Infer<A> = A extends fc.Arbitrary<infer T> ? T : never;

/**
 * Coordinates live on a small half-unit grid, for two reasons. The value set is
 * narrow enough that anchors *coincide* by chance, which is what exercises the
 * weld and junction lookups (`near`, `incomingAt`, `outgoingAt`) instead of
 * leaving them dead code under the generator. And halves are exact in binary
 * floating point, so properties can compare geometry with `toEqual` rather than
 * with a tolerance.
 */
const arbCoord = fc.integer({ min: 0, max: 8 }).map((v) => v / 2);

export const arbPoint: fc.Arbitrary<Point> = fc.record({ x: arbCoord, y: arbCoord });

/** Nudges, in the same half-unit steps arrow keys and grid snapping produce. */
export const arbDelta: fc.Arbitrary<Point> = fc.record({
  x: fc.integer({ min: -4, max: 4 }).map((v) => v / 2),
  y: fc.integer({ min: -4, max: 4 }).map((v) => v / 2),
});

/**
 * Scale factors stay positive because a flip is not something the editor can
 * ask for: the transform box clamps the dragged corner so it stops at the
 * origin rather than crossing it (`Canvas.tsx`), so `sx`/`sy` never reach zero,
 * let alone go negative. `nodes/scale` itself places no constraint on the sign,
 * so this is a caller-side guarantee — widening it here would mean deciding
 * what a flip ought to do, which is a feature question and not a property one.
 *
 * (A negative factor also maps a coordinate sitting on the origin to `-0`,
 * which `JSON.stringify` writes as `0`; `svg.property.test.ts` documents that
 * same normalisation on its own side of the boundary.)
 */
const arbFactor = fc.constantFrom(0.5, 1, 2);

// --- Documents -------------------------------------------------------------

interface Chain {
  closed: boolean;
  start: Point;
  steps: { c1: Point; c2: Point; to: Point; smooth: boolean }[];
}

const arbChain: fc.Arbitrary<Chain> = fc.record({
  closed: fc.boolean(),
  start: arbPoint,
  steps: fc.array(
    fc.record({ c1: arbPoint, c2: arbPoint, to: arbPoint, smooth: fc.boolean() }),
    { minLength: 1, maxLength: 4 }
  ),
});

/**
 * A path built the way a real document is: `segments[i].p2` is
 * `segments[i + 1].p1`, and a closed path's last anchor lands back on the first.
 */
const buildPath = (id: string, chain: Chain): Path => {
  const segments: Segment[] = [];
  let from = chain.start;
  chain.steps.forEach((step, j) => {
    const to = chain.closed && j === chain.steps.length - 1 ? chain.start : step.to;
    // Cloned rather than shared, the way a document loaded from storage is: two
    // segments meeting at an anchor must not be able to alias one another.
    segments.push(
      curve(`${id}-${j}`, { ...from }, { ...step.c1 }, { ...step.c2 }, { ...to }, {
        isSmoothP2: step.smooth,
      })
    );
    from = to;
  });
  return makePath(id, segments, chain.closed);
};

/** A document the editor could hold: unique ids, no empty paths. */
export const arbPaths: fc.Arbitrary<Path[]> = fc
  .array(arbChain, { minLength: 1, maxLength: 3 })
  .map((chains) => chains.map((c, i) => buildPath(`i${i}`, c)));

// --- Ids -------------------------------------------------------------------

/**
 * Ids for whatever an action creates. The reducer takes every id from its
 * caller, so the driver plays the part the dispatcher plays in the app: hand
 * out ids that are new. Document ids are `i`-prefixed and minted ones `n`-, so
 * the two can never collide — nor can either with the `<id>/<n>` ids
 * `freshPathId` derives when a path breaks in two.
 */
export const createMint = () => {
  let n = 0;
  return () => `n${n++}`;
};

export type Mint = ReturnType<typeof createMint>;

// --- Actions ---------------------------------------------------------------

const arbPicks = fc.array(fc.nat(), { maxLength: 4 });

/** The selection-only half of the vocabulary, which must never touch geometry. */
export const arbSelectionRecipe = fc.oneof(
  fc.record({ k: fc.constant('select' as const), picks: arbPicks }),
  fc.record({ k: fc.constant('toggle' as const), picks: arbPicks }),
  fc.record({ k: fc.constant('selectPath' as const), n: fc.nat(), additive: fc.boolean() }),
  fc.record({ k: fc.constant('selectSegment' as const), n: fc.nat(), additive: fc.boolean() }),
  fc.record({
    k: fc.constant('box' as const),
    a: arbPoint,
    b: arbPoint,
    mode: fc.constantFrom('nodes' as const, 'paths' as const),
  }),
  fc.record({ k: fc.constant('clear' as const) })
);

/**
 * The two actions that move nodes that are already there. They are the only
 * ones that can pull an anchor away from the neighbour it meets — a selection
 * is free to hold one side of a joint without the other — which is why the
 * chain-continuity property below leaves them out.
 */
const arbMoveRecipe = fc.oneof(
  fc.record({
    k: fc.constant('translate' as const),
    delta: arbDelta,
    mirror: fc.constantFrom('none' as const, 'follow' as const, 'break' as const),
  }),
  fc.record({
    k: fc.constant('scale' as const),
    origin: arbPoint,
    sx: arbFactor,
    sy: arbFactor,
    snap: fc.constantFrom(0, 0.5),
  })
);

/**
 * Everything else that edits: it rearranges chains rather than moving nodes,
 * and leaves them joined where the array says they meet. `path/join` is the one
 * exception and has its own arbitrary below.
 */
export const arbStructureRecipe = fc.oneof(
  fc.record({ k: fc.constant('delete' as const) }),
  fc.record({ k: fc.constant('smooth' as const), n: fc.nat(), fromSelection: fc.boolean() }),
  fc.record({ k: fc.constant('toggleClosed' as const) }),
  fc.record({ k: fc.constant('reverse' as const), n: fc.nat() }),
  fc.record({
    k: fc.constant('split' as const),
    n: fc.nat(),
    t: fc.integer({ min: 1, max: 9 }).map((v) => v / 10),
  }),
  fc.record({ k: fc.constant('erase' as const), n: fc.nat() }),
  fc.record({
    k: fc.constant('pen' as const),
    n: fc.nat(),
    newPath: fc.boolean(),
    from: arbPoint,
    control: arbPoint,
    to: arbPoint,
    closing: fc.boolean(),
  }),
  fc.record({ k: fc.constant('penJoin' as const), n: fc.nat(), e: fc.nat(), control: arbPoint }),
  fc.record({
    k: fc.constant('penDrag' as const),
    n: fc.nat(),
    point: arbPoint,
    break: fc.boolean(),
  }),
  fc.record({ k: fc.constant('append' as const), chains: fc.array(arbChain, { minLength: 1, maxLength: 2 }) }),
  fc.record({ k: fc.constant('replace' as const), chains: fc.array(arbChain, { maxLength: 2 }) })
);

/**
 * Joining two ends that are apart does not move them together: it marks the
 * path closed and leaves the gap for the renderer's `Z` to draw. That is
 * legitimate on a loop, but breaking the loop open again rotates the chain to
 * start after the hole, which brings the seam — gap and all — into the middle
 * of the array. So a session containing a join cannot promise continuity, and
 * the property that does leaves this action out.
 */
const arbJoinRecipe = fc.record({
  k: fc.constant('join' as const),
  a: fc.nat(),
  b: fc.nat(),
  weld: fc.boolean(),
});

// Weighted by how many recipes each group holds, so that every one of them
// comes up about as often as any other rather than a group of two being drawn
// as often as a group of twelve.
const arbEditRecipe = fc.oneof(
  { arbitrary: arbMoveRecipe, weight: 2 },
  { arbitrary: arbStructureRecipe, weight: 11 },
  { arbitrary: arbJoinRecipe, weight: 1 }
);

export const arbRecipe = fc.oneof(
  { arbitrary: arbSelectionRecipe, weight: 6 },
  { arbitrary: arbEditRecipe, weight: 14 }
);

export type Recipe = Infer<typeof arbRecipe>;

const at = <T>(xs: readonly T[], n: number): T | null => (xs.length > 0 ? xs[n % xs.length] : null);

const nodeKeysOf = (paths: Path[]): NodeKey[] =>
  allSegments(paths).flatMap((s) => NODE_TYPES.map((t) => pointKey(s.id, t)));

const anchorKeysOf = (paths: Path[]): NodeKey[] =>
  allSegments(paths).flatMap((s) => [pointKey(s.id, 'p1'), pointKey(s.id, 'p2')]);

/** The node positions a scale gesture captures when the pointer goes down. */
export const snapshotSelection = (state: DocState): Record<NodeKey, Point> => {
  const keys = expandToControls(state.selection);
  const from: Record<NodeKey, Point> = {};
  for (const seg of allSegments(state.paths)) {
    for (const type of NODE_TYPES) {
      const key = pointKey(seg.id, type);
      if (keys.has(key)) from[key] = { ...seg[type] };
    }
  }
  return from;
};

/**
 * Turn a recipe into an action that makes sense *for this document*: indices
 * are taken modulo what is actually there, and a recipe with nothing to act on
 * yields `null` rather than an action the UI could never dispatch.
 *
 * Two shapes are excluded deliberately, because the Canvas cannot produce them
 * and the reducer does not defend against them: a `pen/join` onto the path the
 * pen is already drawing, and one naming a `pathId` that is not in the
 * document. Both drop the target path's segments on the floor.
 */
export const resolveRecipe = (state: DocState, r: Recipe, mint: Mint): DocAction | null => {
  const { paths } = state;
  switch (r.k) {
    case 'select':
    case 'toggle': {
      const all = nodeKeysOf(paths);
      const keys = r.picks.map((n) => at(all, n)).filter((k): k is NodeKey => k !== null);
      return r.k === 'select'
        ? { type: 'selection/set', keys }
        : { type: 'selection/toggle', keys };
    }

    case 'selectPath': {
      const path = at(paths, r.n);
      return path ? { type: 'selection/path', pathId: path.id, additive: r.additive } : null;
    }

    case 'selectSegment': {
      const seg = at(allSegments(paths), r.n);
      return seg ? { type: 'selection/segment', segmentId: seg.id, additive: r.additive } : null;
    }

    case 'box':
      return {
        type: 'selection/box',
        min: { x: Math.min(r.a.x, r.b.x), y: Math.min(r.a.y, r.b.y) },
        max: { x: Math.max(r.a.x, r.b.x), y: Math.max(r.a.y, r.b.y) },
        mode: r.mode,
      };

    case 'clear':
      return { type: 'selection/clear' };

    case 'translate':
      return { type: 'nodes/translate', delta: r.delta, mirror: r.mirror };

    case 'scale':
      return {
        type: 'nodes/scale',
        origin: r.origin,
        sx: r.sx,
        sy: r.sy,
        from: snapshotSelection(state),
        snap: r.snap,
      };

    case 'delete':
      return { type: 'nodes/delete' };

    case 'smooth': {
      if (r.fromSelection) return { type: 'anchor/toggleSmooth' };
      const key = at(anchorKeysOf(paths), r.n);
      return key ? { type: 'anchor/toggleSmooth', anchorKey: key } : null;
    }

    case 'toggleClosed':
      return { type: 'path/toggleClosed' };

    case 'reverse': {
      const path = at(paths, r.n);
      return path ? { type: 'path/reverse', pathId: path.id } : null;
    }

    case 'split': {
      const seg = at(allSegments(paths), r.n);
      return seg ? { type: 'segment/split', segmentId: seg.id, t: r.t, ids: [mint(), mint()] } : null;
    }

    case 'erase': {
      const seg = at(allSegments(paths), r.n);
      return seg ? { type: 'segment/erase', segmentId: seg.id } : null;
    }

    case 'join': {
      const ends = openEndpoints(paths);
      if (ends.length < 2) return null;
      const a = ends[r.a % ends.length];
      const rest = ends.filter((e) => e !== a);
      const b = rest[r.b % rest.length];
      return {
        type: 'path/join',
        id: mint(),
        a: { pathId: a.pathId, end: a.end },
        b: { pathId: b.pathId, end: b.end },
        at: r.weld ? { ...a.point } : undefined,
      };
    }

    case 'pen': {
      const target = r.newPath
        ? null
        : at(paths.filter((p) => !p.closed && p.segments.length > 0), r.n);
      // Closing is clicking the path's own start, so the pen lands exactly on
      // it; a path being created by this very click has nothing to close onto.
      const closing = target !== null && r.closing;
      return {
        type: 'pen/commit',
        id: mint(),
        pathId: target?.id ?? mint(),
        // The pen draws on from where the path currently ends (the Canvas
        // passes its live pen position); only a brand new path starts wherever
        // the pointer happened to be.
        from: target ? { ...endpointPoint(target, 'tail') } : r.from,
        control: r.control,
        to: target && closing ? { ...endpointPoint(target, 'head') } : r.to,
        closing,
      };
    }

    case 'penJoin': {
      const source = at(paths.filter((p) => !p.closed && p.segments.length > 0), r.n);
      if (!source) return null;
      const target = at(openEndpoints(paths).filter((e) => e.pathId !== source.id), r.e);
      if (!target) return null;
      return {
        type: 'pen/join',
        id: mint(),
        pathId: source.id,
        from: { ...endpointPoint(source, 'tail') },
        control: r.control,
        target: { pathId: target.pathId, end: target.end, point: { ...target.point } },
      };
    }

    case 'penDrag': {
      const seg = at(allSegments(paths), r.n);
      return seg ? { type: 'pen/dragHandle', segmentId: seg.id, point: r.point, break: r.break } : null;
    }

    case 'append':
      return { type: 'paths/append', paths: r.chains.map((c) => buildPath(mint(), c)) };

    case 'replace':
      return { type: 'paths/replace', paths: r.chains.map((c) => buildPath(mint(), c)) };
  }
};

// --- Driving a run ---------------------------------------------------------

/**
 * Freeze a document so that any write to it throws. Nothing here defends
 * against mutation at runtime — it is how the specs assert that the reducer
 * copies rather than edits in place.
 */
export const deepFreeze = (paths: Path[]): Path[] => {
  for (const path of paths) {
    for (const seg of path.segments) {
      for (const type of NODE_TYPES) Object.freeze(seg[type]);
      Object.freeze(seg);
    }
    Object.freeze(path.segments);
    Object.freeze(path);
  }
  Object.freeze(paths);
  return paths;
};

/** Replay a recipe list through `docReducer`, frozen at every step. */
export const replayDoc = (
  paths: Path[],
  recipes: readonly Recipe[],
  onStep?: (state: DocState, action: DocAction) => void
): DocState => {
  const mint = createMint();
  let state: DocState = doc(deepFreeze(paths));
  for (const recipe of recipes) {
    const action = resolveRecipe(state, recipe, mint);
    if (!action) continue;
    state = docReducer(state, action);
    deepFreeze(state.paths);
    onStep?.(state, action);
  }
  return state;
};

/**
 * Everything a caller may assume about a document the reducer produced.
 *
 * Note what is *not* here: that `segments[i].p2` and `segments[i + 1].p1` sit on
 * the same point. That coincidence is a property of the chain, not of the
 * document as a whole, and moving nodes is allowed to break it — clicking a
 * stroke selects one segment's two anchors precisely so it can be dragged away
 * from its neighbours. `expectContinuousChains` states it for the actions that
 * do have to preserve it.
 */
export const expectValidDoc = (state: DocState): void => {
  const pathIds = new Set<string>();
  const segmentIds = new Set<string>();
  for (const path of state.paths) {
    // A path with no segments has no `d`, so every renderer drops it: the
    // reducer removes such a path rather than leaving an invisible one behind.
    expect(path.segments.length).toBeGreaterThan(0);
    expect(pathIds.has(path.id)).toBe(false);
    pathIds.add(path.id);
    for (const seg of path.segments) {
      // Segment ids address nodes (`<segmentId>::<type>`), so a repeat would
      // make a selection key ambiguous — and grouping on save would merge two
      // unrelated segments.
      expect(segmentIds.has(seg.id)).toBe(false);
      segmentIds.add(seg.id);
      for (const type of NODE_TYPES) {
        expect(Number.isFinite(seg[type].x)).toBe(true);
        expect(Number.isFinite(seg[type].y)).toBe(true);
      }
    }
  }
  for (const key of state.selection) expect(parseNodeKey(key)).not.toBeNull();
};

/**
 * Compare two documents that ought to be geometrically the same.
 *
 * Structure — ids, chain order, open/closed, junction flags — has to match
 * exactly. Coordinates are compared with a tolerance, because `segment/split`
 * runs the curve through de Casteljau and leaves values that are no longer
 * whole halves; floating-point addition is neither associative nor invertible
 * on those, so `(x + d) - d` can miss `x` by an ulp. A millionth of a grid unit
 * is far finer than the three decimals the SVG writer rounds to, so a
 * difference this small cannot reach the icon.
 */
export const expectNearlySamePaths = (actual: Path[], expected: Path[]): void => {
  const structure = (paths: Path[]) =>
    paths.map((p) => ({
      id: p.id,
      closed: p.closed,
      segments: p.segments.map((s) => ({ id: s.id, isSmoothP2: !!s.isSmoothP2 })),
    }));
  expect(structure(actual)).toEqual(structure(expected));

  actual.forEach((path, i) =>
    path.segments.forEach((seg, j) => {
      const other = expected[i].segments[j];
      for (const type of NODE_TYPES) {
        expect(seg[type].x).toBeCloseTo(other[type].x, 6);
        expect(seg[type].y).toBeCloseTo(other[type].y, 6);
      }
    })
  );
};

/**
 * Chains meet where the array says they do: `segments[i].p2` is the point
 * `segments[i + 1].p1` sits on. `app/editor/types.ts` calls this the structural
 * invariant of a `Path`, and every action that *rearranges* a chain — splitting,
 * erasing, reversing, joining, drawing on with the pen — has to come out the
 * other side still honouring it.
 *
 * The wrap of a closed path is deliberately not checked. Joining two ends that
 * are apart marks the path closed and leaves the gap for the renderer's `Z` to
 * draw, so a loop's last anchor need not sit on its first.
 */
export const expectContinuousChains = (paths: Path[]): void => {
  for (const path of paths) {
    path.segments.forEach((seg, i) => {
      if (i === 0) return;
      expect(path.segments[i - 1].p2).toEqual(seg.p1);
    });
  }
};
