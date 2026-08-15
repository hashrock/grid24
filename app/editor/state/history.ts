import type { Segment } from '../types';
import { EMPTY_SELECTION } from './geometry';
import { docReducer } from './reducer';
import type { DocAction, EditorAction, EditorState } from './types';

const MAX_HISTORY = 100;

/**
 * Which actions are worth an undo step. Selection changes are not: they ride
 * along with whatever edit follows, and undo restores the selection that was
 * active when the edit happened.
 *
 * This is an exhaustive Record on purpose — a new DocAction won't compile until
 * it is classified here, so no edit can silently escape the history.
 */
const HISTORIC: Record<DocAction['type'], boolean> = {
  'segments/replace': true,
  'segments/append': true,
  'nodes/translate': true,
  'nodes/scale': true,
  'nodes/delete': true,
  'anchor/toggleSmooth': true,
  'path/toggleClosed': true,
  'path/reverse': true,
  'segment/split': true,
  'segment/erase': true,
  'pen/commit': true,
  'pen/join': true,
  'pen/dragHandle': true,
  'selection/set': false,
  'selection/toggle': false,
  'selection/path': false,
  'selection/box': false,
  'selection/clear': false,
};

export const createEditorState = (segments: Segment[]): EditorState => ({
  doc: { segments, selection: EMPTY_SELECTION },
  past: [],
  future: [],
  lastMergeKey: null,
});

/**
 * `docReducer` plus undo/redo. History is recorded here and nowhere else, so
 * there is no "remember to snapshot before you mutate" contract to forget.
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'history/undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        doc: prev,
        past: state.past.slice(0, -1),
        future: [...state.future, state.doc],
        lastMergeKey: null,
      };
    }
    case 'history/redo': {
      const next = state.future[state.future.length - 1];
      if (!next) return state;
      return {
        doc: next,
        past: [...state.past, state.doc],
        future: state.future.slice(0, -1),
        lastMergeKey: null,
      };
    }
  }

  const doc = docReducer(state.doc, action);
  if (doc === state.doc) return state;
  if (!HISTORIC[action.type]) return { ...state, doc };

  // A run of actions sharing one gesture's key collapses into a single step.
  const merge = action.mergeKey != null && action.mergeKey === state.lastMergeKey;
  return {
    doc,
    past: merge ? state.past : [...state.past, state.doc].slice(-MAX_HISTORY),
    future: [],
    lastMergeKey: action.mergeKey ?? null,
  };
}

export const canUndo = (state: EditorState): boolean => state.past.length > 0;
export const canRedo = (state: EditorState): boolean => state.future.length > 0;
