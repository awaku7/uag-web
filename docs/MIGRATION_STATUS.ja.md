# 移行候補の検証状況

調査基準: agentcli main `7523ee1a9a4d238ba0a964862c9eecdba8f58e05`。
前提API: [agentcli PR #330](https://github.com/awaku7/agentcli/pull/330)
の`824412c393885ed72ecba662e766ddaf9926a030`。本体の旧Webは削除していない。

## 完了したローカル検証

- Svelteを独立配置し、`npm ci`、`npm run build`、既存Nodeテストが成功。
- Web固有FastAPI/WS/room/workerコードを`uag_web`へ移植。
  共通認証・Memory・Session・Sandbox・OTel実装は`uag`を利用する。
- Pythonテスト437成功・2スキップ。認証、Origin、アクセス制御、
  human_ask、復元、並列spawn、Sandbox RPCとOTelの既存モック検証を含む。
- pinned Black/Ruff成功。wheel/sdist作成、wheelの依存/entry point/静的ファイル検査が成功。
- wheelを別ディレクトリにインストールし、旧Web未import、HTTPトップページ、
  JS配信、ローカル認証statusの検証が成功。
- 既存設定を与えた`uagw`の実サーバー起動でHTTP 200を確認。
  LLMへの会話・実OIDC IdP・実MXC Sandboxはこの起動確認では検証していない。
- 全既存HTTP/WSルートを移行前インベントリと比較し、一致を確認。

## 未完了とリリース条件

- GitHubのWindows/Linux/macOS CIとCodexレビューを完了させる。
- 本体APIのリリース後、`pyproject.toml`の依存下限をその版へ上げる。
  現状の最低指定版0.7.41には新APIがないため、そのまま公開してはならない。
- 本体の`uagw`とのentry point競合を後続の本体整理PRで解消する。
- 実OIDC/実Sandbox/実Providerの受け入れ、モバイルと多言語表示の目視確認。
- 既存Tailwind CDN/Google Fonts/プレビュー内CDNの同梱方針と表示互換の検証。
  現状は依存を維持し、オフライン対応済みとはしていない。
- OTelの`_runtime_state`参照は公開読み取りAPI化を後続で検討する。
- 新Webの受け入れ後に本体からWebコードと配布成果物を削除し、
  本体wheel/sdistがUIを含まないことを検査する。
- PyPIへの公開は未実施。ZEN-LipSyncは未実装・未同梱。

新リポジトリは空だったため、mainへの直接コミットを避け、空コミットの
`repository-baseline`を比較元として初回PRを作成する。マージはユーザー判断。
初回マージ後の既定ブランチ名はユーザーと整合してmainへ変更する。
