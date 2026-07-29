# THREE_TOOL_COMPATIBILITY_REPORT — PDF／Excel → JSON α版 v0.10.1-alpha ↔ 照合ツール

対象3ツール:

- 仕様書PDF → JSON 変換 α版（`pdf_tool/spec_to_json_conversion_tool_alpha_v0.10.1.html`）
- Excel → JSON 変換 α版（`excel_tool/excel_to_json_conversion_tool_alpha_v0.10.1.html`）
- 照合ツール（`tools/json_ab_trace_matching_tool_v12.1.15.html`。**本α版の対象外であり、無改変。**
  本レポートの検証はすべて、照合ツール側の正本ロジック（`quantity_sidecar_binding_core.js`等）を
  実際に呼び出して行っており、照合ツール自体のコードは一切変更していません）

**本レポートは「完全互換」を宣言するものではありません。** 生成側（PDF／Excel）と照合ツール側で、
それぞれ何が実装済みで何が未実装かを分けて記載します。

## 元指摘ごとのトレーサビリティ（簡易レビュー時点 → 本レポート時点）

「簡易レビュー時点」列は、Checkpoint 1着手前に別AIレビューで指摘された内容です。下2件は、
その指摘には含まれておらず、Checkpoint 1・5Bの検証作業の過程で新たに発見・修正したものです。

| 元の指摘 | 簡易レビュー時点 | 本レポート時点 | 根拠 |
|---|---|---|---|
| PDF quantity signature mismatch | 条件付き互換／要修正（FAIL、`source_mismatch`等の診断あり） | **FIXED** | `pdf_checkpoint1_verification.js`: 実binding core呼び出しで`ready === true`・`diagnostics`0件 |
| Excel quantity sidecar missing | 未実装 | **FIXED**（実装済み） | `excel_checkpoint3_verification.js`: PDFと同一binding-coreで`ready === true`・`diagnostics`0件 |
| 共通タグ辞書不一致 | 部分互換 | **FIXED** | `shared_tag_vocabulary_verification.js`: PDF/Excel出力のvocabulary_id/version一致、独立再計算sha256一致 |
| Excel AI metadata欠落 | 欠落あり | **FIXED** | `excel_checkpoint2_verification.js`: 4入力経路すべてでai_reviewed等5項目保持を確認 |
| PDF AI入力ReferenceError | 元指摘に含まれず（Checkpoint 1で発見） | **FIXED** | `pdf_checkpoint1_verification.js`: 全recordでsource_content欠落0件 |
| Excel trace_text "false"混入 | 元指摘に含まれず（Checkpoint 5のfixture再生成時に発見） | **FIXED** | `checkpoint5b_verification.js`: 6境界値検査・mutation検査 24/24 |

## 生成側（PDF／Excel）↔ 照合ツール 現状サマリ

| 項目 | 状態 | 根拠 |
|---|---|---|
| 基本Trace照合（`_trace_records`のtrace_id/trace_text/tags等の構造） | 互換 | PDF/Excelとも照合ツールが要求する`trace_format`/`schema_version`/`_trace_records`構造で出力。照合ツール自体のコードは無改変のまま使用 |
| quantity sidecar binding | PDF/Excel双方で互換 | 照合ツール正本の`quantity_sidecar_binding_core.js`（検証用に`tools/alpha_release/_reference_binding_core/`へ複製し、実ファイルとのSHA-256一致をfail-closedで検証済み）を実際に呼び出し、`bindSide()`が`ready === true`・`diagnostics`0件を返すことをPDF側（`pdf_checkpoint1_verification.js`）・Excel側（`excel_checkpoint3_verification.js`）双方で確認 |
| 共通tag vocabulary出力（`tag_vocabulary.vocabulary_id`/`vocabulary_version`/`vocabulary_sha256`） | PDF/Excel間で互換 | PDF/Excel両ツールの出力で`vocabulary_id`/`vocabulary_version`が一致し、`vocabulary_sha256`が実際に有効なtag_policyから独立再計算した値と一致することを確認（`shared_tag_vocabulary_verification.js`） |
| 照合ツールによるvocabulary metadata診断（`vocabulary_sha256`不一致の検出・表示） | 未実装 | 照合ツール本体に`vocabulary_sha256`/`tag_vocabulary`関連の参照が存在しないことを確認（0件） |
| AI metadata | PDF/Excel出力には存在（`ai_reviewed`等5項目）。照合ツールでは専用UI/判定契約未実装 | PDF/Excelとも照合用JSON出力の各レコードのトップレベルに保持され、人手確認状態（`review_status`等）とは独立して維持されることを確認。照合ツール本体に`ai_reviewed`関連の参照が存在しないことを確認（0件） |

上表の「未実装」2項目（照合ツールによるvocabulary metadata診断、AI metadata専用UI/判定契約）は
照合ツール自体の改修が必要な項目であり、本α版（PDF／Excel生成側）の対象外です。
生成側は照合ツールが将来これらを実装する際に必要なmetadata（`ai_reviewed`系5項目、
`tag_vocabulary.vocabulary_sha256`）を出力に含めていますが、照合ツール側での実際の
利用・表示・診断機能自体はまだ存在しません。

## 明示的に断定しないこと

- 「PDF／Excel／照合ツールが完全互換である」とは断定しません。上表のとおり、生成側が出力する
  metadataを照合ツール側がまだ活用しきれていない領域（AI metadata専用UI、vocabulary identity
  診断）が明確に残っています。
- 実Chrome／Edgeでの3ツール間の手動E2E確認（同一ブラウザで生成→照合という一連の操作を人手で
  実施する確認）は行っていません。本レポートの根拠はすべて、各ツールの正本ロジックを実際に
  呼び出した自動検証（Playwright／Chromium）です。

## 検証根拠（自動検証スクリプト）

- `pdf_checkpoint1_verification.js` — PDF側のAI回答fail-closed拒否、quantity sidecar binding-core検証を含む81件
- `excel_checkpoint2_verification.js` — Excel側AI metadata保持（4入力経路）55件
- `excel_checkpoint3_verification.js` — Excel側quantity sidecar binding-core検証40件
- `shared_tag_vocabulary_verification.js` — 共通tag vocabulary生成・fail-closed検証47件
- `checkpoint5b_verification.js` — Excel trace_text境界値・mutation検証24件
- `checkpoint6_smoke_test.js` — 実ブラウザでの一括スモーク確認（`SMOKE_TEST_REPORT.md`参照）

いずれも本レポート作成時点の実行結果として、回帰検査を含め全件成功しています。

## 最終判定

- 生成側（PDF／Excel）の観点では、元指摘6件（本α版のスコープ内で発見された2件を含む）はすべて
  **FIXED**です。
- 3ツール全体（PDF／Excel／照合ツール）としては、**「完全互換」ではありません**。照合ツール側の
  AI metadata専用UI・vocabulary identity診断が未実装のまま残っているためです。
