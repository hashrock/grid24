import { Head, Link } from "@inertiajs/react";
import { Nav } from "../components/Nav";
import { IconSvg } from "../lib/IconSvg";
import { parseContent } from "../lib/svg";
import type { SessionUser } from "../user";

type GalleryIcon = {
  id: string;
  name: string;
  content: string;
  updatedAt: string;
  authorName: string | null;
};

export default function Gallery({
  user,
  icons,
}: {
  user: SessionUser | null;
  icons: GalleryIcon[];
}) {
  return (
    <div className="min-h-screen">
      <Head title="grid24 — 公開アイコンギャラリー" />
      <Nav user={user} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="anim-header mb-8">
          <h1 className="text-3xl font-bold">公開アイコンギャラリー</h1>
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

        {icons.length === 0 ? (
          <p className="py-20 text-center text-neutral-500">
            まだ公開アイコンがありません。
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {icons.map((icon) => (
              <Link
                key={icon.id}
                href={`/i/${icon.id}`}
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
