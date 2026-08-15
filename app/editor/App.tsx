/** @jsxImportSource react */
import type { FC } from 'react';
import { useEffect, useReducer, useRef, useState } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import { DEFAULT_RENDER_STYLE, Path, Tool } from './types';
import type { RenderStyle } from './types';
import { createEditorState, editorReducer } from './state';

interface EditorProps {
  initialPaths?: Path[];
  onChange?: (paths: Path[]) => void;
  /** Fired when a Tabler icon is imported via the search dialog (for credit). */
  onTablerImport?: (name: string) => void;
}

// Render style is a per-user viewing preference, not icon data — it lives in
// localStorage so it carries across icons and reloads.
const RENDER_STYLE_KEY = 'grid24:renderStyle';

const readStoredRenderStyle = (): RenderStyle | null => {
  try {
    const raw = window.localStorage.getItem(RENDER_STYLE_KEY);
    if (!raw) return null;
    return { ...DEFAULT_RENDER_STYLE, ...JSON.parse(raw) };
  } catch {
    return null;
  }
};

const App: FC<EditorProps> = ({ initialPaths = [], onChange, onTablerImport }) => {
  // Segments, selection and undo/redo all live in one reducer: every edit is an
  // action, and history is recorded by the reducer rather than by each caller.
  const [state, dispatch] = useReducer(editorReducer, initialPaths, createEditorState);
  const { paths, selection } = state.doc;

  // Node editing is the default: this is a 24x24 icon editor, so most work is
  // nudging anchors rather than moving whole shapes around.
  const [tool, setTool] = useState<Tool>(Tool.DIRECT);
  // Tabler icons are designed on a 24x24 grid with a 2px stroke.
  const gridSize = 24;

  // Stroke rendering (width / cap / join). Starts at the default so SSR and
  // the first client render agree; the stored value is applied after mount.
  const [renderStyle, setRenderStyle] = useState<RenderStyle>(DEFAULT_RENDER_STYLE);
  const renderStyleLoaded = useRef(false);

  useEffect(() => {
    const stored = readStoredRenderStyle();
    if (stored) setRenderStyle(stored);
    renderStyleLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!renderStyleLoaded.current) return;
    try {
      window.localStorage.setItem(RENDER_STYLE_KEY, JSON.stringify(renderStyle));
    } catch {
      // Private mode / storage full — the setting just won't persist.
    }
  }, [renderStyle]);

  // Notify the parent (Edit page) so it can debounce-save to the server.
  // Selection-only changes don't touch `paths`, so they never trigger a save.
  useEffect(() => {
    onChange?.(paths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  return (
    <div className="flex w-full h-full bg-black overflow-hidden">
      {/* Main Canvas Area */}
      <div className="flex-1 h-full relative">
        <Canvas
          paths={paths}
          selection={selection}
          dispatch={dispatch}
          tool={tool}
          gridSize={gridSize}
          renderStyle={renderStyle}
        />
      </div>

      {/* Sidebar */}
      <div className="z-10 h-full">
        <Toolbar
          currentTool={tool}
          setTool={setTool}
          paths={paths}
          selection={selection}
          dispatch={dispatch}
          onTablerImport={onTablerImport}
          renderStyle={renderStyle}
          setRenderStyle={setRenderStyle}
        />
      </div>
    </div>
  );
};

export default App;
