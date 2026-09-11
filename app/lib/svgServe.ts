import type { Path } from "../editor/types";
import { pathsToSvgString } from "./svg";

/**
 * The hosted icon URL (`GET /i/:id.svg`): what its query string may ask for,
 * and the response that answers it.
 *
 * Kept out of `server.ts` so the rules — what a query string is allowed to
 * say, what the caching and CORS headers are — can be tested without a
 * database behind them.
 */

export const DEFAULT_SIZE = 24;
export const DEFAULT_COLOR = "currentColor";
export const DEFAULT_STROKE_WIDTH = 2;

const MAX_SIZE = 1024;
const MAX_STROKE_WIDTH = 8;

/** A sanitized query string. Every field is safe to write into the markup. */
export type SvgParams = {
  size: number;
  color: string;
  strokeWidth: number;
};

export const DEFAULT_SVG_PARAMS: SvgParams = {
  size: DEFAULT_SIZE,
  color: DEFAULT_COLOR,
  strokeWidth: DEFAULT_STROKE_WIDTH,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A finite number from a query value, or `fallback` for anything else. */
function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Stroke paint from a query value.
 *
 * The result is interpolated into an attribute of a document we serve as
 * `image/svg+xml`, so this is an allow-list, not an escape: hex (with or
 * without the `#`, which is a pain to pass in a URL), a bare CSS color
 * keyword, or `currentColor`. Anything else falls back to the default rather
 * than reaching the markup.
 */
export function parseColor(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_COLOR;
  const v = raw.trim();
  if (v === "") return DEFAULT_COLOR;
  if (v.toLowerCase() === "currentcolor") return "currentColor";
  const hex = v.startsWith("#") ? v.slice(1) : v;
  if (/^[0-9a-fA-F]+$/.test(hex) && [3, 4, 6, 8].includes(hex.length)) {
    return `#${hex.toLowerCase()}`;
  }
  // `red`, `rebeccapurple`, … — letters only, so nothing to escape. An
  // unknown keyword is not rejected here: it simply paints nothing, the same
  // as it would in a stylesheet.
  if (/^[a-zA-Z]{1,24}$/.test(v)) return v.toLowerCase();
  return DEFAULT_COLOR;
}

/** Read `?size=` / `?color=` / `?stroke=`, clamped to what an icon can be. */
export function parseSvgParams(query: Record<string, string | undefined>): SvgParams {
  return {
    size: Math.round(clamp(num(query.size, DEFAULT_SIZE), 1, MAX_SIZE)),
    color: parseColor(query.color),
    strokeWidth: clamp(num(query.stroke, DEFAULT_STROKE_WIDTH), 0, MAX_STROKE_WIDTH),
  };
}

/** Render the document this URL serves. */
export function renderIconSvg(paths: Path[], params: SvgParams): string {
  return pathsToSvgString(paths, params.size, {
    color: params.color,
    strokeWidth: params.strokeWidth,
  });
}

/**
 * A validator for the rendered bytes: the icon's `updatedAt` (every save moves
 * it) plus the query that shaped them. Cheap non-cryptographic hash — this
 * only has to change when the output does, and never has to be guessed.
 */
export function svgEtag(updatedAt: string, params: SvgParams): string {
  const key = `${updatedAt}|${params.size}|${params.color}|${params.strokeWidth}`;
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `"${h.toString(36)}"`;
}

export type IconSvgRequest = {
  paths: Path[];
  /** ISO timestamp of the icon's last save; feeds the ETag. */
  updatedAt: string;
  /**
   * Public icons are cached by shared caches; an owner previewing their own
   * unpublished icon must not be, or a proxy would hand it to a stranger.
   */
  isPublic: boolean;
  params: SvgParams;
  /** The request's `If-None-Match`, if it sent one. */
  ifNoneMatch?: string | null;
};

/**
 * The `/i/:id.svg` response, headers and all. Visibility is decided by the
 * caller — reaching here means the requester may see this icon.
 */
export function iconSvgResponse({
  paths,
  updatedAt,
  isPublic,
  params,
  ifNoneMatch,
}: IconSvgRequest): Response {
  const etag = svgEtag(updatedAt, params);
  const headers: Record<string, string> = {
    "content-type": "image/svg+xml; charset=utf-8",
    etag,
    // Hotlinking is the point of this URL, so it has to survive both a
    // cross-origin `<img>` and a `fetch()` from another site.
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
    // The markup is generated from numbers only — no user text is
    // interpolated — but an SVG opened at its own URL is still a document,
    // so it is served inert and unsniffable.
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "cache-control": isPublic
      ? "public, max-age=300, stale-while-revalidate=86400"
      : "private, no-store",
  };

  if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(renderIconSvg(paths, params), { headers });
}
