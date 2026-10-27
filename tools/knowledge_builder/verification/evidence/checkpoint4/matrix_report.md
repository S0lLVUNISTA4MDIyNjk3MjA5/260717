# Checkpoint 4 - 全9入力組合せ 正式自動評価 結果

生成日時: 2026-08-02T21:26:23.460Z

| case_id | A | B | status | nodes | stmtA | stmtB | structural edges | candidate edges | active | rejected | operations | diag errors | console errors | ext requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a_pdf__b_pdf | pdf | pdf | PASS | 10 | 3 | 3 | 8 | 9 | 1 | 1 | 29 | 0 | 0 | 0 |
| a_pdf__b_excel | pdf | excel | PASS | 10 | 3 | 3 | 8 | 9 | 1 | 1 | 29 | 0 | 0 | 0 |
| a_pdf__b_trace | pdf | trace | PASS | 10 | 3 | 3 | 8 | 9 | 1 | 1 | 29 | 0 | 0 | 0 |
| a_excel__b_pdf | excel | pdf | PASS | 10 | 3 | 3 | 8 | 9 | 1 | 1 | 29 | 0 | 0 | 0 |
| a_excel__b_excel | excel | excel | PASS | 10 | 3 | 3 | 8 | 9 | 1 | 1 | 29 | 0 | 0 | 0 |
| a_excel__b_trace | excel | trace | PASS | 10 | 3 | 3 | 8 | 9 | 1 | 1 | 29 | 0 | 0 | 0 |
| a_trace__b_pdf | trace | pdf | PASS | 10 | 3 | 3 | 8 | 9 | 1 | 1 | 29 | 0 | 0 | 0 |
| a_trace__b_excel | trace | excel | PASS | 10 | 3 | 3 | 8 | 9 | 1 | 1 | 29 | 0 | 0 | 0 |
| a_trace__b_trace | trace | trace | PASS | 10 | 3 | 3 | 8 | 9 | 1 | 1 | 29 | 0 | 0 | 0 |

## 既知制約

- node.title は PDF / Excel / Trace JSON の3形式すべてで一致させることができない(既知の構造的制約)。
  excel_direct_adapter.js の `deriveTitle()` は常に先頭セルの生値(ヘッダー接頭辞なし)を返し、
  `deriveText()` は常に各セルへ `header: value` の接頭辞を付けて連結するため、Excel側は title と text が
  構造的に一致しない。一方 pdf_direct_adapter.js は常に title===text(単一の結合済み段落テキスト)である。
  text を3形式で一致させる(このCheckpoint 4フィクスチャの設計方針)場合、PDFのtitleは必然的にPDF自身のtext
  (完全な合成文字列)と一致し、Excel/Trace JSONの短いtitle(先頭項目名)とは一致しない。
  ExcelとTrace JSONの間ではtitleが一致することを確認済み。機能的な欠陥ではなく、各Adapterが独立して
  持つ既存のtitle導出ロジック(今回変更禁止)に由来する表示上の差異。
- node.tags はこのCheckpoint 4フィクスチャでは3形式すべてで空集合になるよう意図的に設計されている。
  excel_direct_adapter.js の matchInitialTags() はセル単位の生値に対して一致判定するのに対し、
  pdf_direct_adapter.js の matchInitialTags() は結合済み段落全体を1つの候補値として一致判定する
  (部分一致は行わない)ため、複数フィールドを持つ合成text(このフィクスチャの内容同等性検証に必要)では、
  PDF側が非空タグを得る唯一の方法は「段落全体がタグ語彙と完全一致すること」だが、それは合成textの
  同一性要件と両立しない。各Adapter自身のタグ一致ルールは pdf_direct_adapter_verification.js の
  fixture 10、excel_direct_adapter_verification.js / knowledge_builder_excel_direct_checkpoint2c.js の
  カスタムタグfixtureで別途検証済みであり、Checkpoint 4の対象(入力形式間の内容同等性)ではない。
- 全9ケースで file: スキームのみが使用され、http/https/wsは検出されなかった(実測値は各ケースのschemes_used参照)。
