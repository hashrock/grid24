import { describe, expect, it } from 'vitest';
import { parsePathData } from '../../lib/pathImport';
import { parseContent, pathsToD, serializeContent } from '../../lib/svg';
import { createEditorState, editorReducer } from './history';
import { pointKey } from './geometry';
import { openEndpoints } from './selectors';
import type { EditorAction, EditorState } from './types';

/**
 * End-to-end through the real pipeline: import an SVG path, edit it via the
 * same actions the Canvas dispatches, and save it back. Uses Tabler's `star`,
 * the shape this editor is built around.
 */
const STAR =
  'M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z';

const run = (state: EditorState, ...actions: EditorAction[]): EditorState =>
  actions.reduce(editorReducer, state);

const load = () => createEditorState(parsePathData(STAR));

const segIds = (state: EditorState) => state.doc.paths.flatMap((p) => p.segments.map((s) => s.id));

describe('editing an imported icon', () => {
  it('imports as one closed path of ten segments', () => {
    const state = load();
    expect(state.doc.paths).toHaveLength(1);
    expect(state.doc.paths[0].closed).toBe(true);
    expect(state.doc.paths[0].segments).toHaveLength(10);
  });

  it('a closed path offers no free endpoint for the pen to continue from', () => {
    expect(openEndpoints(load().doc.paths)).toEqual([]);
  });

  it('clicking the stroke selects every anchor of the path', () => {
    const state = load();
    const pathId = state.doc.paths[0].id;
    const selected = run(state, { type: 'selection/path', pathId, additive: false });
    expect(selected.doc.selection.size).toBe(20); // 10 segments x p1 + p2
    expect(selected.past).toHaveLength(0); // selection alone is not undoable
  });

  it('drags the whole path as one gesture and undoes it in one step', () => {
    const state = load();
    const pathId = state.doc.paths[0].id;
    const before = pathsToD(state.doc.paths);

    let next = run(state, { type: 'selection/path', pathId, additive: false });
    for (let i = 0; i < 8; i++) {
      next = editorReducer(next, { type: 'nodes/translate', delta: { x: 0.5, y: 0 }, mergeKey: 'drag' });
    }
    expect(next.doc.paths[0].segments[0].p1.x).toBeCloseTo(12 + 4);
    expect(next.past).toHaveLength(1);

    const undone = editorReducer(next, { type: 'history/undo' });
    expect(pathsToD(undone.doc.paths)).toEqual(before);
    // The selection that was live before the drag comes back with it.
    expect(undone.doc.selection.size).toBe(20);
  });

  it('splitting an edge adds an anchor without moving the outline', () => {
    const state = load();
    const target = state.doc.paths[0].segments[0];
    const next = editorReducer(state, {
      type: 'segment/split',
      segmentId: target.id,
      t: 0.5,
      ids: ['left', 'right'],
      mergeKey: 'g',
    });
    expect(next.doc.paths[0].segments).toHaveLength(11);
    expect(segIds(next).slice(0, 2)).toEqual(['left', 'right']);
    // Splitting a straight edge in half leaves the geometry alone.
    expect(pathsToD(next.doc.paths)[0]).toContain('M 12 17.75');
    expect(next.doc.paths[0].closed).toBe(true);
  });

  it('erasing a middle segment opens the loop instead of leaving a phantom line', () => {
    const state = load();
    const victim = state.doc.paths[0].segments[3];
    const next = editorReducer(state, { type: 'segment/erase', segmentId: victim.id, mergeKey: 'g' });
    // One open chain, rotated to start after the hole — not two paths, and not
    // a closed path that would draw a line across the gap.
    expect(next.doc.paths).toHaveLength(1);
    expect(next.doc.paths[0].closed).toBe(false);
    expect(next.doc.paths[0].segments).toHaveLength(9);
    expect(pathsToD(next.doc.paths)[0]).not.toMatch(/ Z$/);
  });

  it('erasing then undoing restores the original outline exactly', () => {
    const state = load();
    const before = serializeContent(state.doc.paths);
    const next = run(
      state,
      { type: 'segment/erase', segmentId: state.doc.paths[0].segments[3].id, mergeKey: 'g' },
      { type: 'history/undo' }
    );
    expect(serializeContent(next.doc.paths)).toBe(before);
  });

  it('drawing a new path with the pen leaves the imported one untouched', () => {
    const state = load();
    const original = state.doc.paths[0];
    const next = run(
      state,
      { type: 'pen/commit', id: 's1', pathId: 'new', from: { x: 2, y: 2 }, control: { x: 2, y: 2 }, to: { x: 6, y: 2 }, closing: false, mergeKey: 'g1' },
      { type: 'pen/commit', id: 's2', pathId: 'new', from: { x: 6, y: 2 }, control: { x: 6, y: 2 }, to: { x: 6, y: 6 }, closing: false, mergeKey: 'g2' }
    );
    expect(next.doc.paths).toHaveLength(2);
    expect(next.doc.paths[0]).toBe(original);
    expect(next.doc.paths[1].segments.map((s) => s.id)).toEqual(['s1', 's2']);
    // Two clicks, two undo steps.
    expect(next.past).toHaveLength(2);
    expect([...next.doc.selection]).toEqual([pointKey('s2', 'p2')]);
  });

  it('survives a save/load round trip after editing', () => {
    const state = load();
    const edited = run(
      state,
      { type: 'selection/path', pathId: state.doc.paths[0].id, additive: false },
      { type: 'nodes/translate', delta: { x: 1, y: -1 }, mergeKey: 'g' },
      { type: 'pen/commit', id: 's1', pathId: 'new', from: { x: 2, y: 2 }, control: { x: 2, y: 2 }, to: { x: 6, y: 2 }, closing: false, mergeKey: 'g2' }
    );
    const reloaded = parseContent(serializeContent(edited.doc.paths));
    expect(pathsToD(reloaded)).toEqual(pathsToD(edited.doc.paths));
    expect(reloaded.map((p) => p.closed)).toEqual([true, false]);
  });
});
