# SMOKE_TEST_REPORT — PDF／Excel → JSON 変換 α版 v0.10.1-alpha

実行日時: 2026-07-29T21:34:00.240Z

## 試験対象

- commit: `fdc1fd676342abde2d029abdfd569995f0719042`（作業ツリーに未commitの変更あり）
- PDF HTML: `pdf_tool/spec_to_json_conversion_tool_alpha_v0.10.1.html`
- Excel HTML: `excel_tool/excel_to_json_conversion_tool_alpha_v0.10.1.html`

## 試験環境

- OS: linux 6.18.5 (x64)
- Node.js: v22.22.2
- Playwright: 1.56.1
- 使用ブラウザ: Chromium 141.0.7390.37（Playwright経由。実Chrome／実Edgeでの手動確認は未実施 — 詳細はKNOWN_LIMITATIONS.mdを参照）
- 起動方式: `file://`（ZIP展開後、同梱`vendor`フォルダとの相対位置関係を維持した状態）
- 外部networkリクエストは全てのテストで`page.route`により実行時に監視・遮断した状態で実施（CDN等へ実際に到達できるかではなく、遮断状態でツールが動作を継続できるかを確認）

## 全体サマリ（Network / Error 分類）

個々のシナリオ表の「外部network attempt 0件」は、そのシナリオ単体での試行回数が0件という
意味です。Checkpoint 7（offline hardening）でOCR CDN fallback経路自体を無効化した
ため、抽出不能PDFシナリオを含む全シナリオで試行回数が0件になっています。attempt数と
success数を混同しないよう、以下に全シナリオを通算した数値を明示します。

- external network attempts（全シナリオ合計）: 0件
- successful external network（実際に接続が成立した外部通信）: 0件
  （構造上100%保証: 本試験は全シナリオで`page.route('**/*', ...)`により外部リクエストを
  検出と同時に`route.abort()`で即時遮断しており、接続が成立する経路は存在しません）
- pageerror: 0件
- console error（想定外・製品由来）: 0件
- console error（想定内・診断/遮断由来）: 0件

## 試験結果サマリ

| 領域 | 試験項目 | 結果 |
|---|---|---|
| PDF | PDF変換: sample_input.pdf(構造化) | PASS |
| PDF | sample_input.pdf(構造化): 外部network attempt 0件 | PASS |
| PDF | sample_input.pdf(構造化): pageerror 0件 | PASS |
| PDF | sample_input.pdf(構造化): console error 0件 | PASS |
| PDF | PDF変換: sample_input_table.pdf(表) | PASS |
| PDF | sample_input_table.pdf(表): 外部network attempt 0件 | PASS |
| PDF | sample_input_table.pdf(表): pageerror 0件 | PASS |
| PDF | sample_input_table.pdf(表): console error 0件 | PASS |
| PDF | PDF変換: sample_input_unextractable.pdf(抽出不能) | PASS |
| PDF | sample_input_unextractable.pdf(抽出不能): 外部network attempt 0件 | PASS |
| PDF | sample_input_unextractable.pdf(抽出不能): pageerror 0件 | PASS |
| PDF | sample_input_unextractable.pdf(抽出不能): console error 0件 | PASS |
| PDF | sample_input_unextractable.pdf(抽出不能): OCR未対応PDFで偽の変換成功データを生成しない | PASS |
| PDF | AI入力JSON保存: records配列が存在し1件以上 | PASS |
| PDF | AI入力JSON保存: 外部network attempt 0件 | PASS |
| PDF | AI連携: pageerror 0件 | PASS |
| PDF | AI連携: console error 0件 | PASS |
| PDF | quantity sidecar: 照合用JSON+数量注釈JSONの2ファイルが1操作で生成される | PASS |
| PDF | quantity sidecar: 外部network attempt 0件 | PASS |
| PDF | quantity sidecar: pageerror 0件 | PASS |
| PDF | quantity sidecar: console error 0件 | PASS |
| PDF | 共通タグ辞書読込: 外部network attempt 0件 | PASS |
| PDF | 共通タグ辞書読込: pageerror 0件 | PASS |
| PDF | 共通タグ辞書読込: console error 0件 | PASS |
| Excel | Excel変換: sample_input.xlsx | PASS |
| Excel | Excel変換: 外部network attempt 0件 | PASS |
| Excel | Excel変換: pageerror 0件 | PASS |
| Excel | Excel変換: console error 0件 | PASS |
| Excel | AI入力JSON保存: records配列が存在し1件以上 | PASS |
| Excel | AI入力JSON保存: 外部network attempt 0件 | PASS |
| Excel | AI連携: pageerror 0件 | PASS |
| Excel | AI連携: console error 0件 | PASS |
| Excel | quantity sidecar: 照合用JSON+数量注釈JSONの2ファイルが1操作で生成される | PASS |
| Excel | quantity sidecar: 外部network attempt 0件 | PASS |
| Excel | quantity sidecar: pageerror 0件 | PASS |
| Excel | quantity sidecar: console error 0件 | PASS |
| Excel | 共通タグ辞書読込: 外部network attempt 0件 | PASS |
| Excel | 共通タグ辞書読込: pageerror 0件 | PASS |
| Excel | 共通タグ辞書読込: console error 0件 | PASS |

合計 39件中 39件成功（PDF 24件、Excel 15件の実assertion。「PASS」は個々のassertion結果であり、まとめて1件として記載しているものではありません）

## 深い機能検証との関係

本レポートは実行環境・外部networkリクエストの有無を含む「広く浅い」実ブラウザスモークテストです。
各機能のより詳細な検証（AI回答のfail-closed拒否、4入力経路でのAI確認情報保持、quantity sidecarの
binding-core突合せ、共通タグ辞書のfail-closed検証、trace_text境界値検証等）は、以下の各チェックポイント
検証スクリプトが担っています。

- `pdf_checkpoint1_verification.js`（81件）
- `excel_checkpoint2_verification.js`（55件）
- `excel_checkpoint3_verification.js`（40件）
- `shared_tag_vocabulary_verification.js`（47件）
- `checkpoint5_version_harmonization_verification.js`（73件）
- `checkpoint5b_verification.js`（24件）

「検証済み」と記載している項目は、上記スクリプトまたは本スモークテストにより実際に自動実行された
もののみです。手動でのChrome／Edge実機確認は本レポート作成時点で未実施です。
