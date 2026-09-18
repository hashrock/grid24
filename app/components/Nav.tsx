import { Link } from "@inertiajs/react";
import type { SessionUser } from "../user";
import { ServiceSwitcher } from "./ServiceSwitcher";

/** Top navigation shared across pages. */
export function Nav({ user }: { user: SessionUser | null }) {
  return (
    <header className="anim-header sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-base font-bold sm:text-lg"
        >
          <span aria-hidden>▦</span>
          <span>
            chibi<span className="text-neutral-500">con</span>
          </span>
        </Link>
        {/* Links never wrap mid-word: at 390px 「ギャラリー」 used to break into
            「ギャラリ / ー」. Each item stays on one line; the row just gets tighter. */}
        <nav className="flex items-center gap-2.5 whitespace-nowrap text-xs sm:gap-4 sm:text-sm">
          <Link href="/" className="text-neutral-400 hover:text-white">
            ギャラリー
          </Link>
          {user ? (
            <>
              <Link href="/icons" className="text-neutral-400 hover:text-white">
                マイアイコン
              </Link>
              <span className="hidden max-w-40 truncate text-neutral-600 md:inline">{user.name}</span>
              <a
                href="/auth/logout"
                className="text-neutral-500 hover:text-white"
              >
                ログアウト
              </a>
            </>
          ) : (
            <a
              href="/auth/google"
              className="rounded bg-white px-3 py-1.5 font-medium text-black hover:bg-neutral-200"
            >
              ログイン
            </a>
          )}
          {/* ログアウトの押し間違いを避けるため少し間を空ける */}
          <ServiceSwitcher className="ml-1 text-neutral-400 hover:text-white sm:ml-2" />
        </nav>
      </div>
    </header>
  );
}
