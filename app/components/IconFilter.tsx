/**
 * Name filter box for icon lists. Purely presentational: the page owns the
 * query and applies `filterByName` itself, so the list logic stays testable.
 */
export function IconFilter({
  value,
  onChange,
  total,
  shown,
  placeholder = "名前で絞り込む",
}: {
  value: string;
  onChange: (next: string) => void;
  /** How many icons there are in all. */
  total: number;
  /** How many survive the current query. */
  shown: number;
  placeholder?: string;
}) {
  return (
    <div className="anim-header mb-6 flex flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900/50 py-2 pl-9 pr-3 text-sm text-white placeholder:text-neutral-600 focus:border-white focus:outline-none"
        />
      </div>
      <span className="whitespace-nowrap text-xs text-neutral-500">
        {value.trim() ? `${shown} / ${total} 件` : `${total} 件`}
      </span>
    </div>
  );
}
