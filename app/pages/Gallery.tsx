import { Head, Link } from "@inertiajs/react";
import { useState } from "react";
import { IconFilter } from "../components/IconFilter";
import { Nav } from "../components/Nav";
import { IconSvg } from "../lib/IconSvg";
import { FILTER_THRESHOLD, filterByName } from "../lib/filterIcons";
import { parseContent } from "../lib/svg";
import type { SessionUser } from "../user";

type GalleryIcon = {
  id: string;
  name: string;
  content: string;
  updatedAt: string;
  authorName: string | null;
};

/** Why a visitor was bounced here, when they were (see `/icons` in server.ts). */
export type GalleryNotice = "login-required" | null;

export default function Gallery({
  user,
  icons,
  notice = null,
}: {
  user: SessionUser | null;
  icons: GalleryIcon[];
  notice?: GalleryNotice;
}) {
  const [query, setQuery] = useState("");
  const shown = filterByName(icons, query);

  return (
    <div className="min-h-screen">
      <Head title="chibicon — 公開アイコンギャラリー" />
      <Nav user={user} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        {notice === "login-required" && !user && (
          <div
            role="status"
            className="anim-header mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"
          >
            <span>その画面を見るにはログインが必要です。</span>
            <a
              href="/auth/google"
              className="rounded bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-neutral-200"
            >
              ログインする
            </a>
          </div>
        )}

        <div className="anim-header mb-8">
          {/* 2xl below sm so 「公開アイコンギャラリー」 fits on one line at 390px
              instead of dropping a lone 「ー」 onto the next. */}
          <h1 className="text-2xl font-bold sm:text-3xl">公開アイコンギャラリー</h1>
          <p className="mt-2 text-neutral-400">
            みんなが公開した stroke アイコン。
            {user ? (
              <Link href="/icons" className="ml-1 text-white underline">
                自分のアイコンを作る →
              </Link>
            ) : (
              <a href="/auth/google" className="ml-1 text-white underline">
                ログインして作る →
              </a>
            )}
          </p>
        </div>

        {icons.length >= FILTER_THRESHOLD && (
          <IconFilter
            value={query}
            onChange={setQuery}
            total={icons.length}
            shown={shown.length}
            placeholder="名前・作者で絞り込む"
          />
        )}

        {icons.length === 0 ? (
          <p className="py-20 text-center text-neutral-500">
            まだ公開アイコンがありません。
          </p>
        ) : shown.length === 0 ? (
          <p className="py-20 text-center text-neutral-500">
            「{query}」に一致するアイコンはありません。
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {shown.map((icon) => (
              <Link
                key={icon.id}
                href={`/i/${icon.id}`}
                title={icon.name}
                className="anim-item group flex flex-col items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 transition-colors hover:border-neutral-600"
              >
                <div className="text-white transition-transform group-hover:scale-110">
                  <IconSvg paths={parseContent(icon.content)} size={48} />
                </div>
                <div className="w-full text-center">
                  <div className="truncate text-sm font-medium">{icon.name}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {icon.authorName || "anonymous"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
