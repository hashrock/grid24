# chibicon

24×24 グリッド / 2px stroke の monoline アイコンを、ユーザーごとに作成して公開できるサービス。
ベジェエディタ（`app/editor/**`）と Hono API を「クラサバ合体」した構成で、
アーキテクチャは [`../edane`](../edane) を踏襲しています。

> Worker 名（`grid24`）・D1 名（`grid24-db`）・独自ドメイン（`grid.hashrock.info`）は
> 旧名のままです。作り直しとドメイン移行が必要になるため、表示名の変更とは分けてあります。

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
| `GET /i/:id.svg` | SVG ファイルそのものを返す URL（下記） |
| `GET /__scenarios` | UI テスト用シナリオ一覧。`/__scenarios/:name` で初期状態を作って遷移（[docs/ui-test-scenarios.md](docs/ui-test-scenarios.md)） |

アイコンの内容はフラットな `Segment[]` を JSON で `icons.content` に保存し、
公開時は `app/lib/svg.ts` で SVG に変換して描画します。

### SVG を配信する URL

`GET /i/:id.svg` は保存済みの内容から毎回 SVG を組み立てて `image/svg+xml` で返します。
`<img src>` や CSS の `url()`、README への貼り付けにそのまま使えます
（公開ページの「URL」タブからコピーできます）。

```html
<img src="https://grid.hashrock.info/i/abc123.svg?size=32" width="32" height="32" alt="">
```

| クエリ | 既定値 | 内容 |
| --- | --- | --- |
| `size` | `24` | width / height 属性（1〜1024）。`viewBox` は常に `0 0 24 24` |
| `color` | `currentColor` | 線の色。`ff5722` のように `#` 抜きでも可（16 進 3/4/6/8 桁、または CSS の色名） |
| `stroke` | `2` | 線の太さ（0〜8） |

- 見える範囲は `/i/:id` と同じ。**公開アイコンは誰でも、非公開は所有者だけ**、それ以外は 404
  （HTML ページではなくプレーンテキスト。呼び出し元は人ではなく `<img>` なので）
- 公開アイコンは `Cache-Control: public, max-age=300` と `ETag`（`If-None-Match` で 304）、
  非公開は `private, no-store`。編集して保存すると `updatedAt` が動くので ETag も変わる
- 他サイトからの埋め込みが前提なので `Access-Control-Allow-Origin: *` を付けます
- `color` は属性へ埋め込む値なのでエスケープではなく**許可リスト**で検証し、
  外れた入力は既定値に落とします（`app/lib/svgServe.ts`）

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

「誰としてログインしているか」は `app/auth/` の **AuthProvider**（`resolve / signIn / signOut`）に
集約されています。本番は `sessionAuth`（上記セッション Cookie）、`DEV_BYPASS_AUTH` 時は `bypassAuth`、
テストでは `createApp({ auth: fixedAuth(user) })` で固定ユーザを注入できます。
OAuth コールバック・ログアウト・UI テスト用シナリオはすべて `auth.signIn / signOut` を呼ぶだけで、
Cookie を直接扱うのはこのモジュールだけです。

ローカル開発は `.dev.vars` に `DEV_BYPASS_AUTH=1` を置くと固定の `Dev User` で
動作します（OAuth を通しません）。`?guest=1` でログアウト状態をプレビューでき、
ローカルで実際の OAuth を試したい場合は `DEV_BYPASS_AUTH` を外して
`GOOGLE_ID` / `GOOGLE_SECRET` / `SESSION_SECRET` を `.dev.vars` に書きます。

## 開発

```sh
pnpm install
pnpm migrate       # ローカル D1 にマイグレーション適用
pnpm dev           # http://localhost:5173
pnpm test          # エディタ reducer のテスト（vitest）
```

エディタの編集操作はすべて `app/editor/state/` の reducer に集約されています。
純関数なので `pnpm test` は React もブラウザも起動せずに走ります。

ベクターデータは `Path[]`（`Path` が `Segment[]` を chain 順に持つ）で扱います。
D1 に保存されるのは旧来のフラットな `Segment[]`（`pathId` / `isClosed` 付き）のままで、
変換は `app/lib/svg.ts` に閉じています。

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

### 自動デプロイ（GitHub Actions）

`main` への push で `.github/workflows/deploy.yml` が走り、型チェック → ビルド →
リモート D1 マイグレーション適用 → `wrangler deploy` を実行します。手動実行も可能です
（Actions タブの Run workflow）。

リポジトリの Settings → Secrets and variables → Actions に以下を登録してください。

| Secret | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Edit Cloudflare Workers 権限 + D1 Edit 権限のトークン |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare ダッシュボード右サイドの Account ID |

`GOOGLE_ID` などのアプリ側シークレットは Worker 側に保存済みのものが使われるため、
GitHub には登録不要です。

## AI 生成（既定でオフ）

エディタの「AI Generation」は機能フラグで隠してあります。表示するには
`VITE_ENABLE_AI_GENERATION=1` を設定してください（`app/lib/featureFlags.ts`）。
実際に生成するには併せて `VITE_API_KEY`（Gemini）も必要です。
フラグがオフのあいだは UI が出ず、Gemini SDK もバンドルに含まれません。
