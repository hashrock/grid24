/** @jsxImportSource react */
import type { FC, Dispatch, SetStateAction, ReactNode } from 'react';
import { useState } from 'react';
import { Tool, Segment } from '../types';
import { generateIconPath } from '../services/geminiService';
import { parsePathData } from '../utils/bezierHelper';

interface ToolbarProps {
  currentTool: Tool;
  setTool: (t: Tool) => void;
  onClear: () => void;
  onImport: (segments: Segment[]) => void;
  selectedNodeIds: Set<string>;
  segments: Segment[];
  setSegments: Dispatch<SetStateAction<Segment[]>>;
}

const Toolbar: FC<ToolbarProps> = ({ currentTool, setTool, onClear, onImport, selectedNodeIds, segments, setSegments }) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const hasApiKey = !!(import.meta as any).env?.VITE_API_KEY;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    const pathData = await generateIconPath(prompt);
    setIsGenerating(false);

    if (pathData) {
      const newSegments = parsePathData(pathData);
      onImport(newSegments);
    }
  };

  const toggleSmooth = () => {
    if (selectedNodeIds.size === 0) return;

    setSegments(prev => {
        let updated = [...prev];
        const segmentsToSmooth = new Set<string>();

        selectedNodeIds.forEach(key => {
            const parts = key.split('::');
            if (parts.length === 2) {
                const segId = parts[0];
                const type = parts[1];
                if (type === 'p2') {
                    segmentsToSmooth.add(segId);
                } else if (type === 'p1') {
                    const seg = prev.find(s => s.id === segId);
                    if (seg) {
                        const prevSeg = prev.find(s => Math.hypot(s.p2.x - seg.p1.x, s.p2.y - seg.p1.y) < 0.001);
                        if (prevSeg) segmentsToSmooth.add(prevSeg.id);
                    }
                }
            }
        });

        let targetState = true;
        const firstId = Array.from(segmentsToSmooth)[0];
        if (firstId) {
             const s = prev.find(i => i.id === firstId);
             if (s) targetState = !s.isSmoothP2;
        }

        updated = updated.map(seg => {
            if (segmentsToSmooth.has(seg.id)) {
                return { ...seg, isSmoothP2: targetState };
            }
            return seg;
        });

        if (targetState) {
            segmentsToSmooth.forEach(segId => {
                 const seg = updated.find(s => s.id === segId);
                 if (!seg) return;

                 const next = updated.find(s => Math.hypot(s.p1.x - seg.p2.x, s.p1.y - seg.p2.y) < 0.001);
                 if (next) {
                     const anchor = seg.p2;
                     const mirror = {
                         x: anchor.x - (seg.c2.x - anchor.x),
                         y: anchor.y - (seg.c2.y - anchor.y)
                     };
                     updated = updated.map(u => u.id === next.id ? { ...u, c1: mirror } : u);
                 }
            });
        }

        return updated;
    });
  };

  const toggleClosed = () => {
    if (selectedNodeIds.size === 0) return;

    // Identify pathIds from selection
    const selectedPathIds = new Set<string>();
    selectedNodeIds.forEach(key => {
        const segId = key.split('::')[0];
        const seg = segments.find(s => s.id === segId);
        if (seg) selectedPathIds.add(seg.pathId);
    });

    if (selectedPathIds.size === 0) return;

    setSegments(prev => {
        let updated = [...prev];
        const pathsToToggle = Array.from(selectedPathIds);

        pathsToToggle.forEach(pid => {
            const pathSegs = updated.filter(s => s.pathId === pid);
            if (pathSegs.length === 0) return;

            // Determine new state (toggle based on first segment)
            const newState = !pathSegs[0].isClosed;

            // Update state
            updated = updated.map(s => s.pathId === pid ? { ...s, isClosed: newState } : s);

            if (newState) {
                // Closing: Snap last p2 to first p1
                // We rely on array order for now. Not robust but fits MVP.
                const first = pathSegs[0];
                const last = pathSegs[pathSegs.length - 1];

                updated = updated.map(s => {
                    if (s.id === last.id) {
                        return { ...s, p2: { ...first.p1 } };
                    }
                    return s;
                });
            }
        });
        return updated;
    });
  };

  const hasSelection = selectedNodeIds.size > 0;
  let isSmooth = false;
  let isClosed = false;

  if (hasSelection) {
      const firstKey = Array.from(selectedNodeIds)[0] as string;
      const parts = firstKey.split('::');
      if (parts.length === 2) {
          const segId = parts[0];
          const type = parts[1];
          const s = segments.find(i => i.id === segId);
          if (s) {
              isClosed = !!s.isClosed;
              if (type === 'p2') isSmooth = !!s.isSmoothP2;
              else if (type === 'p1') {
                   const prev = segments.find(p => Math.hypot(p.p2.x - s.p1.x, p.p2.y - s.p1.y) < 0.001);
                   if (prev) isSmooth = !!prev.isSmoothP2;
              }
          }
      }
  }

  const ToolButton = ({ tool, label, icon }: { tool: Tool, label: string, icon: ReactNode }) => (
    <button
      onClick={() => setTool(tool)}
      className={`p-3 rounded-lg flex flex-col items-center gap-1 transition-all border ${
        currentTool === tool
          ? 'bg-neutral-900 border-white text-white'
          : 'bg-black border-transparent text-neutral-500 hover:text-white hover:border-neutral-800'
      }`}
      title={label}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );

  return (
    <div className="w-80 h-full bg-black border-l border-neutral-900 flex flex-col p-6 gap-8 overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold font-mono text-white mb-2">Luma<span className="text-neutral-600">.svg</span></h1>
        <p className="text-xs text-neutral-500">Vector Bezier Editor</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ToolButton
          tool={Tool.SELECT}
          label="Select"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>}
        />
        <ToolButton
          tool={Tool.PEN}
          label="Pen"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>}
        />
        <ToolButton
          tool={Tool.SPLIT}
          label="Split"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>}
        />
        <ToolButton
            tool={Tool.ERASER}
            label="Erase"
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>}
        />
      </div>

      <div className="h-px bg-neutral-900 w-full" />

      {hasSelection && (
          <div className="flex flex-col gap-2 p-3 bg-neutral-900 rounded border border-neutral-800">
             <h3 className="text-xs font-bold text-neutral-400 uppercase">Selection</h3>

             {/* Node Options */}
             <div className="flex flex-col gap-1">
                 <label className="text-[10px] text-neutral-600 font-bold uppercase">Node Type</label>
                 <button
                    onClick={toggleSmooth}
                    className="flex items-center justify-between w-full py-2 px-3 bg-black border border-neutral-700 rounded hover:border-white transition-colors"
                 >
                     <span className="text-xs text-white">{isSmooth ? "Smooth" : "Corner"}</span>
                     <div className={`w-3 h-3 rounded-full border border-neutral-500 ${isSmooth ? "bg-white" : "bg-black"}`} />
                 </button>
             </div>

             {/* Path Options */}
             <div className="flex flex-col gap-1 mt-2">
                 <label className="text-[10px] text-neutral-600 font-bold uppercase">Path Type</label>
                 <button
                    onClick={toggleClosed}
                    className="flex items-center justify-between w-full py-2 px-3 bg-black border border-neutral-700 rounded hover:border-white transition-colors"
                 >
                     <span className="text-xs text-white">{isClosed ? "Closed" : "Open"}</span>
                     <div className={`w-3 h-3 border border-neutral-500 ${isClosed ? "bg-white" : "bg-black"}`} />
                 </button>
             </div>

          </div>
      )}

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-neutral-400">AI Generation</h3>
        <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. coffee cup, lightning bolt, simple house..."
            className="w-full h-24 bg-neutral-950 border border-neutral-900 rounded-md p-3 text-sm text-white resize-none focus:outline-none focus:border-white transition-colors"
        />
        <button
            onClick={handleGenerate}
            disabled={isGenerating || !hasApiKey}
            className={`w-full py-2 px-4 rounded-md font-medium text-sm transition-colors border ${
                isGenerating
                ? 'bg-neutral-900 border-neutral-800 text-neutral-600 cursor-not-allowed'
                : 'bg-white text-black border-white hover:bg-neutral-200'
            }`}
        >
            {isGenerating ? 'Generating...' : 'Generate Icon'}
        </button>
        {!hasApiKey && (
             <p className="text-[10px] text-neutral-600">API Key missing. AI Disabled.</p>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2">
         <button onClick={onClear} className="w-full py-2 border border-neutral-800 rounded text-xs text-neutral-500 hover:text-white hover:border-white transition-colors">Clear Canvas</button>
      </div>

      <div className="text-[10px] text-neutral-700 font-mono text-center">
        Grid: 24x24px · Stroke 2px
      </div>
    </div>
  );
};

export default Toolbar;
