# 本体Webと独立Webの使い分け

本体Webの実装・フロントエンド・静的ファイル・テンプレートは残します。
独立版を追加パッケージとして用意し、同時起動はサポートしません。

| コマンド | 起動するアプリケーション |
| --- | --- |
| `uag-web` / `python -m uag_web` | 独立版Web |
| `uagw` / `python -m uagent.web` | 従来の本体Web |
| `uaga` | 従来のA2Aサーバー |

`pip install uag-web`で独立版と必要なUAGを導入します。
独立版が登録するconsole scriptは`uag-web`だけです。本体の`uagw`や`uaga`は
上書きしません。`pip uninstall uag-web`後も本体Webと既存コマンドは残ります。

独立版は公開OTel照会APIを含むUAG 0.7.42以降に依存します。
本体Webの削除を含んだPR #331は取り下げ済みです。過去の移行文書にある
「本体Webの削除」「本体UIの非同梱」「独立版をuagwで起動」は旧方針です。

両Webの既定ポートは8000です。片方を停止してからもう片方を起動してください。
追加のポートや常駐サービスは導入しません。認証・Origin・Sandboxの設定も
変更しません。ZEN-LipSyncは今回の実装対象外です。

公開前には実OIDC、実Provider会話、Web経由の実Sandbox、表示・音声の
受け入れと、CDN・フォントの配布方針の検証が必要です。
