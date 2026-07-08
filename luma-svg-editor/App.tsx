import React, { useState } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import { Segment, Tool, SelectedPoint } from './types';

const App: React.FC = () => {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [tool, setTool] = useState<Tool>(Tool.SELECT);
  // Store selected nodes as strings "segmentId-pointType"
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const gridSize = 32;

  return (
    <div className="flex w-screen h-screen bg-black overflow-hidden">
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
          selectedNodeIds={selectedNodeIds}
          segments={segments}
          setSegments={setSegments}
        />
      </div>
    </div>
  );
};

export default App;