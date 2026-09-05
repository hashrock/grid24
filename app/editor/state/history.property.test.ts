import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createEditorState, editorReducer } from './history';
import { polyline, pt } from './testFixtures';
import {
  arbPaths,
  arbRecipe,
  arbSelectionRecipe,
  createMint,
  deepFreeze,
  expectValidDoc,
  resolveRecipe,
  type Infer,
} from './testArbitraries';
import type { Path } from '../types';
import type { EditorAction, EditorState } from './types';

/**
 * Property-based cover for undo/redo.
 *
 * `history.test.ts` walks the stack by hand for a handful of shapes. These
 * specs assert the laws instead: whatever an editing session did, undoing every
 * recorded step lands back on the document it opened with, redoing them all
 * lands back on the one it ended with, and no amount of undoing and redoing can
 * create or lose a step — or reach a document that is not well formed.
 */

const arbEntries = fc.array(
  fc.record({
    recipe: arbRecipe,
    // A gesture key per action, the way the dispatcher hands one out: a run of
    // equal keys is one pointer drag and has to collapse into one undo step.
    mergeKey: fc.option(fc.constantFrom('g1', 'g2', 'g3'), { nil: undefined }),
  }),
  // Comfortably under MAX_HISTORY, so nothing is dropped off the back of the
  // stack — the cap gets its own spec below.
  { maxLength: 20 }
);

type Entries = Infer<typeof arbEntries>;

/** Replay an editing session, freezing the document at every step. */
const drive = (paths: Path[], entries: Entries): EditorState => {
  const mint = createMint();
  let state = createEditorState(deepFreeze(paths));
  for (const { recipe, mergeKey } of entries) {
    const action = resolveRecipe(state.doc, recipe, mint);
    if (!action) continue;
    state = editorReducer(state, { ...action, mergeKey });
    // Freezing after the fact covers the snapshots in `past` too: the undo
    // stack must never be edited through the document that is still live.
    deepFreeze(state.doc.paths);
  }
  return state;
};

const undo: EditorAction = { type: 'history/undo' };
const redo: EditorAction = { type: 'history/redo' };
const repeat = (state: EditorState, action: EditorAction, times: number): EditorState => {
  let next = state;
  for (let i = 0; i < times; i++) next = editorReducer(next, action);
  return next;
};

describe('undo and redo', () => {
  it('walk back to the document the session opened with, and forward again', () => {
    fc.assert(
      fc.property(arbPaths, arbEntries, (paths, entries) => {
        const done = drive(paths, entries);
        const steps = done.past.length;

        const back = repeat(done, undo, steps);
        expect(back.doc.paths).toEqual(paths);
        expect(canUndo(back)).toBe(false);

        const forward = repeat(back, redo, steps);
        expect(forward.doc).toEqual(done.doc);
        expect(canRedo(forward)).toBe(false);
      })
    );
  });

  it('conserve the number of history entries, however they are mixed', () => {
    fc.assert(
      fc.property(
        arbPaths,
        arbEntries,
        fc.array(fc.boolean(), { maxLength: 30 }),
        (paths, entries, moves) => {
          let state = drive(paths, entries);
          const total = state.past.length + state.future.length;
          for (const goBack of moves) {
            state = editorReducer(state, goBack ? undo : redo);
            expect(state.past.length + state.future.length).toBe(total);
            expect(canUndo(state)).toBe(state.past.length > 0);
            expect(canRedo(state)).toBe(state.future.length > 0);
            expectValidDoc(state.doc);
          }
        }
      )
    );
  });

  it('cancel each other out', () => {
    fc.assert(
      fc.property(arbPaths, arbEntries, (paths, entries) => {
        const state = drive(paths, entries);
        if (!canUndo(state)) return;
        // The redone document is the very object that was live before the undo,
        // not a copy of it — history stores snapshots, it does not rebuild them.
        expect(editorReducer(editorReducer(state, undo), redo).doc).toBe(state.doc);
      })
    );
  });

  it('never record a selection change', () => {
    fc.assert(
      fc.property(arbPaths, arbEntries, arbSelectionRecipe, (paths, entries, recipe) => {
        const state = drive(paths, entries);
        const action = resolveRecipe(state.doc, recipe, createMint());
        if (!action) return;
        const next = editorReducer(state, { ...action, mergeKey: 'gesture' });
        expect(next.past).toBe(state.past);
        expect(next.future).toBe(state.future);
      })
    );
  });
});

// --- Gesture merging -------------------------------------------------------

const PATHS = [polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0)])];
const ALL_ANCHORS = ['P1::p1', 'P1::p2', 'P2::p1', 'P2::p2'];

const arbSteps = fc.array(
  fc.oneof(
    fc.record({ kind: fc.constant('edit' as const), key: fc.constantFrom(null, 'g1', 'g2') }),
    fc.record({ kind: fc.constant('select' as const) })
  ),
  { maxLength: 15 }
);

describe('gesture merging', () => {
  it('records one step per run of equal gesture keys', () => {
    fc.assert(
      fc.property(arbSteps, (steps) => {
        let state = editorReducer(createEditorState(PATHS), {
          type: 'selection/set',
          keys: ALL_ANCHORS,
        });

        // The model: an action merges into the step before it only when both
        // carry the same non-null key. A selection change in between is not a
        // step of its own and does not interrupt the run either.
        let last: string | null = null;
        let expected = 0;

        for (const step of steps) {
          if (step.kind === 'select') {
            state = editorReducer(state, { type: 'selection/toggle', keys: ['P1::c1'] });
            continue;
          }
          state = editorReducer(state, {
            type: 'nodes/translate',
            delta: pt(0.5, 0),
            mergeKey: step.key ?? undefined,
          });
          if (step.key === null || step.key !== last) expected++;
          last = step.key;
        }

        expect(state.past).toHaveLength(expected);
      })
    );
  });

  it('caps the stack and still walks back to the oldest surviving step', () => {
    fc.assert(
      fc.property(fc.integer({ min: 101, max: 160 }), (edits) => {
        let state = editorReducer(createEditorState(PATHS), {
          type: 'selection/set',
          keys: ALL_ANCHORS,
        });
        for (let i = 0; i < edits; i++) {
          state = editorReducer(state, {
            type: 'nodes/translate',
            delta: pt(0.5, 0),
            mergeKey: `g${i}`,
          });
        }
        expect(state.past).toHaveLength(100);
        // The oldest step still on the stack is the one 100 edits ago, so
        // undoing everything lands on that state and not on the original.
        state = repeat(state, undo, 100);
        expect(state.doc.paths[0].segments[0].p1.x).toBe((edits - 100) * 0.5);
        expect(canUndo(state)).toBe(false);
      }),
      { numRuns: 10 }
    );
  });
});
