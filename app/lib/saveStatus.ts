/**
 * Autosave outcome → what the editor header tells the user.
 *
 * Kept as plain data + pure functions so the wording and the "is my work
 * safe?" decision can be unit-tested without rendering the editor.
 */

export type SaveStatus =
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "dirty" }
  /** The last save did not land; `message` says why and what to do. */
  | { kind: "error"; message: string };

/**
 * Why a save failed, in words a non-engineer can act on. `status` is the
 * HTTP status, or `null` when the request never got a response (offline,
 * server down, aborted).
 */
export function describeSaveFailure(status: number | null): string {
  if (status === null) return "保存できませんでした。通信を確認して「再試行」を押してください。";
  if (status === 401 || status === 403 || status === 404) {
    // The server no longer sees us as the owner: the session expired, or a
    // different account is signed in. Saving again will not help; only a
    // fresh login will, and the current edits must not be thrown away.
    return "保存できませんでした。ログインが切れたか、別のユーザーでログインしています。別タブでログインし直してから「再試行」を押してください。";
  }
  if (status >= 500) return "サーバーエラーで保存できませんでした。しばらくして「再試行」を押してください。";
  return `保存できませんでした（エラー ${status}）。「再試行」を押してください。`;
}

/** Header label for each state. */
export function saveStatusLabel(status: SaveStatus): string {
  switch (status.kind) {
    case "saved":
      return "保存済み";
    case "saving":
      return "保存中…";
    case "dirty":
      return "未保存";
    case "error":
      return "保存失敗";
  }
}

/**
 * Whether leaving the page now would lose work. Used for the
 * `beforeunload` guard so a failed save is not silently abandoned.
 */
export function hasUnsavedWork(status: SaveStatus): boolean {
  return status.kind !== "saved";
}
