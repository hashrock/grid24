# grid24

24×24 グリッド / 2px stroke で、ユーザーごとに stroke アイコンを作成し、公開できるサービス。
`luma-svg-editor`（ベジェエディタ）と Hono API を「クラサバ合体」した構成で、
アーキテクチャは [`../edane`](../edane) を踏襲しています。

## 構成

- **Hono + @hono/inertia**（`app/server.ts`）— サーバー駆動ルーティング（Inertia ページ）＋ JSON 自動保存 API
- **React + Inertia**（`app/client.tsx`, `app/pages/**`）— クライアント側ページ
- **Drizzle ORM + Cloudflare D1**（`app/db/schema.ts`）— `users` / `icons` テーブル
- **ベジェエディタ**（`app/editor/**`）— 既存の Luma SVG Editor をそのまま移植
- **Cloudflare Workers** にデプロイ

### 主なルート

| ルート | 内容 |
| --- | --- |
| `GET /` | 公開ギャラリー（全ユーザーの公開アイコン） |
| `GET /icons` | マイアイコン一覧（要ログイン） |
| `POST /icons` | 新規アイコン作成 → 編集へ |
| `GET /icons/:id/edit` | エディタ（所有者のみ） |
| `PUT /api/icons/:id` | 自動保存（name / content / isPublic） |
| `GET /i/:id` | 個別公開ページ（公開 or 所有者のみ） |

アイコンの内容はエディタの `Segment[]` を JSON で `icons.content` に保存し、
公開時は `app/lib/svg.ts` で SVG に変換して描画します。

## 認証

現在は **ダミー認証**（`DEV_BYPASS_AUTH`）で `Dev User` として動作します。
`?guest=1` でログアウト状態をプレビューできます。
Google OAuth への差し替えは `app/utils/session.ts` を利用して
`app/server.ts` の auth ミドルウェアに `@hono/oauth-providers` を追加するだけです
（edane の `app/server.ts` が参考実装）。

## 開発

```sh
pnpm install
pnpm migrate       # ローカル D1 にマイグレーション適用
pnpm dev           # http://localhost:5173
```

## デプロイ

```sh
# 1. リモート D1 を作成し、出力された database_id を wrangler.jsonc に設定
pnpm wrangler d1 create svg-icon-editor-db

# 2. リモートにマイグレーション適用
pnpm migrate:remote

# 3. デプロイ
pnpm deploy
```

> `wrangler.jsonc` の `database_id` はプレースホルダです。デプロイ前に実 ID に置き換えてください。

## AI 生成（任意）

エディタの「AI Generation」は `VITE_API_KEY`（Gemini）を設定すると有効になります。
未設定でも他機能はすべて利用できます。
