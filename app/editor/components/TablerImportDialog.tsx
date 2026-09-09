/** @jsxImportSource react */
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Path } from "../types";
import { parsePathDataList } from "../../lib/pathImport";
import {
  loadTablerIcons,
  noResultsHint,
  searchTablerIcons,
  type TablerIconEntry,
} from "../../lib/tablerData";

/** Where the picked strokes go: on top of the current drawing, or instead of it. */
export type ImportMode = "append" | "replace";

interface TablerImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Whether the canvas already has strokes (offers 置き換え as well as 追加). */
  hasContent?: boolean;
  /** Called with the chosen icon's paths (freshly generated ids). */
  onPick: (paths: Path[], name: string, mode: ImportMode) => void;
}

/** Small inline preview of a Tabler icon from its raw path `d` strings. */
const IconPreview: FC<{ paths: string[] }> = ({ paths }) => (
  <svg
    viewBox="0 0 24 24"
    width={28}
    height={28}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {paths.map((d, i) => (
      <path key={i} d={d} />
    ))}
  </svg>
);

const TablerImportDialog: FC<TablerImportDialogProps> = ({ open, onClose, hasContent = false, onPick }) => {
  const [icons, setIcons] = useState<TablerIconEntry[] | null>(null);
  const [query, setQuery] = useState("");
  // Tester expectation was "replace what I have"; the code's was "add to it".
  // Both are offered, and the choice is made before picking, where it's visible.
  const [mode, setMode] = useState<ImportMode>("append");
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the dataset lazily the first time the dialog opens.
  useEffect(() => {
    if (!open || icons) return;
    let cancelled = false;
    loadTablerIcons().then((data) => {
      if (!cancelled) setIcons(data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, icons]);

  // Focus the search box on open (and start from a clean query); close on Escape.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMode("append");
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(
    () => (icons ? searchTablerIcons(icons, query) : []),
    [icons, query]
  );

  if (!open) return null;

  const pick = (icon: TablerIconEntry) => {
    onPick(parsePathDataList(icon.p), icon.n, hasContent ? mode : "append");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
          <span className="text-sm font-semibold text-white">Tablerから追加</span>
          <span className="text-xs text-neutral-600">
            {icons ? `${icons.length}アイコン` : "読み込み中…"}
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-neutral-500 hover:text-white"
            title="閉じる (Esc)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex flex-col gap-2 border-b border-neutral-900 p-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="英語で検索 (例: cat, home, arrow) — 猫・家・矢印 など一部の日本語も可"
            className="w-full rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-white focus:outline-none"
          />
          {hasContent && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>選んだアイコンを</span>
              <div role="radiogroup" aria-label="取り込み方" className="flex overflow-hidden rounded border border-neutral-800">
                {(
                  [
                    ["append", "今の絵に重ねて追加"],
                    ["replace", "今の絵と置き換え"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => setMode(value)}
                    className={`px-2.5 py-1 transition-colors ${
                      mode === value
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mode === "replace" && (
                <span className="text-amber-400/80">今の線は消えます（Cmd+Z で戻せます）</span>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {!icons ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-600">
              アイコンを読み込み中…
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm leading-relaxed text-neutral-500">
              {noResultsHint(query)}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {results.map((icon) => (
                <button
                  key={icon.n}
                  onClick={() => pick(icon)}
                  title={icon.n}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-transparent p-2 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900 hover:text-white"
                >
                  <IconPreview paths={icon.p} />
                  <span className="w-full truncate text-center text-[10px] text-neutral-500">
                    {icon.n}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TablerImportDialog;
