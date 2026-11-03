# 起動名の変更案（レビュー用）

本体Webは残します。独立版の起動名を`uaga`（avatar）にするため、
既存A2Aのコマンド名を`uaga2a`へ改める案です。まだ未マージ・未公開です。

| コマンド | アプリケーション |
| --- | --- |
| `uaga` / `python -m uag_web` | 独立版Web |
| `uagw` / `python -m uagent.web` | 従来の本体Web（変更なし） |
| `uaga2a` / `python -m uagent.a2a.server` | A2A（モジュール起動は変更なし） |

導入は`pip install uag-web`です。必要なUAGも依存関係として導入します。
UAG 0.7.42候補でA2Aコマンド名と公開OTel APIを整理し、同名コマンドを
両パッケージが所有しない構成にします。旧A2Aスクリプトの`uaga`呼び出しは
`uaga2a`へ変更が必要です。A2AのHTTP機能・オプションは維持します。

`pip uninstall uag-web`後も、本体Web・`uagw`・`uaga2a`は残ります。
両Webの既定ポートは8000で、同時起動はサポートしません。片方を停止してから
切り替えます。追加ポートや常駐サービスは導入しません。

旧Web削除のPR #331は取り下げ済み。認証・Origin・Sandbox設定は変更しません。
実OIDC/実Provider/Web経由の実Sandbox、表示・音声の受け入れ、CDNとフォントの
配布方針は引き続き検証対象です。ZEN-LipSyncは今回実装・同梱しません。
