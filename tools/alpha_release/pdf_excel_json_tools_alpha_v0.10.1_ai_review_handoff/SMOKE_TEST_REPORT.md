# SMOKE_TEST_REPORT — PDF／Excel → JSON 変換 α版 v0.10.1-alpha

実行日時: 2026-07-29T13:12:41.023Z

## 試験環境

- OS: linux 6.18.5 (x64)
- Node.js: v22.22.2
- Playwright: 1.56.1
- 使用ブラウザ: Chromium 141.0.7390.37（Playwright経由。実Chrome／実Edgeでの手動確認は未実施 — 詳細はKNOWN_LIMITATIONS.mdを参照）
- 起動方式: `file://`（ZIP展開後、同梱`vendor`フォルダとの相対位置関係を維持した状態）
- 外部networkリクエストは全てのテストで`page.route`により実行時に監視・遮断した状態で実施（CDN等へ実際に到達できるかではなく、遮断状態でツールが動作を継続できるかを確認）

## 試験結果サマリ

| 領域 | 試験項目 | 結果 |
|---|---|---|
| PDF | PDF変換: sample_input.pdf(構造化) | PASS |
| PDF | sample_input.pdf(構造化): 外部networkリクエスト0件 | PASS |
| PDF | sample_input.pdf(構造化): pageerror 0件 | PASS |
| PDF | sample_input.pdf(構造化): console error 0件 | PASS |
| PDF | PDF変換: sample_input_table.pdf(表) | PASS |
| PDF | sample_input_table.pdf(表): 外部networkリクエスト0件 | PASS |
| PDF | sample_input_table.pdf(表): pageerror 0件 | PASS |
| PDF | sample_input_table.pdf(表): console error 0件 | PASS |
| PDF | PDF変換: sample_input_unextractable.pdf(抽出不能) | PASS |
| PDF | sample_input_unextractable.pdf(抽出不能): OCR CDNへの想定内の外部リクエスト試行1件(遮断済み) | PASS |
| PDF | sample_input_unextractable.pdf(抽出不能): pageerror 0件 | PASS |
| PDF | sample_input_unextractable.pdf(抽出不能): 想定外のconsole errorが0件(遮断による1件のFailed to load resourceのみ許容) | PASS |
| PDF | AI入力JSON保存: records配列が存在し1件以上 | PASS |
| PDF | AI入力JSON保存: 外部networkリクエスト0件 | PASS |
| PDF | AI連携: pageerror 0件 | PASS |
| PDF | AI連携: console error 0件 | PASS |
| PDF | quantity sidecar: 照合用JSON+数量注釈JSONの2ファイルが1操作で生成される | PASS |
| PDF | quantity sidecar: 外部networkリクエスト0件 | PASS |
| PDF | quantity sidecar: pageerror 0件 | PASS |
| PDF | quantity sidecar: console error 0件 | PASS |
| PDF | 共通タグ辞書読込: 外部networkリクエスト0件 | PASS |
| PDF | 共通タグ辞書読込: pageerror 0件 | PASS |
| PDF | 共通タグ辞書読込: console error 0件 | PASS |
| Excel | Excel変換: sample_input.xlsx | PASS |
| Excel | Excel変換: 外部networkリクエスト0件 | PASS |
| Excel | Excel変換: pageerror 0件 | PASS |
| Excel | Excel変換: console error 0件 | PASS |
| Excel | AI入力JSON保存: records配列が存在し1件以上 | PASS |
| Excel | AI入力JSON保存: 外部networkリクエスト0件 | PASS |
| Excel | AI連携: pageerror 0件 | PASS |
| Excel | AI連携: console error 0件 | PASS |
| Excel | quantity sidecar: 照合用JSON+数量注釈JSONの2ファイルが1操作で生成される | PASS |
| Excel | quantity sidecar: 外部networkリクエスト0件 | PASS |
| Excel | quantity sidecar: pageerror 0件 | PASS |
| Excel | quantity sidecar: console error 0件 | PASS |
| Excel | 共通タグ辞書読込: 外部networkリクエスト0件 | PASS |
| Excel | 共通タグ辞書読込: pageerror 0件 | PASS |
| Excel | 共通タグ辞書読込: console error 0件 | PASS |

合計 38件中 38件成功

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
