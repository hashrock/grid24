import { Head, Link } from "@inertiajs/react";
import { useCallback, useRef, useState } from "react";
import Editor from "../../editor/App";
import type { Segment } from "../../editor/types";
import { parseContent } from "../../lib/svg";
import type { SessionUser } from "../../user";

type IconData = {
  id: string;
  name: string;
  content: string;
  isPublic: boolean;
  /** JSON array of Tabler icon names this icon derives from, or null. */
  tablerSources: string | null;
};

/** Tolerant parse of the stored tablerSources JSON into a string[]. */
function parseSources(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type SaveStatus = "saved" | "saving" | "dirty";

export default function IconsEdit({
  user,
  icon,
}: {
  user: SessionUser;
  icon: IconData;
}) {
  const [name, setName] = useState(icon.name);
  const [isPublic, setIsPublic] = useState(icon.isPublic);
  const [status, setStatus] = useState<SaveStatus>("saved");

  const initialSegments = parseContent(icon.content);
  const segmentsRef = useRef<Segment[]>(initialSegments);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tabler icons this drawing was built from — persisted for public attribution.
  const sourcesRef = useRef<Set<string>>(new Set(parseSources(icon.tablerSources)));

  const persist = useCallback(
    async (patch: {
      name?: string;
      content?: string;
      isPublic?: boolean;
      tablerSources?: string[];
    }) => {
      setStatus("saving");
      try {
        await fetch(`/api/icons/${icon.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        setStatus("saved");
      } catch {
        setStatus("dirty");
      }
    },
    [icon.id]
  );

  // Debounced save of the vector content as the user edits.
  const scheduleSave = useCallback(() => {
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      persist({ content: JSON.stringify(segmentsRef.current) });
    }, 800);
  }, [persist]);

  const onSegmentsChange = useCallback(
    (segments: Segment[]) => {
      // Skip the initial mount echo (identical reference to what we loaded).
      if (segments === initialSegments) return;
      segmentsRef.current = segments;
      scheduleSave();
    },
    [initialSegments, scheduleSave]
  );

  const onTablerImport = useCallback(
    (tablerName: string) => {
      if (sourcesRef.current.has(tablerName)) return;
      sourcesRef.current.add(tablerName);
      persist({ tablerSources: [...sourcesRef.current] });
    },
    [persist]
  );

  const onNameBlur = () => {
    if (name !== icon.name) persist({ name });
  };

  const togglePublic = () => {
    const next = !isPublic;
    setIsPublic(next);
    persist({ isPublic: next });
  };

  const statusLabel =
    status === "saved" ? "保存済み" : status === "saving" ? "保存中…" : "未保存";

  return (
    <div className="flex h-screen flex-col bg-neutral-950">
      <Head title={`${name} — 編集`} />
      <header className="flex items-center gap-4 border-b border-neutral-800 px-4 py-2">
        <Link href="/icons" className="text-neutral-400 hover:text-white" title="一覧へ">
          ←
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onNameBlur}
          className="w-56 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-neutral-700 focus:border-white focus:outline-none"
          placeholder="アイコン名"
        />
        <span className="text-xs text-neutral-500">{statusLabel}</span>

        <div className="ml-auto flex items-center gap-3">
          {isPublic && (
            <Link
              href={`/i/${icon.id}`}
              className="text-xs text-neutral-400 underline hover:text-white"
            >
              公開ページ
            </Link>
          )}
          <button
            onClick={togglePublic}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              isPublic
                ? "border-green-600 bg-green-600/10 text-green-400"
                : "border-neutral-700 text-neutral-300 hover:border-white"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isPublic ? "bg-green-400" : "bg-neutral-600"
              }`}
            />
            {isPublic ? "公開中" : "非公開"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <Editor
          initialSegments={initialSegments}
          onChange={onSegmentsChange}
          onTablerImport={onTablerImport}
        />
      </div>
    </div>
  );
}
