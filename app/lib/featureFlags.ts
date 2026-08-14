/** 機能フラグ。既定でオフにしておきたい機能はここで一元管理する。 */

/**
 * AI（Gemini）によるアイコン生成。
 * 既定は無効。`VITE_ENABLE_AI_GENERATION=1` を設定すると UI が現れる。
 * 実際に生成するには併せて `VITE_API_KEY` も必要。
 */
export const AI_GENERATION_ENABLED =
  (import.meta as any).env?.VITE_ENABLE_AI_GENERATION === '1';
