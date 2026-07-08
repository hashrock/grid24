import { Head, Link, router } from "@inertiajs/react";
import { Nav } from "../../components/Nav";
import { IconSvg } from "../../lib/IconSvg";
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
}: {
  user: SessionUser;
  icons: MyIcon[];
}) {
  const createIcon = () => {
    router.post("/icons", { name: "Untitled" });
  };

  const importTabler = () => {
    router.post("/icons/import-tabler", {}, { preserveScroll: true });
  };

  const deleteIcon = (icon: MyIcon) => {
    if (!confirm(`「${icon.name}」を削除しますか？`)) return;
    router.delete(`/icons/${icon.id}`, { preserveScroll: true });
  };

  return (
    <div className="min-h-screen">
      <Head title="マイアイコン" />
      <Nav user={user} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="anim-header mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold">マイアイコン</h1>
          <div className="flex gap-2">
            <button
              onClick={importTabler}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-white"
              title="Tabler のスターターアイコン(24x24)をインポート"
            >
              Tablerをインポート
            </button>
            <button
              onClick={createIcon}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200"
            >
              + 新規作成
            </button>
          </div>
        </div>

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
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {icons.map((icon) => (
              <div
                key={icon.id}
                className="anim-item group relative flex flex-col items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-5"
              >
                <Link
                  href={`/icons/${icon.id}/edit`}
                  className="flex w-full flex-col items-center gap-3 text-white"
                >
                  <div className="transition-transform group-hover:scale-110">
                    <IconSvg segments={parseContent(icon.content)} size={48} />
                  </div>
                  <div className="w-full text-center">
                    <div className="truncate text-sm font-medium">{icon.name}</div>
                    <div className="text-xs text-neutral-500">
                      {icon.isPublic ? "公開中" : "非公開"}
                    </div>
                  </div>
                </Link>
                <button
                  onClick={() => deleteIcon(icon)}
                  className="absolute right-2 top-2 rounded p-1 text-neutral-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  title="削除"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
