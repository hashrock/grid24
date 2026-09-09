import { Head, Link, router } from "@inertiajs/react";
import { useState } from "react";
import { IconFilter } from "../../components/IconFilter";
import { Nav } from "../../components/Nav";
import { IconSvg } from "../../lib/IconSvg";
import { FILTER_THRESHOLD, filterByName } from "../../lib/filterIcons";
import { parseContent } from "../../lib/svg";
import type { SessionUser } from "../../user";

type MyIcon = {
  id: string;
  name: string;
  content: string;
  isPublic: boolean;
  updatedAt: string;
};

export default function IconsIndex({
  user,
  icons,
  seeded = false,
}: {
  user: SessionUser;
  icons: MyIcon[];
  /** True on the visit that planted the starter icons (first time here). */
  seeded?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [welcomeOpen, setWelcomeOpen] = useState(seeded);
  const shown = filterByName(icons, query);

  const createIcon = () => {
    router.post("/icons", { name: "Untitled" });
  };

  const deleteIcon = (icon: MyIcon) => {
    if (!confirm(`「${icon.name}」を削除しますか？\nこの操作は取り消せません。`)) return;
    router.delete(`/icons/${icon.id}`, { preserveScroll: true });
  };

  return (
    <div className="min-h-screen">
      <Head title="マイアイコン" />
      <Nav user={user} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="anim-header mb-8 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold sm:text-3xl">マイアイコン</h1>
          <button
            onClick={createIcon}
            className="shrink-0 whitespace-nowrap rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200"
          >
            + 新規作成
          </button>
        </div>

        {welcomeOpen && (
          <div
            role="status"
            className="anim-header mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-neutral-700 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-200"
          >
            <p className="min-w-0 flex-1">
              はじめまして。お試し用に <strong>サンプルのアイコンを {icons.length} 件</strong>{" "}
              入れておきました（Tabler Icons 由来）。自由に開いて編集しても、削除してもかまいません。
              自分で作るときは「+ 新規作成」からどうぞ。
            </p>
            <button
              onClick={() => setWelcomeOpen(false)}
              className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:border-white hover:text-white"
            >
              閉じる
            </button>
          </div>
        )}

        {icons.length >= FILTER_THRESHOLD && (
          <IconFilter
            value={query}
            onChange={setQuery}
            total={icons.length}
            shown={shown.length}
          />
        )}

        {icons.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-800 py-20 text-center">
            <p className="text-neutral-500">まだアイコンがありません。</p>
            <button
              onClick={createIcon}
              className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-white"
            >
              最初のアイコンを作る
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="py-20 text-center text-neutral-500">
            「{query}」に一致するアイコンはありません。
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {shown.map((icon) => (
              <div
                key={icon.id}
                className="anim-item group relative flex flex-col items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 transition-colors hover:border-neutral-600 sm:p-5"
              >
                {/* The card opens the icon's page (view / copy / download).
                    Editing is a deliberate click on 「編集」 below, so a stray
                    drag on the card can no longer reshape a finished icon. */}
                <Link
                  href={`/i/${icon.id}`}
                  title={icon.name}
                  className="flex w-full flex-col items-center gap-3 text-white"
                >
                  <div className="transition-transform group-hover:scale-110">
                    <IconSvg paths={parseContent(icon.content)} size={48} />
                  </div>
                  <div className="w-full text-center">
                    <div className="truncate text-sm font-medium">{icon.name}</div>
                    <div className="text-xs text-neutral-500">
                      {icon.isPublic ? "公開中" : "非公開"}
                    </div>
                  </div>
                </Link>
                {/* Always visible: hover-only controls are unreachable on touch. */}
                <div className="flex w-full items-center justify-center gap-2 border-t border-neutral-800 pt-3">
                  <Link
                    href={`/icons/${icon.id}/edit`}
                    className="flex items-center gap-1 whitespace-nowrap rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-white hover:text-white sm:px-2.5"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    編集
                  </Link>
                  <button
                    onClick={() => deleteIcon(icon)}
                    className="flex items-center gap-1 whitespace-nowrap rounded border border-transparent px-2 py-1 text-xs text-neutral-500 hover:border-red-900 hover:text-red-400 sm:px-2.5"
                    title="削除"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
