/** @jsxImportSource react */
import type { FC, Dispatch, SetStateAction, ReactNode } from 'react';
import { useState } from 'react';
import { DEFAULT_RENDER_STYLE, Tool, Segment } from '../types';
import type { RenderStyle } from '../types';
import { parsePathData } from '../utils/bezierHelper';
import { IconSvg } from '../../lib/IconSvg';
import { AI_GENERATION_ENABLED } from '../../lib/featureFlags';
import TablerImportDialog from './TablerImportDialog';
import { incomingAt, parseNodeKey } from '../state';
import type { EditorAction, NodeKey } from '../state';

interface ToolbarProps {
  currentTool: Tool;
  setTool: (t: Tool) => void;
  /** Record that a Tabler icon (by name) was imported, for attribution. */
  onTablerImport?: (name: string) => void;
  segments: Segment[];
  selection: ReadonlySet<NodeKey>;
  dispatch: Dispatch<EditorAction>;
  /** Stroke rendering preview settings (width / cap / join). */
  renderStyle: RenderStyle;
  setRenderStyle: Dispatch<SetStateAction<RenderStyle>>;
}

const CAPS: RenderStyle['strokeLinecap'][] = ['butt', 'round', 'square'];
const JOINS: RenderStyle['strokeLinejoin'][] = ['miter', 'round', 'bevel'];
const PREVIEW_SIZES = [16, 24, 48];

const Toolbar: FC<ToolbarProps> = ({ currentTool, setTool, onTablerImport, segments, selection, dispatch, renderStyle, setRenderStyle }) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [tablerOpen, setTablerOpen] = useState(false);

  const hasApiKey = !!(import.meta as any).env?.VITE_API_KEY;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    // フラグが立っているときだけ Gemini SDK を読み込む（既定ではバンドルに含めない）
    const { generateIconPath } = await import('../services/geminiService');
    const pathData = await generateIconPath(prompt);
    setIsGenerating(false);

    if (pathData) {
      dispatch({ type: 'segments/replace', segments: parsePathData(pathData) });
    }
  };

  // Whether the first selected node reads as smooth / closed — the buttons show
  // one state for the whole selection and toggle it as a group.
  const hasSelection = selection.size > 0;
  let isSmooth = false;
  let isClosed = false;

  if (hasSelection) {
      const parsed = parseNodeKey(selection.values().next().value as NodeKey);
      const s = parsed && segments.find(i => i.id === parsed.segmentId);
      if (parsed && s) {
          isClosed = !!s.isClosed;
          if (parsed.type === 'p2') isSmooth = !!s.isSmoothP2;
          else if (parsed.type === 'p1') isSmooth = !!incomingAt(segments, s.p1)?.isSmoothP2;
      }
  }

  const OptionRow = ({ label, options, value, onPick }: {
    label: string;
    options: readonly string[];
    value: string;
    onPick: (v: string) => void;
  }) => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold uppercase text-neutral-600">{label}</label>
      <div className="flex gap-1">
        {options.map(opt => (
          <button
            key={opt}
            onClick={() => onPick(opt)}
            className={`flex-1 rounded border py-1.5 text-[11px] capitalize transition-colors ${
              value === opt
                ? 'border-white bg-neutral-900 text-white'
                : 'border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-white'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );

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
        <h1 className="text-2xl font-bold font-mono text-white mb-2">grid<span className="text-neutral-600">24</span></h1>
        <p className="text-xs text-neutral-500">24×24 stroke icon editor</p>
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
                    onClick={() => dispatch({ type: 'anchor/toggleSmooth' })}
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
                    onClick={() => dispatch({ type: 'path/toggleClosed' })}
                    className="flex items-center justify-between w-full py-2 px-3 bg-black border border-neutral-700 rounded hover:border-white transition-colors"
                 >
                     <span className="text-xs text-white">{isClosed ? "Closed" : "Open"}</span>
                     <div className={`w-3 h-3 border border-neutral-500 ${isClosed ? "bg-white" : "bg-black"}`} />
                 </button>
             </div>

          </div>
      )}

      {/* Stroke rendering — preview only, never changes the saved geometry. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-400">Stroke</h3>
          <button
            onClick={() => setRenderStyle(DEFAULT_RENDER_STYLE)}
            className="text-[10px] font-bold uppercase text-neutral-600 hover:text-white"
            title="既定 (2 / round / round) に戻す"
          >
            Reset
          </button>
        </div>

        <div className="flex items-end justify-center gap-5 rounded border border-neutral-900 bg-neutral-950 py-4 text-white">
          {PREVIEW_SIZES.map(size => (
            <div key={size} className="flex flex-col items-center gap-2">
              <IconSvg
                segments={segments}
                size={size}
                strokeWidth={renderStyle.strokeWidth}
                strokeLinecap={renderStyle.strokeLinecap}
                strokeLinejoin={renderStyle.strokeLinejoin}
              />
              <span className="font-mono text-[10px] text-neutral-600">{size}px</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase text-neutral-600">Width</label>
            <span className="font-mono text-xs text-white">{renderStyle.strokeWidth.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.25}
            value={renderStyle.strokeWidth}
            onChange={(e) => setRenderStyle(prev => ({ ...prev, strokeWidth: Number(e.target.value) }))}
            className="w-full accent-white"
          />
        </div>

        <OptionRow
          label="Cap"
          options={CAPS}
          value={renderStyle.strokeLinecap}
          onPick={(v) => setRenderStyle(prev => ({ ...prev, strokeLinecap: v as RenderStyle['strokeLinecap'] }))}
        />
        <OptionRow
          label="Join (corner)"
          options={JOINS}
          value={renderStyle.strokeLinejoin}
          onPick={(v) => setRenderStyle(prev => ({ ...prev, strokeLinejoin: v as RenderStyle['strokeLinejoin'] }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-neutral-400">Tabler Icons</h3>
        <button
          onClick={() => setTablerOpen(true)}
          className="flex items-center justify-center gap-2 w-full py-2 px-4 rounded-md border border-neutral-800 text-sm text-neutral-300 hover:border-white hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3 -4.3" /></svg>
          検索して追加
        </button>
        <p className="text-[10px] text-neutral-600">選んだアイコンを今のキャンバスに追加します。</p>
      </div>

      {AI_GENERATION_ENABLED && (
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
      )}

      <div className="mt-auto flex flex-col gap-2">
         <button
            onClick={() => dispatch({ type: 'segments/replace', segments: [] })}
            className="w-full py-2 border border-neutral-800 rounded text-xs text-neutral-500 hover:text-white hover:border-white transition-colors"
         >
            Clear Canvas
         </button>
      </div>

      <div className="text-[10px] text-neutral-700 font-mono text-center">
        Grid: 24x24px · Stroke {renderStyle.strokeWidth}px
      </div>

      <TablerImportDialog
        open={tablerOpen}
        onClose={() => setTablerOpen(false)}
        onPick={(segs, name) => {
          dispatch({ type: 'segments/append', segments: segs });
          onTablerImport?.(name);
        }}
      />
    </div>
  );
};

export default Toolbar;
