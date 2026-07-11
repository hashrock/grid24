/** @jsxImportSource react */
import type { FC } from 'react';
import { useEffect, useState } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import { Segment, Tool } from './types';

interface EditorProps {
  initialSegments?: Segment[];
  onChange?: (segments: Segment[]) => void;
}

const App: FC<EditorProps> = ({ initialSegments = [], onChange }) => {
  const [segments, setSegments] = useState<Segment[]>(initialSegments);
  const [tool, setTool] = useState<Tool>(Tool.SELECT);
  // Store selected nodes as strings "segmentId-pointType"
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  // Tabler icons are designed on a 24x24 grid with a 2px stroke.
  const gridSize = 24;

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
        />
      </div>

      {/* Sidebar */}
      <div className="z-10 h-full">
        <Toolbar
          currentTool={tool}
          setTool={setTool}
          onClear={() => setSegments([])}
          onImport={(newSegments) => setSegments(newSegments)}
          onAddSegments={(added) => setSegments((prev) => [...prev, ...added])}
          selectedNodeIds={selectedNodeIds}
          segments={segments}
          setSegments={setSegments}
        />
      </div>
    </div>
  );
};

export default App;
