# サンプル — 仕様書PDF → JSON 変換 α版

## ファイル

| ファイル | 内容 |
|---|---|
| `sample_input.pdf` | 代表サンプル入力（構造化）。第1章見出し、1.1〜1.3節見出し、段落、箇条書き（2項目）を含む1ページ |
| `sample_input_table.pdf` | 表入りサンプル入力。第2章見出し、2.1節見出し、3列×2行の日本語表（項目・基準値・測定値）を含む1ページ |
| `sample_input_unextractable.pdf` | 抽出不能サンプル入力。テキストを一切含まない完全な空白ページ1枚 |
| `sample_expected_normal.json` | `sample_input.pdf`を変換した際の期待JSON |
| `sample_expected_table.json` | `sample_input_table.pdf`を変換した際の期待JSON |
| `compare_expected.py` | 上記期待JSONと実際の出力JSONを比較する検証スクリプト（`created_at`・`generated_at`のみ除外） |

`sample_input_unextractable.pdf`には対応する期待JSONを用意していません。このサンプルの目的は
「変換が成功したように見えるが実は失敗している」という状態を作らないことの確認であり、正しい挙動は
変換自体が実行されず、既存の`data`が変化しないことです（下記参照）。

## 母体ツールの版

本α版は、正式branch `claude/pdf-excel-json-overview-pigbne` の最新HEAD
（コミット `9fb473f96bac7df52a27282aa4e48257aa7a5274`）上の
`tools/spec_to_json_conversion_tool_v1.18.html`（blob `8dbdd584277176f935295b0072d08837eae0e328`）
を母体としています。このコミットで追加された「数量注釈（quantity-annotation）」出力機能は
α版の対象範囲外ですが、無改変のまま保持しています（α版はPDF→JSON構造変換の評価に対象を限定して
おり、この機能を削除・変更する理由がないため）。期待JSONは本コミットを母体とした実機実行から今回
新規に生成しており、旧母体（blob `9ca8a7daf29a720120a9b06b92070ca6ba55f58b`）時点のcheckpoint値を
流用していません。なお、母体差分（数量注釈機能の追加）はα版が評価対象とするPDF→JSON構造変換ロジック
（`extractPdf`/`extractPdfLayout`/`buildJsonFromLines`/`v12ReviewCounts`/`scoreAgainstPdf`）には
触れていないため、期待JSONの内容（`created_at`/`generated_at`を除く）は旧母体版と比較しても同一でした
（独立に突き合わせて確認済み）。

## サンプルの意図

- **`sample_input.pdf`**：章・節見出し、段落、箇条書きという基本的な構造化能力を確認します。
- **`sample_input_table.pdf`**：2列以上に分かれた行の連続を表として検出する能力を確認します。
  基準ツール自身の表意味判定（`semantic.kind`）が`"requirements"`（項目・基準値・測定値の並び）
  と判定することも確認済みです。
- **`sample_input_unextractable.pdf`**：テキスト層抽出が不十分な場合、本α版ではOCR（Tesseract.js）
  を意図的に同梱しておらず、Checkpoint 7以降はCDNへの接続も一切試みないため、即座に
  「生成に失敗しました: OCR（Tesseract.js）はこのα版では未対応です。テキスト層からの抽出のみに
  対応しています。」という明示的なエラーが表示されることを確認します。この際、外部networkリクエスト
  は0件（旧実装ではTesseract.js CDNへの接続試行が1件発生していましたが、その経路自体を無効化した
  ため試行そのものが発生しません）、変換前の`data`は変更されず、α評価パネルが変換成功として偽の
  件数を表示しないことも確認済みです。

## 期待される評価サマリ（α評価パネル）

| サンプル | 変換件数 | 警告件数 | 未確認件数 | JSON構文 |
|---|---|---|---|---|
| `sample_input.pdf` | 4 | 0 | 4 | 正常 |
| `sample_input_table.pdf` | 2 | 0 | 2 | 正常 |
| `sample_input_unextractable.pdf` | （変換失敗、直前の変換結果を維持） | - | - | - |

変換件数は基準ツール既存の`v12ReviewCounts()`が数える対象（段落・箇条書き項目・表の行）の件数です。
`sample_input.pdf`は段落2件＋箇条書き項目2件＝4件、`sample_input_table.pdf`は表の行2件です
（表のヘッダー行はカウント対象に含まれません。これは基準ツールの既存仕様です）。

## 固定検査対象（fix-check）とした項目・除外した項目

`compare_expected.py`は、値が実行のたびに変わる**`created_at`**（要素・セクションの作成時刻）と
**`generated_at`**キーだけを比較対象から除外し、それ以外のフィールドはすべて厳密一致で比較します。
固定検査に含まれる主なフィールド：

- `chapter_number`・`chapter_title`（章見出しの抽出結果）
- 各セクションの`section_number`・`section_title`・`content`（段落・箇条書き・表の抽出結果）
- 表の`headers`・`rows`・`semantic`（表の意味判定結果）
- `_tool_state.review`の各項目の`status`（未確認状態）
- `_source_by_id`・`_source_map`の`source_text`・`bbox`（PDF原文中の座標。フォント・レイアウトが
  固定されたサンプルPDFに対して決定的であることを2回の独立実行で確認済み）

期待JSONは初回出力をそのまま保存したものではなく、同一サンプルに対して独立した2回の実行を行い、
`created_at`/`generated_at`を除く全フィールドが完全一致する（決定的である）ことを確認した上で採用
しています。
