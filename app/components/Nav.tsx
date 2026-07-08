import { Link } from "@inertiajs/react";
import type { SessionUser } from "../user";

/** Top navigation shared across pages. */
export function Nav({ user }: { user: SessionUser | null }) {
  return (
    <header className="anim-header sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2 font-mono text-lg font-bold">
          <span aria-hidden>▦</span>
          <span>
            grid<span className="text-neutral-500">24</span>
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-neutral-400 hover:text-white">
            ギャラリー
          </Link>
          {user ? (
            <>
              <Link href="/icons" className="text-neutral-400 hover:text-white">
                マイアイコン
              </Link>
              <span className="hidden text-neutral-600 sm:inline">{user.name}</span>
              <a
                href="/auth/logout"
                className="text-neutral-500 hover:text-white"
              >
                ログアウト
              </a>
            </>
          ) : (
            <a
              href="/?guest=0"
              className="rounded bg-white px-3 py-1.5 font-medium text-black hover:bg-neutral-200"
            >
              ログイン
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
