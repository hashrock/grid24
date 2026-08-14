# grid24

24×24 グリッド / 2px stroke で、ユーザーごとに stroke アイコンを作成し、公開できるサービス。
ベジェエディタ（`app/editor/**`）と Hono API を「クラサバ合体」した構成で、
アーキテクチャは [`../edane`](../edane) を踏襲しています。

## 構成

- **Hono + @hono/inertia**（`app/server.ts`）— サーバー駆動ルーティング（Inertia ページ）＋ JSON 自動保存 API
- **React + Inertia**（`app/client.tsx`, `app/pages/**`）— クライアント側ページ
- **Drizzle ORM + Cloudflare D1**（`app/db/schema.ts`）— `users` / `icons` テーブル
- **ベジェエディタ**（`app/editor/**`）— Luma SVG Editor プロトタイプから移植
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

**Google OAuth**（`@hono/oauth-providers/google` の `googleAuth` ミドルウェア）。
ログイン後は HMAC 署名付きのセッション Cookie（`app/utils/session.ts`）で維持します。

| ルート | 内容 |
| --- | --- |
| `GET /auth/google` | ログイン開始とコールバックを兼ねる。`users` に upsert してセッション発行 |
| `GET /auth/logout` | セッション破棄 |

必要な環境変数:

| 変数 | 用途 |
| --- | --- |
| `GOOGLE_ID` / `GOOGLE_SECRET` | Google OAuth クライアント |
| `SESSION_SECRET` | セッション Cookie の署名鍵（任意のランダム文字列） |

Google Cloud Console の OAuth クライアント（種別: ウェブ アプリケーション）に、
承認済みリダイレクト URI を登録してください:

- 本番: `https://grid.hashrock.info/auth/google`
- ローカル: `http://localhost:5173/auth/google`

本番のシークレット登録:

```sh
pnpm wrangler secret put GOOGLE_ID
pnpm wrangler secret put GOOGLE_SECRET
pnpm wrangler secret put SESSION_SECRET
```

ローカル開発は `.dev.vars` に `DEV_BYPASS_AUTH=1` を置くと固定の `Dev User` で
動作します（OAuth を通しません）。`?guest=1` でログアウト状態をプレビューでき、
ローカルで実際の OAuth を試したい場合は `DEV_BYPASS_AUTH` を外して
`GOOGLE_ID` / `GOOGLE_SECRET` / `SESSION_SECRET` を `.dev.vars` に書きます。

## 開発

```sh
pnpm install
pnpm migrate       # ローカル D1 にマイグレーション適用
pnpm dev           # http://localhost:5173
```

## デプロイ

```sh
# 1. リモート D1 を作成し、出力された database_id を wrangler.jsonc に設定
pnpm wrangler d1 create grid24-db

# 2. リモートにマイグレーション適用
pnpm migrate:remote

# 3. シークレットを登録（認証セクション参照）
pnpm wrangler secret put GOOGLE_ID
pnpm wrangler secret put GOOGLE_SECRET
pnpm wrangler secret put SESSION_SECRET

# 4. デプロイ
pnpm deploy
```

> `wrangler.jsonc` の `database_id` はプレースホルダです。デプロイ前に実 ID に置き換えてください。

## AI 生成（既定でオフ）

エディタの「AI Generation」は機能フラグで隠してあります。表示するには
`VITE_ENABLE_AI_GENERATION=1` を設定してください（`app/lib/featureFlags.ts`）。
実際に生成するには併せて `VITE_API_KEY`（Gemini）も必要です。
フラグがオフのあいだは UI が出ず、Gemini SDK もバンドルに含まれません。
