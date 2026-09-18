/**
 * hashrock のサービス切り替え (repos.hashrock.info が配る Web Component)。
 * 本体は app/root-view.tsx で読む https://repos.hashrock.info/switcher/v1.js。
 * 読めなくてもボタンが出ないだけで、このページの表示や操作は妨げない。
 *
 * 全画面で右上に出すため、各ヘッダの右端 (一番右) に置く:
 * Nav (ギャラリー / マイアイコン / 公開ページ) とエディタのヘッダ。
 */
export function ServiceSwitcher({ className }: { className?: string }) {
  return <hashrock-switcher theme="dark" className={className} />;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hashrock-switcher": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        theme?: "light" | "dark";
        floating?: boolean;
      };
    }
  }
}
