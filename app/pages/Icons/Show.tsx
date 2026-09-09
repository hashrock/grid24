import { Head, Link } from "@inertiajs/react";
import { useState } from "react";
import { Nav } from "../../components/Nav";
import { IconSvg } from "../../lib/IconSvg";
import {
  parseContent,
  pathsToDataUri,
  pathsToJsxString,
  pathsToSvgString,
} from "../../lib/svg";
import type { SessionUser } from "../../user";

type ShowIcon = {
  id: string;
  name: string;
  content: string;
  isPublic: boolean;
  authorName: string | null;
  updatedAt: string;
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

/** The formats the icon can be copied out in, in tab order. */
const FORMATS = [
  { key: "svg", label: "SVG" },
  { key: "jsx", label: "React" },
  { key: "uri", label: "Data URI" },
] as const;

type Format = (typeof FORMATS)[number]["key"];

/** Sizes an icon has to survive; 16 is where a stroke design breaks first. */
const PREVIEW_SIZES = [16, 24, 32, 48];

export default function IconsShow({
  user,
  icon,
  isOwner,
}: {
  user: SessionUser | null;
  icon: ShowIcon;
  isOwner: boolean;
}) {
  const paths = parseContent(icon.content);
  const sources = parseSources(icon.tablerSources);

  const code: Record<Format, string> = {
    svg: pathsToSvgString(paths),
    jsx: pathsToJsxString(paths, icon.name),
    uri: pathsToDataUri(paths, "#000000"),
  };

  const [format, setFormat] = useState<Format>("svg");
  const [copied, setCopied] = useState(false);
  // Stroke icons are drawn on dark here but shipped on light as often as not,
  // so the preview flips instead of picking one and hoping.
  const [onLight, setOnLight] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code[format]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const downloadSvg = () => {
    const blob = new Blob([code.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${icon.name || "icon"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const surface = onLight ? "bg-white text-black" : "bg-neutral-950 text-white";

  return (
    <div className="min-h-screen">
      <Head title={`${icon.name} — chibicon`} />
      <Nav user={user} />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="anim-header mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{icon.name}</h1>
            <p className="mt-1 text-sm text-neutral-500">
              by {icon.authorName || "anonymous"}
              <span className="mx-2 text-neutral-700">·</span>
              <span className="font-mono">{icon.updatedAt.slice(0, 10)}</span>
              {!icon.isPublic && (
                <span
                  className="ml-2 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400"
                  title="このページはあなたにしか見えません。公開するには編集画面の「公開する」を押してください。"
                >
                  非公開（自分にだけ表示中）
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={copy}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200"
            >
              {copied ? "コピーしました" : `${FORMATS.find((f) => f.key === format)!.label} をコピー`}
            </button>
            <button
              onClick={downloadSvg}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-white"
            >
              ダウンロード
            </button>
            {isOwner && (
              <Link
                href={`/icons/${icon.id}/edit`}
                className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-white"
              >
                編集
              </Link>
            )}
          </div>
        </div>

        {/* Preview: one large read, then the sizes it actually ships at. */}
        <div className="anim-item overflow-hidden rounded-2xl border border-neutral-800">
          <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/40 px-4 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              Preview
            </span>
            <div className="flex gap-1 text-xs">
              {([false, true] as const).map((light) => (
                <button
                  key={String(light)}
                  onClick={() => setOnLight(light)}
                  className={`rounded px-2 py-1 transition-colors ${
                    onLight === light
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-500 hover:text-white"
                  }`}
                >
                  {light ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </div>

          <div className={`flex flex-col items-center gap-8 px-6 py-12 transition-colors ${surface}`}>
            <IconSvg paths={paths} size={144} strokeWidth={2} />
            <div className="flex flex-wrap items-end justify-center gap-8">
              {PREVIEW_SIZES.map((size) => (
                <div key={size} className="flex flex-col items-center gap-2">
                  <div className="flex h-12 items-end">
                    <IconSvg paths={paths} size={size} strokeWidth={2} />
                  </div>
                  <span className="font-mono text-[10px] opacity-50">{size}px</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Code, in whichever form the reader is going to paste. */}
        <div className="anim-item mt-6 overflow-hidden rounded-2xl border border-neutral-800">
          <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/40 px-2 py-2">
            <div className="flex gap-1">
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFormat(f.key)}
                  className={`rounded px-3 py-1 text-xs transition-colors ${
                    format === f.key
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-500 hover:text-white"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={copy}
              className="mr-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500 hover:text-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {/* Wrapped, not scrolled: a path `d` is one long token, and a
              horizontal scrollbar hides most of it. */}
          <pre className="max-h-80 overflow-y-auto bg-neutral-950 p-4 text-left text-xs leading-relaxed text-neutral-400">
            <code className="whitespace-pre-wrap break-all">{code[format]}</code>
          </pre>
        </div>

        {sources.length > 0 && (
          <div className="anim-item mt-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
            <p className="text-xs text-neutral-400">
              このアイコンは{" "}
              <a
                href="https://tabler.io/icons"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-200 underline hover:text-white"
              >
                Tabler Icons
              </a>{" "}
              <span className="text-neutral-500">(MIT · © Paweł Kuna)</span>{" "}
              をベースに制作されています。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sources.map((name) => (
                <a
                  key={name}
                  href={`https://tabler.io/icons/icon/${name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-white hover:text-white"
                >
                  {name}
                </a>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
