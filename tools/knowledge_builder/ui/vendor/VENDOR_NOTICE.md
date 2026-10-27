# 同梱ライブラリ (Vendored library)

このディレクトリには、Knowledge Data Builder α0.2.0 Checkpoint 2（Excel直接入力）が実行時に
読み込む JavaScript ライブラリを、CDN の代わりにローカル同梱しています。

## SheetJS (xlsx)

| 項目 | 値 |
|---|---|
| ライブラリ名 | xlsx (SheetJS Community Edition) |
| バージョン | 0.18.5 |
| ファイル | `xlsx.full.min.js` |
| 取得元 | 本リポジトリ内 `tools/release/vendor/xlsx-0.18.5/xlsx.full.min.js`（PDF/Excel変換ツールの
既存alpha配布物 `excel_tool/vendor/xlsx.full.min.js` と同一バイト列。バイト単位で複製） |
| SHA-256 (xlsx.full.min.js) | `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99` |
| ライセンス | Apache License 2.0（`xlsx-LICENSE.txt` に全文同梱） |
| SHA-256 (xlsx-LICENSE.txt) | `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64` |

## 同梱の理由

Knowledge Data Builderは、既存のPDF/Excel変換ツールと同様に、CDN依存ゼロ・`file://`起動・
完全オフライン動作を前提とする単体HTMLツールである。Excel直接入力（Checkpoint 2）を追加するに
あたり、Excel解析ライブラリ(xlsx)をこのディレクトリへ相対パスで同梱し、`core/excel_direct_adapter.js`
から読み込む。既存のExcel→JSON変換ツール本体・その配布物・そのvendorディレクトリは一切変更していない
（本ディレクトリは完全に独立したコピー）。

`node_modules`・`package.json`・`package-lock.json` 等、npmパッケージ管理由来のファイルはここにも
含めていない。同梱しているのは実行に必要な `xlsx.full.min.js` とそのライセンス全文
(`xlsx-LICENSE.txt`) のみ。
