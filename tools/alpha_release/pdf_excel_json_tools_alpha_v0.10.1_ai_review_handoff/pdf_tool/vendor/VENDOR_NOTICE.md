# 同梱ライブラリ (Vendored libraries)

このディレクトリには、仕様書PDF → JSON 変換 α版 (`spec_to_json_conversion_tool_alpha_v0.1.0.html`) が
実行時に読み込むJavaScriptライブラリ・データを、CDN（`cdnjs.cloudflare.com`・`unpkg.com`）の代わりに
ローカル同梱しています。

## PDF.js (pdfjs-dist)

| 項目 | 値 |
|---|---|
| バージョン | 3.11.174（基準ツールv1.18が参照するCDN版と同一版） |
| 取得元 | npm registry (`https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-3.11.174.tgz`) の `build/`・`cmaps/`・`standard_fonts/` |
| ライセンス | Apache License 2.0（`pdfjs/pdfjs-LICENSE.txt` に全文同梱） |
| 同梱ファイル | `pdfjs/pdf.min.js`、`pdfjs/pdf.worker.min.js`、`pdfjs/cmaps/`（169ファイル、Adobe CMap、`cmaps/LICENSE`同梱）、`pdfjs/standard_fonts/`（Foxit/Liberationフォント、`LICENSE_FOXIT`・`LICENSE_LIBERATION`同梱） |

## tiny-segmenter

| 項目 | 値 |
|---|---|
| バージョン | 0.2.0（基準ツールv1.18が参照するCDN版と同一版） |
| 取得元 | npm registry (`https://registry.npmjs.org/tiny-segmenter/-/tiny-segmenter-0.2.0.tgz`) の `dist/tiny-segmenter-0.2.0.js` |
| ライセンス | MIT（`tiny-segmenter/tiny-segmenter-LICENSE.txt` に全文同梱） |
| 用途 | タグ付与時の日本語形態素解析（利用できない場合は文字種フォールバックで動作する既存仕様） |

## SHA-256

チェックサムは同梱の `SHA256_MANIFEST.txt`（配布ZIP直下）に記録しています。

## 同梱の理由

基準ツールv1.18は、PDF.js・tiny-segmenterをそれぞれ`cdnjs.cloudflare.com`・`unpkg.com`から実行時取得
する構成です。本セッションの実行環境では組織のegressポリシーによりこれらのホストへの接続が拒否され、
CDN方式のままではオフライン・制限ネットワークで本ツールのPDF読込機能が一切動作しないことが判明しま
した。そのためα版では同一バージョンのライブラリをZIP配布物内へ同梱し、相対パスで読み込む方式に変更
しています。変更したのは次の5行のみです。

1. `<title>` の1行（α版表記に変更）
2. tiny-segmenterの`<script src>` 1行（相対パスへ変更）
3. `PDFJS_CDN_BASE` 定数の1行（相対パスへ変更）
4. `pdfJsGetDocumentOptionVariants`内のフォールバックURL 1行（オフラインで到達不能なunpkg.com URLを
   同一ローカルパスへ置換。複数オプションを試行する既存の耐性ロジック自体は変更していません）
5. 上記に付随するコメント行

Excel→JSON α版と同様、PDF→JSON変換ロジック本体（`extractPdf`・`extractPdfLayout`・
`buildJsonFromLines`・`v12ReviewCounts`・`scoreAgainstPdf`等）は無改変です。

`node_modules`・`package.json`・`package-lock.json` 等、npmパッケージ管理由来のファイルは配布物・
リポジトリのいずれにも含めていません。同梱しているのは実行に必要なファイルとライセンス全文のみです。

## 本α版で意図的に同梱していないもの（既知の制限）

- **Tesseract.js（OCR）**：スキャン画像PDFのテキスト抽出フォールバック用。本α版は「高度なOCR強化」を
  対象外としているため同梱していません。テキスト層抽出で十分な文字数が得られないPDFは、OCRへのCDN
  読み込みが失敗し、変換失敗として明示的に通知されます（`KNOWN_LIMITATIONS.md`参照）。
- **@huggingface/transformers（埋め込みモデル）**：照合ツール向けの意味的類似度比較機能で使用される
  もので、本α版の対象外（照合ツール連携は対象外）のため同梱していません。
