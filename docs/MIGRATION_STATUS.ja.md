# 独立Web候補の状況

本体Webは削除しません。最新仕様は[共存手順](COEXISTENCE.ja.md)です。
本体Webは`uagw`のまま維持し、独立版を`uaga`、A2Aを`uaga2a`で起動する案です。
両Webの同時起動はサポートしません。

## 実装

- Svelteと専用FastAPI/WSホストを`uag_web`に配置。
- 共通のAgent・Memory・Session・認証・Sandbox・OTelはUAGを利用。
- 独立版のビルド先は`src/uag_web/static`。本体にも既存UIを維持。
- 本体PR #330のホストコールバックAPIはマージ済み。
- UAG 0.7.42に既存OTel所有権照会の公開APIを追加する小規模PRを準備。
  旧Webを削除するPR #331は取り下げ済み。
- 独立版は`uaga`を所有。本体Webの`uagw`は変更せず、A2Aを`uaga2a`へ改名する。
  機能・モジュール起動は維持し、変更案はdraftでレビューする。
- CIで旧UAGからの導入と独立版アンインストールを検証。本体Web・既存コマンドの
  保持、独立版のHTTP/static/auth、配布物を検査する。

## 検証と公開前の条件

Webの全HTTP/WSルートを元インベントリと照合し、旧Web未importも検証する。
pytest、Nodeテスト、Black/Ruff、ビルド・導入検証の最新結果はPRに記録する。
Windows/Linux/macOSのCIとCodexレビューを確認する。

UAG 0.7.42とこのパッケージは未公開。必要な共通APIのリリースより先に独立版を
公開しない。実OIDC、実Provider会話、Web経由の実Sandbox、表示・音声の受け入れ、
CDN・フォントの配布方針と継承依存の監査対応は引き続き検証対象。
ZEN-LipSyncは未実装・未同梱。マージ・公開はユーザーが判断する。
