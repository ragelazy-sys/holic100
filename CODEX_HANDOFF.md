# Holic100 — 開発引き継ぎ

リポジトリ: `ragelazy-sys/holic100`。既存の隔離チェックアウトを使用し、依頼がない限りGit worktreeを作成しないでください。ZIPの再展開は不要です。

認証・ローカル起動・検証は `README.md` と `docs/cloudflare-auth.md` に従ってください。静的サーバーだけでは認証できません。Secretや `.dev.vars` の値を出力・コミットしないでください。ゲームルールの変更、本番デプロイ、mainへのマージ、Pages設定変更は明示的に依頼された範囲でのみ実行してください。

## 確定ルール
- 人間1人＋CPU3人、58枚、手札は固定4スロット（自動ソート禁止）。
- 自分のターンで100未満を保てるカードが1枚もない場合は出札前に自動脱落。Holic100は例外なし（出すと即バースト）。
- Doubleの1枚目は数字札1〜10または−10。2枚目は自由。
- **Change 2:** 出札位置に補充→相手指名→自分の渡す2枚を指定→相手の裏向きの元の4スロットから2枚を選択→確定後に交換。人間は対象CPUの裏札をタップして選択し、CPUは相手の内容を覗かずに2スロットをランダム抽出する。選択されなかった位置は不変。
- Change 4は4スロットの全交換。
- 人間がChangeを受ける前には通知ダイアログを表示。人間が脱落したら通知し、CPU同士の対戦を最後まで観戦可能。

## 認証版の検証

- `npm ci`、`npm run setup:local`、D1ローカルマイグレーション、`npm test`、`npm run build`、`npm run serve`。
- `tools/auth-smoke.mjs`：未認証配信拒否、ログイン、改ざん／期限切れ、失効、ログアウト、レート制限、iPad配置、オフライン拒否。
- `tools/auth-sw-migration.mjs`：旧キャッシュ型Workerの置換と未認証画面の除去。
- 旧 `tools/browser-smoke.cjs`／`sw-update-smoke.cjs` はオフライン許可を前提とする過去の検証用です。
- 実Cloudflare側のProduction／PreviewのSecret、D1、fail_open=falseは公開前に確認。今回のPR作成では公開しないでください。
