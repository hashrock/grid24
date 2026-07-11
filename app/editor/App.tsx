/** @jsxImportSource react */
import type { FC, Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import { Segment, Tool } from './types';

interface EditorProps {
  initialSegments?: Segment[];
  onChange?: (segments: Segment[]) => void;
  /** Fired when a Tabler icon is imported via the search dialog (for credit). */
  onTablerImport?: (name: string) => void;
}

const MAX_HISTORY = 100;

const App: FC<EditorProps> = ({ initialSegments = [], onChange, onTablerImport }) => {
  const [segments, setSegmentsRaw] = useState<Segment[]>(initialSegments);
  const [tool, setTool] = useState<Tool>(Tool.SELECT);
  // Store selected nodes as strings "segmentId-pointType"
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  // Tabler icons are designed on a 24x24 grid with a 2px stroke.
  const gridSize = 24;

  // --- Undo / Redo ---
  // A gesture (drag, pen click, delete, ...) calls beginGesture() before it
  // mutates; the snapshot is only pushed when a setSegments actually follows,
  // so gestures that end up changing nothing don't pollute the history.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const undoStack = useRef<Segment[][]>([]);
  const redoStack = useRef<Segment[][]>([]);
  const pendingSnapshot = useRef<Segment[] | null>(null);

  const beginGesture = useCallback(() => {
    pendingSnapshot.current = segmentsRef.current;
  }, []);

  const setSegments = useCallback<Dispatch<SetStateAction<Segment[]>>>((action) => {
    if (pendingSnapshot.current) {
      undoStack.current.push(pendingSnapshot.current);
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
      pendingSnapshot.current = null;
    }
    setSegmentsRaw(action);
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(segmentsRef.current);
    pendingSnapshot.current = null;
    setSegmentsRaw(prev);
  }, []);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(segmentsRef.current);
    pendingSnapshot.current = null;
    setSegmentsRaw(next);
  }, []);

  // Notify the parent (Edit page) so it can debounce-save to the server.
  useEffect(() => {
    onChange?.(segments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  return (
    <div className="flex w-full h-full bg-black overflow-hidden">
      {/* Main Canvas Area */}
      <div className="flex-1 h-full relative">
        <Canvas
          segments={segments}
          setSegments={setSegments}
          tool={tool}
          gridSize={gridSize}
          selectedNodeIds={selectedNodeIds}
          setSelectedNodeIds={setSelectedNodeIds}
          beginGesture={beginGesture}
          undo={undo}
          redo={redo}
        />
      </div>

      {/* Sidebar */}
      <div className="z-10 h-full">
        <Toolbar
          currentTool={tool}
          setTool={setTool}
          onClear={() => { beginGesture(); setSegments([]); }}
          onImport={(newSegments) => { beginGesture(); setSegments(newSegments); }}
          onAddSegments={(added) => { beginGesture(); setSegments((prev) => [...prev, ...added]); }}
          onTablerImport={(name) => onTablerImport?.(name)}
          selectedNodeIds={selectedNodeIds}
          segments={segments}
          setSegments={setSegments}
          beginGesture={beginGesture}
        />
      </div>
    </div>
  );
};

export default App;
