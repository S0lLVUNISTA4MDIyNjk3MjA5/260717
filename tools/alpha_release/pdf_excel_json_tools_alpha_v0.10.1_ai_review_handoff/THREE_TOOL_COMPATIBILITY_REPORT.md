# THREE_TOOL_COMPATIBILITY_REPORT — PDF／Excel → JSON α版 v0.10.1-alpha ↔ 照合ツール

対象3ツール:

- 仕様書PDF → JSON 変換 α版（`pdf_tool/spec_to_json_conversion_tool_alpha_v0.10.1.html`）
- Excel → JSON 変換 α版（`excel_tool/excel_to_json_conversion_tool_alpha_v0.10.1.html`）
- 照合ツール（`tools/json_ab_trace_matching_tool_v12.1.15.html`。**本α版の対象外であり、無改変。**
  本レポートの検証はすべて、照合ツール側の正本ロジック（`quantity_sidecar_binding_core.js`等）を
  実際に呼び出して行っており、照合ツール自体のコードは一切変更していません）

**本レポートは「完全互換」を宣言するものではありません。** 生成側（PDF／Excel）と照合ツール側で、
それぞれ何が実装済みで何が未実装かを分けて記載します。

## 前回（簡易レビュー時点）からの変化

| 項目 | 簡易レビュー時点 | 本レポート時点（v0.10.1-alpha） |
|---|---|---|
| PDF sidecar | FAIL（`source_mismatch`等の診断あり） | 互換（後述の検証で診断0件を確認） |
| Excel sidecar | 未実装 | 実装済み・互換（後述の検証でPDFと同一binding-coreにより確認） |
| 共通tag vocabulary | 部分互換 | 互換（後述の検証でPDF/Excel双方の出力一致・独立ハッシュ再計算一致を確認） |
| Excel AI metadata | 欠落あり | 全4入力経路で保持されることを確認済み（`excel_checkpoint2_verification.js`） |

## 生成側（PDF／Excel）↔ 照合ツール 互換性サマリ

| 項目 | 状態 | 根拠 |
|---|---|---|
| 基本照合（`_trace_records`のtrace_id/trace_text/tags等の構造） | 互換 | PDF/Excelとも照合ツールが要求する`trace_format`/`schema_version`/`_trace_records`構造で出力。照合ツール自体のコードは無改変のまま使用 |
| quantity sidecar binding | PDF/Excel双方で互換 | 照合ツール正本の`quantity_sidecar_binding_core.js`（検証用に`tools/alpha_release/_reference_binding_core/`へ複製し、実ファイルとのSHA-256一致をfail-closedで検証済み）を実際に呼び出し、`bindSide()`が`ready === true`・`diagnostics`0件を返すことをPDF側（`pdf_checkpoint1_verification.js`）・Excel側（`excel_checkpoint3_verification.js`）双方で確認 |
| 共通語彙metadata生成（`tag_vocabulary.vocabulary_id`/`vocabulary_version`/`vocabulary_sha256`） | 互換 | PDF/Excel両ツールの出力で`vocabulary_id`/`vocabulary_version`が一致し、`vocabulary_sha256`が実際に有効なtag_policyから独立再計算した値と一致することを確認（`shared_tag_vocabulary_verification.js`） |
| AI metadata保持（`ai_reviewed`等5項目） | 可能 | PDF/Excelとも照合用JSON出力の各レコードのトップレベルに保持され、人手確認状態（`review_status`等）とは独立して維持されることを確認 |

## 照合ツール側で未実装の項目（生成側の対応状況に関わらず、現時点で存在しない機能）

| 項目 | 状態 | 根拠 |
|---|---|---|
| AI metadata専用の表示・フィルタ | 未実装 | 照合ツール本体に`ai_reviewed`関連の参照が存在しないことを確認（`grep -c ai_reviewed`で0件） |
| 共通tag vocabularyのidentity診断（`vocabulary_sha256`不一致の検出・表示） | 未実装 | 照合ツール本体に`vocabulary_sha256`/`tag_vocabulary`関連の参照が存在しないことを確認（0件） |

これらは照合ツール自体の改修が必要な項目であり、本α版（PDF／Excel生成側）の対象外です。
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
- `checkpoint6_smoke_test.js` — 実ブラウザでの一括スモーク確認（`SMOKE_TEST_REPORT.md`参照）

いずれも本レポート作成時点の実行結果として、回帰検査を含め全件成功しています。
