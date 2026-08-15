import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createEditorState, editorReducer } from './history';
import type { EditorAction, EditorState } from './types';
import { polyline, pt } from './testFixtures';

const PATHS = [polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0)])];

const run = (state: EditorState, ...actions: EditorAction[]): EditorState =>
  actions.reduce(editorReducer, state);

/** Select an anchor, then nudge it `times` times under one gesture key. */
const drag = (state: EditorState, mergeKey: string, times = 1): EditorState =>
  run(
    state,
    ...Array.from({ length: times }, () => ({
      type: 'nodes/translate' as const,
      delta: pt(1, 0),
      mergeKey,
    }))
  );

const x = (state: EditorState) => state.doc.paths[0].segments[0].p1.x;

describe('editorReducer history', () => {
  const selected = () => run(createEditorState(PATHS), { type: 'selection/set', keys: ['P1::p1'] });

  it('collapses one gesture into a single undo step', () => {
    const state = drag(selected(), 'gesture-1', 5);
    expect(x(state)).toBe(5);
    expect(state.past).toHaveLength(1);
    expect(x(editorReducer(state, { type: 'history/undo' }))).toBe(0);
  });

  it('keeps separate gestures as separate steps', () => {
    const state = drag(drag(selected(), 'g1'), 'g2');
    expect(state.past).toHaveLength(2);
  });

  it('does not merge unkeyed actions with each other', () => {
    const state = run(
      selected(),
      { type: 'nodes/translate', delta: pt(1, 0) },
      { type: 'nodes/translate', delta: pt(1, 0) }
    );
    expect(state.past).toHaveLength(2);
  });

  it('restores the selection that was active before the edit', () => {
    const state = run(
      selected(),
      { type: 'nodes/translate', delta: pt(1, 0), mergeKey: 'g1' },
      { type: 'selection/set', keys: ['P2::p2'] },
      { type: 'history/undo' }
    );
    expect([...state.doc.selection]).toEqual(['P1::p1']);
  });

  it('does not record selection changes on their own', () => {
    const state = run(
      selected(),
      { type: 'selection/toggle', keys: ['P2::p2'] },
      { type: 'selection/clear' }
    );
    expect(state.past).toHaveLength(0);
    expect(canUndo(state)).toBe(false);
  });

  it('does not record an edit that changed nothing', () => {
    const before = selected();
    const after = editorReducer(before, { type: 'nodes/translate', delta: pt(0, 0), mergeKey: 'g' });
    expect(after).toBe(before);
    expect(after.past).toHaveLength(0);
  });

  it('redoes an undone step', () => {
    let state = drag(selected(), 'g1', 3);
    state = editorReducer(state, { type: 'history/undo' });
    expect(canRedo(state)).toBe(true);
    state = editorReducer(state, { type: 'history/redo' });
    expect(x(state)).toBe(3);
    expect(canRedo(state)).toBe(false);
  });

  it('drops the redo stack once a new edit lands', () => {
    let state = drag(selected(), 'g1');
    state = editorReducer(state, { type: 'history/undo' });
    state = drag(state, 'g2');
    expect(state.future).toHaveLength(0);
  });

  it('does not merge across an undo, even under the same gesture key', () => {
    let state = drag(selected(), 'g1');
    state = editorReducer(state, { type: 'history/undo' });
    state = drag(state, 'g1');
    expect(state.past).toHaveLength(1);
    expect(x(state)).toBe(1);
  });

  it('walks the whole stack back and forward', () => {
    let state = selected();
    for (let i = 0; i < 5; i++) state = drag(state, `g${i}`);
    expect(x(state)).toBe(5);
    for (let i = 0; i < 5; i++) state = editorReducer(state, { type: 'history/undo' });
    expect(x(state)).toBe(0);
    for (let i = 0; i < 5; i++) state = editorReducer(state, { type: 'history/redo' });
    expect(x(state)).toBe(5);
  });

  it('is a no-op at either end of the stack', () => {
    const fresh = createEditorState(PATHS);
    expect(editorReducer(fresh, { type: 'history/undo' })).toBe(fresh);
    expect(editorReducer(fresh, { type: 'history/redo' })).toBe(fresh);
    expect(canUndo(fresh)).toBe(false);
    expect(canRedo(fresh)).toBe(false);
  });

  it('caps the stack, dropping the oldest steps', () => {
    let state = selected();
    for (let i = 0; i < 150; i++) state = drag(state, `g${i}`);
    expect(state.past).toHaveLength(100);
    // The oldest surviving step is the 50th, not the original.
    for (let i = 0; i < 100; i++) state = editorReducer(state, { type: 'history/undo' });
    expect(x(state)).toBe(50);
  });

  it('starts from the paths it is given, with nothing selected', () => {
    const state = createEditorState(PATHS);
    expect(state.doc.paths).toBe(PATHS);
    expect(state.doc.selection.size).toBe(0);
  });
});
