# 独立版uagavの状況

最新仕様は[共存手順](COEXISTENCE.ja.md)です。本体は変更しません。
本体Webの`uagw`、A2Aの`uaga`を残し、独立版だけを`uagav`で起動します。
本体変更案#331・#332は閉じたままです。#330はマージ済みの状態を維持します。

Svelteと専用FastAPI/WSを`uag_web`に配置し、共通のAgent・Memory・Session・
認証・Sandbox・OTelはUAGをライブラリとして利用します。
本体mainの受け入れ済みコミットを固定して使い、必要な機能を本体に追加しません。
本体Web・UI・既存コマンドの削除や改名は行いません。

CIではWindows/Linux/macOSでpytest、Nodeテスト、Black/Ruff、ビルド、
旧UAGからの導入・独立版削除を検証します。本体の既存uagw/uagaが保持されることと、
独立版のHTTP/static/auth、コマンド所有権、配布物を検査します。

開発版のGit依存は必要な#330 APIを自動導入するためのものです。PyPI公開前には
#330が含まれる既存UAGリリースへの依存へ変更し、公開Coreとの動作を検証します。
本体のコード・バージョン・コマンド・公開設定を変更するPRは作成しません。

実OIDC、実Provider会話、Web経由の実Sandbox、表示・音声、CDN/フォント配布方針と
継承依存監査は未完了です。標準の声・アバターは[専用手順](AVATAR.ja.md)で
利用環境に別途導入します。SDK・モデル・素材はリポジトリ・配布物に同梱しません。
マージ・公開はユーザーが判断します。
