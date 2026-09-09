# UI テスト用シナリオ route

Chrome MCP などでブラウザ自動テストをするとき、**URL を開くだけで所定の初期状態が用意され、
その画面へリダイレクトされる** route。実装は `app/scenarios/` にまとまっており、
`app/server.ts` は `/__scenarios` に mount しているだけです。

| ルート | 内容 |
| --- | --- |
| `GET /__scenarios` | シナリオ一覧（名前・説明・現在のモードでの利用可否） |
| `GET /__scenarios/:name` | 初期状態を**新規に**作り、対象画面へ **303** リダイレクト |
| `GET /__scenarios/:name?format=json`（または `Accept: application/json`） | リダイレクトせず、作成した ID・URL・ログイン状態を JSON で返す |

## シナリオ一覧

| name | 初期状態 | 遷移先 |
| --- | --- | --- |
| `empty` | データ無しの新規ユーザ。初回訪問時にスターターアイコン 3 件が seed される（＝初回利用者の画面） | `/icons` |
| `typical` | マイアイコン 5 件（公開 2・非公開 3、うち 1 件は白紙） | `/icons` |
| `large` | マイアイコン 60 件。超長い名前・日本語＋絵文字・全スターターを重ねた高密度アイコンを含む | `/icons` |
| `editor-blank` | 新規作成直後の白紙 Untitled アイコン | `/icons/:id/edit` |
| `editor-complex` | スターター 11 種の全ストロークを重ねた高密度アイコン（閉パス・曲線混在、Tabler クレジット多数） | `/icons/:id/edit` |
| `public-icon` | 公開済みアイコンを**未ログインの訪問者**として閲覧（Tabler クレジット付き） | `/i/:id` |

## 安全性（本番でも公開してよい理由）

- 既存データは消さない・書き換えない。毎回新しい ID の行だけを追加し、アイコン名には
  `scenario-<name>-<6 桁ランダム>` のタグを付ける。行の形は `app/db/icons.ts` の `newIconRow` に
  一本化されていて、本体の `POST /icons` もシナリオも同じ関数を通る。
- 認証は迂回しない。ログインは `app/auth/` の **AuthProvider**（`resolve / signIn / signOut`）を通してだけ行う。
  シナリオ route は `auth.signIn(c, user)` / `auth.signOut(c)` を呼ぶだけで、Cookie やミドルウェアには触れない。
  - **`DEV_BYPASS_AUTH` が有効なとき**（ローカル開発）は `bypassAuth` が選ばれる。シナリオごとに使い捨てユーザ
    `scenario-<name>-<random>` を作って `signIn` する。`bypassAuth` はそれを署名付き Cookie `dev_impersonate`
    に書き、以後のリクエストをそのユーザとして解決する（署名が合わなければ従来の Dev User に戻る）。
    `public-icon` は `signOut` でログアウト状態（既存の `dev_guest=1`）にする。
  - **バイパスが無効なとき**（本番）は `sessionAuth` が選ばれ、`dev_impersonate` / `dev_guest` は一切読まれない
    （`app/auth/auth.test.ts` で固定）。シナリオはログイン中のユーザ自身のアカウントに隔離データを追加するだけ。
    未ログインなら 303 で一覧に戻り理由を表示（JSON は 401 と `loginUrl`）。
    新規ユーザが必要な `empty` は実行不可として一覧に表示（JSON は 409）。
    `public-icon` は所有者として表示される（JSON の `viewer` が `"user"`）。

## Chrome MCP からの使い方

1. `navigate` で `http://localhost:5173/__scenarios/typical` を開く。
   データが作られ、`/icons` に 303 で遷移した状態からテストを始められる。
2. 作成した ID を辿りたいときは `?format=json` を fetch する（Cookie も同時にセットされる）:

```
GET /__scenarios/editor-complex?format=json
{
  "scenario": "editor-complex",
  "tag": "scenario-editor-complex-ed300c",
  "redirectTo": "/icons/8083fccf-.../edit",
  "user": { "id": "scenario-editor-complex-ed300c", "mode": "scenario-user" },
  "viewer": "user",
  "icons": [{ "id": "8083fccf-...", "name": "scenario-editor-complex-ed300c complex",
              "isPublic": false, "editUrl": "/icons/8083fccf-.../edit", "showUrl": "/i/8083fccf-..." }]
}
```

3. 別のシナリオを開くと impersonate Cookie が差し替わり、そのシナリオのユーザに切り替わる。
   通常の Dev User に戻すには `/auth/google` を開く（バイパス時は Dev User として `signIn` するだけ）。
   `/auth/logout` でログアウト状態になる。

## curl での確認

```sh
curl -i http://localhost:5173/__scenarios/typical          # 303 + Set-Cookie
curl -s http://localhost:5173/__scenarios/large?format=json | jq .icons[0]
```

## 追加するには

`app/scenarios/<name>.ts` に `Scenario` を 1 つ export し、`app/scenarios/index.ts` の `SCENARIOS` に並べる。
`build()` は純関数（ランダム値と時刻は `BuildContext` で受け取る）にしておくと、
`app/scenarios/scenarios.test.ts` の共通テストがそのまま効きます。

## ハンドラを DB なしでテストする

`createApp({ auth })` に `fixedAuth(user)` を渡すと、Cookie も OAuth も DB も無しに「このユーザでログイン中」の
リクエストを組み立てられる（`app/server.test.ts` 参照）。
