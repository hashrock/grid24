import { Head, Link } from "@inertiajs/react";
import { useState } from "react";
import { Nav } from "../../components/Nav";
import { IconSvg } from "../../lib/IconSvg";
import { parseContent, segmentsToSvgString } from "../../lib/svg";
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

export default function IconsShow({
  user,
  icon,
  isOwner,
}: {
  user: SessionUser | null;
  icon: ShowIcon;
  isOwner: boolean;
}) {
  const segments = parseContent(icon.content);
  const svgString = segmentsToSvgString(segments);
  const sources = parseSources(icon.tablerSources);
  const [copied, setCopied] = useState(false);

  const copySvg = async () => {
    try {
      await navigator.clipboard.writeText(svgString);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const downloadSvg = () => {
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${icon.name || "icon"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen">
      <Head title={`${icon.name} — grid24`} />
      <Nav user={user} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="anim-item flex flex-col items-center gap-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-10">
          <div className="rounded-xl bg-neutral-950 p-10 text-white">
            <IconSvg segments={segments} size={160} strokeWidth={2} />
          </div>

          <div className="text-center">
            <h1 className="text-2xl font-bold">{icon.name}</h1>
            <p className="mt-1 text-sm text-neutral-500">
              by {icon.authorName || "anonymous"}
              {!icon.isPublic && (
                <span className="ml-2 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                  非公開
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={copySvg}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200"
            >
              {copied ? "コピーしました" : "SVGをコピー"}
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

          <pre className="w-full overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-left text-xs text-neutral-400">
            <code>{svgString}</code>
          </pre>

          {sources.length > 0 && (
            <div className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-left">
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
              <div className="mt-2 flex flex-wrap gap-2">
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
        </div>
      </main>
    </div>
  );
}
