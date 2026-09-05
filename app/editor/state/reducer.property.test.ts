import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseContent, serializeContent } from '../../lib/svg';
import {
  allSegments,
  expandToControls,
  parseNodeKey,
  pathIds,
  pruneSelection,
  removeSegments,
  reversePath,
  sameKeys,
} from './geometry';
import { docReducer } from './reducer';
import { doc } from './testFixtures';
import {
  arbDelta,
  arbPaths,
  arbPoint,
  arbRecipe,
  arbSelectionRecipe,
  arbStructureRecipe,
  createMint,
  expectContinuousChains,
  expectNearlySamePaths,
  expectValidDoc,
  replayDoc,
  resolveRecipe,
  snapshotSelection,
} from './testArbitraries';
import type { Point } from '../types';
import type { DocAction, DocState, NodeKey } from './types';

/**
 * Property-based cover for the document reducer.
 *
 * `reducer.test.ts` pins what each action does to a hand-built document. These
 * specs come at it from the other end: drive the reducer with *sequences* of
 * actions the Canvas could really dispatch, and assert the things that have to
 * hold whatever the sequence was — the document stays well formed, its chains
 * stay joined, edits are built rather than made in place, and the operations
 * that ought to compose, commute, or cancel actually do.
 */

/** A document plus an editing session to replay against it. */
const arbRunOf = <R>(recipe: fc.Arbitrary<R>, maxLength: number) =>
  fc.tuple(arbPaths, fc.array(recipe, { maxLength }));

const arbRun = arbRunOf(arbRecipe, 20);
const arbShortRun = arbRunOf(arbRecipe, 10);
// The actions that keep a chain joined: everything but the two that move nodes
// already placed, and `path/join`, which may leave a `Z` seam behind.
const arbStructureRun = arbRunOf(fc.oneof(arbSelectionRecipe, arbStructureRecipe), 20);

const translate = (delta: Point): DocAction => ({
  type: 'nodes/translate',
  delta,
  mirror: 'none',
});

const run = (state: DocState, actions: DocAction[]): DocState => actions.reduce(docReducer, state);

describe('every reachable document', () => {
  it('stays well formed through any sequence of edits', () => {
    fc.assert(
      fc.property(arbRun, ([paths, recipes]) => {
        expectValidDoc(replayDoc(paths, recipes, expectValidDoc));
      })
    );
  });

  it('is built without mutating the document it was given', () => {
    // `replayDoc` freezes the document after every step, so an edit made in
    // place throws instead of quietly corrupting a snapshot the undo stack is
    // still holding on to.
    fc.assert(
      fc.property(arbRun, ([paths, recipes]) => {
        expect(() => replayDoc(paths, recipes)).not.toThrow();
      })
    );
  });

  it('keeps its chains joined under every action that rearranges one', () => {
    // Splitting, erasing, reversing, joining and drawing on all rebuild a chain,
    // and every one of them has to leave `segments[i].p2` where
    // `segments[i + 1].p1` is. Moving nodes is excluded because it is allowed to
    // pull a joint apart: clicking a stroke selects that one segment's two
    // anchors so it can be dragged away from its neighbours on purpose.
    fc.assert(
      fc.property(arbStructureRun, ([paths, recipes]) => {
        replayDoc(paths, recipes, (state) => expectContinuousChains(state.paths));
      })
    );
  });

  it('survives a save and load unchanged', () => {
    // `svg.property.test.ts` proves the round trip for arbitrary documents;
    // this one proves that everything editing can *reach* is such a document.
    fc.assert(
      fc.property(arbRun, ([paths, recipes]) => {
        const { paths: edited } = replayDoc(paths, recipes);
        expect(parseContent(serializeContent(edited))).toEqual(edited);
      })
    );
  });
});

describe('selection actions', () => {
  it('never touch the geometry', () => {
    fc.assert(
      fc.property(arbShortRun, arbSelectionRecipe, ([paths, recipes], recipe) => {
        const state = replayDoc(paths, recipes);
        const action = resolveRecipe(state, recipe, createMint());
        if (!action) return;
        expect(docReducer(state, action).paths).toBe(state.paths);
      })
    );
  });

  it('toggling the same keys twice restores the selection', () => {
    fc.assert(
      fc.property(arbShortRun, fc.array(fc.nat(), { maxLength: 4 }), ([paths, recipes], picks) => {
        const state = replayDoc(paths, recipes);
        const action = resolveRecipe(state, { k: 'toggle', picks }, createMint());
        if (!action) return;
        const twice = docReducer(docReducer(state, action), action);
        expect([...twice.selection].sort()).toEqual([...state.selection].sort());
      })
    );
  });
});

/**
 * Actions that land on a fixed point. Each is dispatched twice as the *same*
 * action, so the second one must both change nothing and honour the no-op
 * contract by returning the very object it was handed — that reference is what
 * keeps a repeat out of the undo history.
 */
const arbIdempotentRecipe = fc.oneof(
  fc.record({ k: fc.constant('select' as const), picks: fc.array(fc.nat(), { maxLength: 4 }) }),
  fc.record({ k: fc.constant('clear' as const) }),
  fc.record({
    k: fc.constant('box' as const),
    a: arbPoint,
    b: arbPoint,
    mode: fc.constantFrom('nodes' as const, 'paths' as const),
  }),
  fc.record({ k: fc.constant('delete' as const) })
);

describe('idempotent actions', () => {
  it('reach a fixed point after one application', () => {
    fc.assert(
      fc.property(arbShortRun, arbIdempotentRecipe, ([paths, recipes], recipe) => {
        const state = replayDoc(paths, recipes);
        const action = resolveRecipe(state, recipe, createMint());
        if (!action) return;
        const once = docReducer(state, action);
        expect(docReducer(once, action)).toBe(once);
      })
    );
  });
});

describe('nodes/translate', () => {
  it('composes: two nudges equal one nudge by their sum', () => {
    fc.assert(
      fc.property(arbShortRun, arbDelta, arbDelta, ([paths, recipes], d1, d2) => {
        const state = replayDoc(paths, recipes);
        expectNearlySamePaths(
          run(state, [translate(d1), translate(d2)]).paths,
          docReducer(state, translate({ x: d1.x + d2.x, y: d1.y + d2.y })).paths
        );
      })
    );
  });

  it('cancels: nudging back leaves the document as it was', () => {
    fc.assert(
      fc.property(arbShortRun, arbDelta, ([paths, recipes], delta) => {
        const state = replayDoc(paths, recipes);
        const there = docReducer(state, translate(delta));
        const back = docReducer(there, translate({ x: -delta.x, y: -delta.y }));
        expectNearlySamePaths(back.paths, state.paths);
      })
    );
  });

  it('is order-independent across two selections', () => {
    fc.assert(
      fc.property(
        arbShortRun,
        fc.array(fc.nat(), { maxLength: 4 }),
        fc.array(fc.nat(), { maxLength: 4 }),
        arbDelta,
        arbDelta,
        ([paths, recipes], picksA, picksB, dA, dB) => {
          const state = replayDoc(paths, recipes);
          const mint = createMint();
          const selectA = resolveRecipe(state, { k: 'select', picks: picksA }, mint);
          const selectB = resolveRecipe(state, { k: 'select', picks: picksB }, mint);
          if (!selectA || !selectB) return;
          // Which nodes a nudge moves is decided by segment id, not by where
          // anything currently sits, so moving A then B has to land where
          // moving B then A does.
          const forward = run(state, [selectA, translate(dA), selectB, translate(dB)]);
          const backward = run(state, [selectB, translate(dB), selectA, translate(dA)]);
          expectNearlySamePaths(forward.paths, backward.paths);
        }
      )
    );
  });
});

/**
 * A freshly generated document with a selection on it. Nothing has been through
 * curve maths yet, so every coordinate is still an exact half-unit.
 */
const arbGridSelection: fc.Arbitrary<DocState> = fc
  .tuple(arbPaths, fc.array(fc.nat(), { maxLength: 4 }))
  .map(([paths, picks]) => {
    const start = doc(paths);
    const select = resolveRecipe(start, { k: 'select', picks }, createMint());
    return select ? docReducer(start, select) : start;
  });

describe('nodes/scale', () => {
  it('is the identity at factor 1', () => {
    // On the half-unit grid the editor snaps to, `origin + (p - origin)` is
    // exact — so a scale that moves nothing must return the very state it was
    // handed, which is what keeps a dead gesture out of the undo history.
    fc.assert(
      fc.property(arbGridSelection, arbPoint, (state, origin) => {
        const action: DocAction = {
          type: 'nodes/scale',
          origin,
          sx: 1,
          sy: 1,
          from: snapshotSelection(state),
          snap: 0,
        };
        expect(docReducer(state, action)).toBe(state);
      })
    );
  });

  it('is undone by scaling back by the reciprocal', () => {
    // Doubling and halving a half-unit is exact, so this comparison needs no
    // tolerance — unlike the ones above, which run on documents a split has
    // already pushed off the grid.
    fc.assert(
      fc.property(arbGridSelection, arbPoint, (state, origin) => {
        const up = docReducer(state, {
          type: 'nodes/scale',
          origin,
          sx: 2,
          sy: 2,
          from: snapshotSelection(state),
          snap: 0,
        });
        const down = docReducer(up, {
          type: 'nodes/scale',
          origin,
          sx: 0.5,
          sy: 0.5,
          from: snapshotSelection(up),
          snap: 0,
        });
        expect(down.paths).toEqual(state.paths);
      })
    );
  });
});

describe('paths/append', () => {
  it('leaves every path already on the canvas untouched', () => {
    fc.assert(
      fc.property(arbShortRun, arbPaths, ([paths, recipes], added) => {
        const state = replayDoc(paths, recipes);
        const next = docReducer(state, { type: 'paths/append', paths: added });
        expect(next.paths.slice(0, state.paths.length)).toEqual(state.paths);
        expect(next.paths).toHaveLength(state.paths.length + added.length);
        expect(next.selection).toBe(state.selection);
      })
    );
  });
});

describe('segment/split', () => {
  it('adds one segment without moving the path it cuts', () => {
    fc.assert(
      fc.property(arbPaths, fc.nat(), fc.integer({ min: 1, max: 9 }), (paths, n, tenth) => {
        const state = doc(paths);
        const segments = allSegments(paths);
        const target = segments[n % segments.length];
        const before = paths.find((p) => p.segments.some((s) => s.id === target.id))!;
        const next = docReducer(state, {
          type: 'segment/split',
          segmentId: target.id,
          t: tenth / 10,
          ids: ['L', 'R'],
        });

        expect(next.paths).toHaveLength(paths.length);
        expect(allSegments(next.paths)).toHaveLength(segments.length + 1);

        const after = next.paths.find((p) => p.id === before.id)!;
        expect(after.closed).toBe(before.closed);
        // The outline is unchanged: the two halves keep the original segment's
        // endpoints and share the new anchor exactly.
        expect(after.segments[0].p1).toEqual(before.segments[0].p1);
        expect(after.segments.at(-1)!.p2).toEqual(before.segments.at(-1)!.p2);
        const left = after.segments.find((s) => s.id === 'L')!;
        const right = after.segments.find((s) => s.id === 'R')!;
        expect(left.p1).toEqual(target.p1);
        expect(right.p2).toEqual(target.p2);
        expect(left.p2).toEqual(right.p1);
      })
    );
  });
});

describe('reversePath', () => {
  it('restores the path when applied twice', () => {
    fc.assert(
      fc.property(arbPaths, fc.nat(), (paths, n) => {
        const path = paths[n % paths.length];
        const back = reversePath(reversePath(path));
        expect(back.id).toBe(path.id);
        expect(back.closed).toBe(path.closed);
        expect(back.segments.map((s) => s.id)).toEqual(path.segments.map((s) => s.id));
        const geometry = (p: typeof path) =>
          p.segments.map(({ isSmoothP2: _flag, ...rest }) => rest);
        expect(geometry(back)).toEqual(geometry(path));
      })
    );
  });

  it('keeps every junction flag except the one at the tail', () => {
    // The flag lives on the *arriving* segment, and the last segment arrives at
    // the free tail of an open path — there is no junction there to describe,
    // so reversing normalises it to false. On a closed path that same slot is
    // the seam, which is why a reversed loop comes back with a corner there.
    fc.assert(
      fc.property(arbPaths, fc.nat(), (paths, n) => {
        const path = paths[n % paths.length];
        const back = reversePath(reversePath(path));
        const flags = back.segments.map((s) => !!s.isSmoothP2);
        const original = path.segments.map((s) => !!s.isSmoothP2);
        expect(flags.slice(0, -1)).toEqual(original.slice(0, -1));
        expect(flags.at(-1)).toBe(false);
        // Which makes a second round trip a genuine no-op.
        expect(reversePath(reversePath(back))).toEqual(back);
      })
    );
  });
});

describe('removeSegments', () => {
  it('conserves every segment it does not remove', () => {
    fc.assert(
      fc.property(arbPaths, fc.array(fc.nat(), { maxLength: 4 }), (paths, picks) => {
        const path = paths[0];
        const ids = path.segments.map((s) => s.id);
        const remove = new Set(picks.map((n) => ids[n % ids.length]));
        const taken = pathIds(paths);
        const out = removeSegments(path, remove, taken);
        const kept = ids.filter((id) => !remove.has(id));

        const survivors = out.flatMap((p) => p.segments.map((s) => s.id));
        expect([...survivors].sort()).toEqual([...kept].sort());
        for (const p of out) expect(p.segments.length).toBeGreaterThan(0);
        expect(new Set(out.map((p) => p.id)).size).toBe(out.length);
        // The first survivor inherits the path's identity; any further chain is
        // a genuinely new path, so its id has to be one nobody else holds.
        for (const p of out.slice(1)) expect(taken.has(p.id)).toBe(false);
        // Breaking a chain always yields open chains — a loop with a hole in it
        // would render a phantom line across the gap.
        if (remove.size > 0) for (const p of out) expect(p.closed).toBe(false);
      })
    );
  });

  it('keeps the surviving order of an open path', () => {
    fc.assert(
      fc.property(arbPaths, fc.array(fc.nat(), { maxLength: 4 }), (paths, picks) => {
        const path = { ...paths[0], closed: false };
        const ids = path.segments.map((s) => s.id);
        const remove = new Set(picks.map((n) => ids[n % ids.length]));
        const out = removeSegments(path, remove, pathIds(paths));
        expect(out.flatMap((p) => p.segments.map((s) => s.id))).toEqual(
          ids.filter((id) => !remove.has(id))
        );
      })
    );
  });
});

describe('selection helpers', () => {
  it('pruneSelection drops exactly the keys with no segment behind them', () => {
    fc.assert(
      fc.property(
        arbShortRun,
        fc.array(fc.string({ minLength: 1 }), { maxLength: 3 }),
        ([paths, recipes], junk) => {
          const state = replayDoc(paths, recipes);
          const selection: ReadonlySet<NodeKey> = new Set([
            ...state.selection,
            ...junk.map((j) => `${j}::p1`),
          ]);
          const alive = new Set(allSegments(state.paths).map((s) => s.id));
          const once = pruneSelection(selection, state.paths);
          for (const key of once) {
            expect(selection.has(key)).toBe(true);
            expect(alive.has(parseNodeKey(key)!.segmentId)).toBe(true);
          }
          for (const key of selection) {
            const parsed = parseNodeKey(key);
            if (parsed && alive.has(parsed.segmentId)) expect(once.has(key)).toBe(true);
          }
          // Nothing left to drop, so the second pass hands the same set back.
          expect(pruneSelection(once, state.paths)).toBe(once);
        }
      )
    );
  });

  it('expandToControls is idempotent', () => {
    fc.assert(
      fc.property(arbShortRun, ([paths, recipes]) => {
        const { selection } = replayDoc(paths, recipes);
        const once = expandToControls(selection);
        expect(sameKeys(expandToControls(once), once)).toBe(true);
      })
    );
  });
});
