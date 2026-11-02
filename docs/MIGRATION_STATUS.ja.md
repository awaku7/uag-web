# 移行候補の検証状況

調査基準: agentcli main `7523ee1a9a4d238ba0a964862c9eecdba8f58e05`。
前提API: [agentcli PR #330](https://github.com/awaku7/agentcli/pull/330)
はmainへマージ済み。後続の本体0.7.42準備PRで旧Webと重複entry pointを除き、
OTel所有権参照を公開API化する。独立版はその版を依存下限とする。

## 完了したローカル検証

- Svelteを独立配置し、`npm ci`、`npm run build`、既存Nodeテストが成功。
- Web固有FastAPI/WS/room/workerコードを`uag_web`へ移植。
  共通認証・Memory・Session・Sandbox・OTel実装は`uag`を利用する。
- 本体に混在していたWebテストも追加移管。最新の件数とCI結果はPRに記録。認証、Origin、アクセス制御、
  human_ask、復元、並列spawn、Sandbox RPCとOTelの既存モック検証を含む。
- pinned Black/Ruff成功。wheel/sdist作成、wheelの依存/entry point/静的ファイル検査が成功。
- wheelを別ディレクトリにインストールし、旧Web未import、HTTPトップページ、
  JS配信、ローカル認証statusの検証が成功。
- 既存設定を与えた`uagw`の実サーバー起動でHTTP 200を確認。
  LLMへの会話・実OIDC IdP・実MXC Sandboxはこの起動確認では検証していない。
- 全既存HTTP/WSルートを移行前インベントリと比較し、一致を確認。

## 未完了とリリース条件

- 初回候補のWindows/Linux/macOS CIとCodexレビューは完了。
  本体0.7.42への切替後も再実行する。
- 本体0.7.42とこのWebパッケージのリリースは未実施。
  `uag>=0.7.42`の公開前にはWebを公開しない。
- 実OIDC/実Sandbox/実Providerの受け入れ、モバイルと多言語表示の目視確認。
- 既存Tailwind CDN/Google Fonts/プレビュー内CDNの同梱方針と表示互換の検証。
  現状は依存を維持し、オフライン対応済みとはしていない。
- OTel所有権参照は`get_trace_ownership_state`の公開APIへ変更済み。
- 本体整理PRのwheel/sdistでUI非同梱を検査。実環境受け入れ後に
  ユーザーが本体整理PRとWeb初回PRのマージを判断する。
- PyPIへの公開は未実施。ZEN-LipSyncは未実装・未同梱。

新リポジトリは空だったため、mainへの直接コミットを避け、空コミットの
`repository-baseline`を比較元として初回PRを作成する。マージはユーザー判断。
初回マージ後の既定ブランチ名はユーザーと整合してmainへ変更する。
