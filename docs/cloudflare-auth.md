# Cloudflare共通パスワード認証

## 配信の境界

`functions/_middleware.js` がすべてのパスを処理します。`tools/build.mjs` はゲーム用ファイルのみを `dist/` にコピーし、`_routes.json` を `include: ["/*"], exclude: []` で生成します。HTML、JS、CSS、Manifest、アイコンは認証必須です。HTMLの未認証リクエストは `/login` へ303、それ以外のゲーム資産は401です。本番とプレビューで処理を分岐させていません。

公開される例外はログイン画面、その画面だけの `/login.css`、ゲームを一切含まない `/sw.js` の旧キャッシュ削除用Workerです。旧Workerは未認証でも更新可能でなければキャッシュを消せません。このWorkerは認証バイパスをせず、すべての通信をサーバーへ渡します。設定欠落時も、この削除用Worker以外は503で拒否します。

パスワードはサーバー側のみでHMACの固定長比較を行います。CookieはHMAC-SHA256署名付き、発行／失効時刻とランダムnonceを含み、7日で失効します。`__Host-`、`HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`、Domain指定なしです。署名をホストのoriginと現在のパスワードに結び付け、別プレビュー／本番への流用やパスワード変更後の利用を拒否します。

D1にはCookieのHMAC識別子と失効日時だけを保存します。ログアウトでその記録を削除し、コピー済みCookieも失効させます。Cookieを消すだけのログアウトにはしていません。ログイン／ログアウトPOSTは同一Originのみ許可し、ログアウト時にブラウザのCookie、キャッシュ、保存データを削除します。保存対戦データも失われます。

パスワード未設定、32バイト未満の署名鍵、両Secretが同じ、D1やテーブル不備、D1障害、HTTPS以外は配信拒否です。秘密情報・フォームの値・Cookieをログへ出す処理はありません。

## 総当たり制限

D1の原子的なUPSERTをbatchで実行し、15分の固定窓あたりIP別10回、全体1000回を上限にします。正誤に関係なくログインPOSTをカウントし、超過は429です。各窓の境界では連続する2窓分までの試行があり得ます。Cloudflareが上書きする `CF-Connecting-IP` を使用し、IP自体は保存せずHMACに変換します。クライアントIP欠落や制限DBの障害時はログイン不可です。古いIP窓と期限切れセッションは削除します。

追加のCloudflare WAFレート制限も使用できますが、この実装はWAFや特定プランの有無に依存しません。分散攻撃時の全体制限により正規ユーザーも一時ログインできなくなる場合があります。

## 公開前に必要なCloudflare設定（今回未実施）

このPRは実装とローカル検証のみです。Cloudflareへのデプロイ、Secret登録、D1作成、実環境設定変更は行っていません。

1. Cloudflare Pagesにリポジトリを接続し、ビルドコマンド `npm ci && npm run build`、出力 `dist`、Node.js 24以降を指定します。**関数を含めたビルド**を使用してください。静的ファイルのみのアップロードは認証を迂回します。
2. ProductionとPreviewの両方で、暗号化されたSecret `HOLIC100_PASSWORD` と `HOLIC100_SESSION_SECRET` を登録します。署名鍵はパスワードとは別に、暗号学的乱数で32バイト以上を生成してください。実際の値をソース、README、通常の環境変数、ビルド引数、チャットやログへ記載しないでください。両環境の署名鍵は別々にします。
3. Production用／Preview用D1を作成し、それぞれを同じbinding名 `AUTH_DB` に割り当てます。`migrations/` の2つのマイグレーションを両DBに適用します。PagesのビルドではリモートDBを自動変更しません。
4. Functionsの実行不可・割当超過時にも静的配信へ迂回させないため、**ProductionとPreview双方の `deployment_configs.*.fail_open` を明示的に `false`** にします。Pages Project API向けの部分更新内容は `cloudflare-project-settings.json` にあります。これはWrangler設定ファイルではなく、保存しただけではCloudflareへ反映されません。既存の他設定を維持したまま適用してください。
5. キャッシュを上書きするCache Everythingなどのルールを設定しないでください。すべてのレスポンスにブラウザ／CDN両方の `no-store` を設定しています。Functions側から認証済みの静的資産を返す場合も同様です。
6. 将来の公開承認後、本番・各プレビューURLと独自ドメインで未認証のHTML／JS／CSS／Manifest／アイコン、ログイン、改ざん／失効、D1障害、レート制限を再検証してください。

`wrangler.example.jsonc` はDB設定例です。CLIで使用する場合はGit対象外の `wrangler.jsonc` へコピーし、実際のDB IDに置き換えます。ローカル用設定を本番へ使用しないでください。DashboardでD1を設定するGitビルドでも、binding名と両環境の設定は必須です。

Cloudflare API認証が利用できる管理環境では、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_PAGES_PROJECT`、`CLOUDFLARE_API_TOKEN` を安全に設定して `node tools/check-cloudflare-settings.mjs` を実行すると、両環境のfail-closed、D1、暗号化Secretの**メタデータだけ**を読み取り検証できます。APIレスポンスや秘密値は出力しません。この検証は未デプロイの動作を証明するものではありません。

## PWAと既存公開版

ホーム画面アイコン、Manifestの横画面指定、iPad用レイアウトは維持しています。新Workerは `holic100-*` キャッシュを削除し、旧タブをサーバー経由で再読込します。以後はネットワーク専用で、オフラインではゲームを返しません。開いている画面も通信断、画面復帰、30秒ごとのセッション確認失敗時にログイン画面へ移動します。

すでに配信済みのJavaScriptや、通信できない端末上の旧Workerを遠隔で取り消すことはできません。既存端末はオンラインで新Workerに更新してから保護が適用されます。別originである既存GitHub PagesのキャッシュはCloudflareから削除できません。

**GitHub Pagesの既存公開版は、このPRだけでは保護されません。** 今回は既存公開設定を変更していません。Cloudflareへの切替時には旧公開サイトを別途停止し、必要なら旧PWAのサイトデータを削除してください。公開GitHubリポジトリからのソース取得も、この配信認証の対象外です。

## ローカル検証の再実行

```bash
npm ci
npm run setup:local
npx wrangler d1 migrations apply AUTH_DB --local
npm test
npm run build
npm run serve
```

`setup:local` はローカル専用の使い捨てSecret、DB設定、OpenSSLで生成するテストTLS証明書を作成します。既存ファイルは上書きしません。いずれもGit対象外です。

ブラウザテストにはPlaywright／Chromiumが必要です。このクラウド環境では以下で指定できます。証明書の信頼は生成したローカル証明書に限定します。リモートサイトのTLS検証は無効化しません。

```bash
export PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright
export NODE_EXTRA_CA_CERTS="$PWD/.wrangler/local.crt"
export LOCAL_TLS_CERT="$PWD/.wrangler/local.crt"
export BASE_URL=https://127.0.0.1:8788
node tools/auth-smoke.mjs
node tools/auth-sw-migration.mjs
```

NodeのAPIリクエストは `NODE_EXTRA_CA_CERTS` でローカル証明書を信頼し、Chromiumは `LOCAL_TLS_CERT` の公開鍵だけをpinします。ブラウザの実行パスは `CHROMIUM_PATH` で変更できます。証明書の有効期限切れ時はローカルの証明書と鍵を両方作り直してください。

## 今回の結果

- Node.js 24で `npm test`: **51件成功、失敗0、スキップ0**。ゲームの既存33件（100対戦シミュレーション含む）、認証17件、Cloudflare設定preflight1件。
- Wrangler 4.152.0でローカルD1マイグレーション適用、Pages Functionsのコンパイル、認証ミドルウェア経由の配信を確認。
- Playwright/Chromium、タッチ有効、1024×768・1194×834で、未認証HTML・JS・CSS・Manifest・アイコンの拒否、正誤のログイン、Cookie属性、署名改ざん、署名済み期限切れCookie、リロード、ログアウトと失効Cookieの再利用拒否、オフライン配信拒否を確認。ゲーム・ログアウトボタンが画面内に収まり、JSエラー0（2シナリオ）。
- 実ローカルD1で10回の誤試行後、正しいパスワードでも11回目が429になることを確認（1シナリオ）。
- 旧キャッシュ型Workerから新Workerへの更新で、キャッシュ済みゲームを削除し、旧画面がログインへ戻り、JS／CSSが401になることを確認（1シナリオ）。
- ブラウザ計 **4シナリオ成功、最終失敗0**。当初の移行テストでローカル自己署名証明書による更新拒否を検出し、ローカル専用証明書の明示的な信頼／公開鍵pinを設定して再検証しました。
- Worker有効化処理の検証中、再読込の完了をactivate内で待つと、画面遷移側もactivate完了を待つため停止するケースを検出しました。キャッシュ削除とclaim後に再読込を開始し、その完了はactivate内で待たない方式に修正しました。
- `game.js` と `tests/game.test.js` に変更なし。Double、Change、B方式、自動脱落、観戦、58枚・固定4スロットの既存テストを維持。
- スクリーンショット: [1024×768](screenshots/auth/game-1024.png)、[1194×834](screenshots/auth/game-1194.png)。

未検証: 実CloudflareのSecret／D1／fail_open設定、本番・プレビューURLの実配信、Functions割当超過時の実挙動、iPad実機Safari、ホーム画面への実際の追加と更新。これらは本番公開前に確認が必要です。既存GitHub Pagesの停止も今回行っていません。
