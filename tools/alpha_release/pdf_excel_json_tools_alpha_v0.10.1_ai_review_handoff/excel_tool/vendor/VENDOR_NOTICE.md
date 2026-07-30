# 同梱ライブラリ (Vendored library)

このディレクトリには、Excel → JSON 変換 α版 (`excel_to_json_conversion_tool_alpha_v0.1.0.html`) が
実行時に読み込む JavaScript ライブラリを、CDN (`cdn.jsdelivr.net`) の代わりにローカル同梱しています。

## SheetJS (xlsx)

| 項目 | 値 |
|---|---|
| ライブラリ名 | xlsx (SheetJS Community Edition) |
| バージョン | 0.18.5 |
| ファイル | `xlsx.full.min.js` |
| 取得元 | npm registry (`https://registry.npmjs.org/xlsx/-/xlsx-0.18.5.tgz`) の `dist/xlsx.full.min.js` |
| 参照元との一致 | 基準ツール `excel_to_json_conversion_tool_v2.0.8.html` が読み込む CDN URL (`https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js`) と同一バージョン。バイト内容はnpm配布物由来（CDN配布物とのbyte比較は本環境から`cdn.jsdelivr.net`へ到達できないため未実施） |
| SHA-256 (xlsx.full.min.js) | `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99` |
| ライセンス | Apache License 2.0（`xlsx-LICENSE.txt` に全文同梱） |
| SHA-256 (xlsx-LICENSE.txt) | `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64` |

## 同梱の理由

基準ツール v2.0.8 はこのライブラリを `cdn.jsdelivr.net` から実行時取得する構成です。本セッションの
実行環境では組織のegressポリシーにより `cdn.jsdelivr.net` への接続が拒否され（プロキシから403）、
CDN方式のままではオフライン・制限ネットワークで本ツールが一切動作しないことが判明しました。
そのため、α版では同一バージョンのライブラリをZIP配布物内へ同梱し、相対パスで読み込む方式に変更して
います。この変更は `<script src="...">` の参照先1行のみであり、Excel→JSON変換ロジック本体
（`convertSheet`・`convertCellValue`・`mapRowWithProfile`・`buildTraceOutput` 等）は無改変です。

`node_modules`・`package.json`・`package-lock.json` 等、npmパッケージ管理由来のファイルは配布物・
リポジトリのいずれにも含めていません。同梱しているのは実行に必要な `xlsx.full.min.js` と
そのライセンス全文 (`xlsx-LICENSE.txt`) のみです。
