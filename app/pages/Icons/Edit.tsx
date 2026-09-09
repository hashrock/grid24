import { Head, Link } from "@inertiajs/react";
import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "../../editor/App";
import type { Path } from "../../editor/types";
import {
  describeSaveFailure,
  hasUnsavedWork,
  saveStatusLabel,
  type SaveStatus,
} from "../../lib/saveStatus";
import { parseContent, serializeContent } from "../../lib/svg";
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

type Patch = {
  name?: string;
  content?: string;
  isPublic?: boolean;
  tablerSources?: string[];
};

export default function IconsEdit({
  user,
  icon,
}: {
  user: SessionUser;
  icon: IconData;
}) {
  const [name, setName] = useState(icon.name);
  const [isPublic, setIsPublic] = useState(icon.isPublic);
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved" });

  const initialPaths = parseContent(icon.content);
  const pathsRef = useRef<Path[]>(initialPaths);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tabler icons this drawing was built from — persisted for public attribution.
  const sourcesRef = useRef<Set<string>>(new Set(parseSources(icon.tablerSources)));
  // What the server is known to hold. Edits are diffed against this so an
  // unchanged document (e.g. the mount echo) never triggers a save, and a
  // failed save keeps its patch here for 「再試行」.
  // Normalised through the same serializer the editor uses, so a stored
  // document with different JSON formatting still compares equal.
  const savedContentRef = useRef(serializeContent(initialPaths));
  const pendingRef = useRef<Patch>({});

  const persist = useCallback(
    async (patch: Patch) => {
      // Merge into whatever is still unsaved, so a retry sends everything.
      pendingRef.current = { ...pendingRef.current, ...patch };
      const body = pendingRef.current;
      setStatus({ kind: "saving" });
      let httpStatus: number | null = null;
      try {
        const res = await fetch(`/api/icons/${icon.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        httpStatus = res.status;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Only what this request carried is now safe; anything merged in
        // since (a later edit) stays pending for the next save.
        if (pendingRef.current === body) pendingRef.current = {};
        if (body.content !== undefined) savedContentRef.current = body.content;
        setStatus((s) => (s.kind === "saving" ? { kind: "saved" } : s));
      } catch {
        // Nothing is dropped: `pendingRef` still holds the patch, and the
        // header now says so instead of claiming the work was saved.
        setStatus({ kind: "error", message: describeSaveFailure(httpStatus) });
      }
    },
    [icon.id]
  );

  const retry = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    persist({ content: serializeContent(pathsRef.current) });
  };

  // Debounced save of the vector content as the user edits.
  const scheduleSave = useCallback(() => {
    setStatus({ kind: "dirty" });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      persist({ content: serializeContent(pathsRef.current) });
    }, 800);
  }, [persist]);

  const onPathsChange = useCallback(
    (paths: Path[]) => {
      pathsRef.current = paths;
      // Skip the mount echo and any change that round-trips to the same
      // document: opening an icon must not count as editing it.
      if (serializeContent(paths) === savedContentRef.current) return;
      scheduleSave();
    },
    [scheduleSave]
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

  // Leaving with unsaved (or failed) work asks first. The browser shows its
  // own generic prompt; the message text is ignored by modern browsers.
  useEffect(() => {
    if (!hasUnsavedWork(status)) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [status]);

  const statusTone =
    status.kind === "error"
      ? "text-red-400"
      : status.kind === "saved"
        ? "text-neutral-500"
        : "text-neutral-400";

  return (
    <div className="flex h-dvh flex-col bg-neutral-950">
      <Head title={`${name} — 編集`} />
      <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 sm:gap-4 sm:px-4">
        <Link
          href="/icons"
          className="shrink-0 px-1 text-neutral-400 hover:text-white"
          title="一覧へ"
        >
          ←
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onNameBlur}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-neutral-700 focus:border-white focus:outline-none sm:w-56 sm:flex-none"
          placeholder="アイコン名"
        />
        <span
          role="status"
          className={`shrink-0 whitespace-nowrap text-xs ${statusTone}`}
          title={status.kind === "error" ? status.message : undefined}
        >
          {saveStatusLabel(status)}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {/* The owner can always preview the page; the label says whether
              anyone else can see it yet. */}
          <Link
            href={`/i/${icon.id}`}
            className="hidden whitespace-nowrap text-xs text-neutral-400 underline hover:text-white sm:inline"
          >
            {isPublic ? "公開ページを見る" : "プレビュー"}
          </Link>
          <button
            onClick={togglePublic}
            title={
              isPublic
                ? "今は誰でも見られます。押すと非公開に戻します"
                : "今は自分にしか見えません。押すとギャラリーに公開されます"
            }
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
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
            {isPublic ? "公開中 · 非公開に戻す" : "公開する"}
          </button>
        </div>
      </header>

      {status.kind === "error" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-200"
        >
          <span className="min-w-0 flex-1">{status.message}</span>
          <button
            onClick={retry}
            className="shrink-0 rounded border border-red-400/60 px-3 py-1 font-medium text-red-100 hover:border-white hover:text-white"
          >
            再試行
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <Editor
          initialPaths={initialPaths}
          onChange={onPathsChange}
          onTablerImport={onTablerImport}
        />
      </div>
    </div>
  );
}
