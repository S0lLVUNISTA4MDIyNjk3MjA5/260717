# サンプル — Excel → JSON 変換 α版

## ファイル

| ファイル | 内容 |
|---|---|
| `sample_input.xlsx` | 代表サンプル入力。シート「検証項目」、列 No/分類/項目/内容/備考、5行。B2:B3を結合（分類="構造"）、内容・備考にそれぞれ1件ずつ空欄セルを含む |
| `sample_expected_plain_convert.json` | 「JSONへ変換」（様式未適用）で得られる期待JSON |
| `sample_expected_trace.json` | 内蔵様式「照合用JSON（Excel行単位）」を適用し「照合用JSON出力」まで進めた場合の期待JSON |
| `compare_expected.py` | 上記期待JSONと実際の出力JSONを比較する検証スクリプト（`generated_at`のみ除外） |

## サンプルの意図

- **No.2の行**（項目「柱脚接合部の耐力確認」）：分類セルが結合（B2:B3）の非アンカー側であるため、
  α版の「警告件数」に1件カウントされることを確認するためのケースです。
- **No.3の行**（内容が空欄）・**No.4の行**（備考が空欄）：α版の「未確認件数」に2件カウントされる
  ことを確認するためのケースです。
- **No.1の行**（「安全対策」を含む）・**No.4の行**（「接続」「耐久」を含む）：内蔵様式「照合用JSON
  （Excel行単位）」のタグ付与ルール（安全／インターフェース／品質）が実際に一致し、タグが生成される
  ことを確認するためのケースです。

## 期待される評価サマリ（α評価パネル、様式未適用の変換直後）

| 項目 | 値 |
|---|---|
| 変換件数 | 5 |
| 警告件数 | 1 |
| 未確認件数 | 2 |
| JSON構文 | 正常 |

## 固定検査対象（fix-check）とした項目・除外した項目

`compare_expected.py` は、値が実行のたびに変わる **`generated_at`** キー（トップレベル・
`_trace_adapter.generated_at`・`alpha_meta.generated_at` のすべて）だけを比較対象から除外し、
それ以外のフィールドはすべて厳密一致で比較します。固定検査に含まれる主なフィールド：

- `source.sheet_name` / `_trace_adapter.source_sheet` / 各レコードの `source_sheet`・`source_row`
  （Excel上の実際の行番号 2〜6と一致）
- 各レコードの抽出値：`trace_title`（`No`列の値）・`trace_text`（`内容`列、空欄行のみ他列からのフォール
  バック文字列）・`trace_category`（`分類`列）
- 各レコードの `tags` / `unregistered_tags` / `review_status`
- `statistics.records`（5）・`statistics.tagged_records`（2）・`statistics.unregistered_tags`（0）
- `trace_id` / `stable_uid` / `parent_id`（下記参照）

### trace_id・stable_uid・parent_id は「初回出力の丸ごとgolden化」ではなく独立検証済み

これらはツール内蔵の決定的ハッシュ関数（FNV-1a、`hashString()`）から `xrow-<hash>` / `excel-<hash>` /
`sheet-<hash>` として生成されます。本チェックポイントでは、`excel_to_json_conversion_tool_v2.0.8.html`
のソースコード（`hashString()` 定義、および3053行目以降の「確認履歴・安定ID」機能が実装する
`ensureRowStates()`・`preferredStableKey()` の具体的な種文字列の組み立て方）を読み、Pythonで独立に
同じアルゴリズムを再実装して計算した値が、実際の出力と全5行・親IDともに一致することを確認しています。
ツールの出力をそのまま「正解」として保存したのではなく、アルゴリズムを独立に読み解いて再計算した値と
突き合わせた上で採用しています。また、同一入力で2回連続実行し、`generated_at`系以外が完全に一致する
（決定的である）ことも別途確認済みです。

### 既知の仕様（バグではありません）：トップレベル `tags` と `source_record.tags` の違い

`sample_expected_trace.json` の各レコードで、トップレベルの `tags` は空配列 `[]` ですが、ネストした
`source_record.tags` には様式のタグ付与ルールが一致した結果（例: No.1行は `["安全"]`）が入っています。
これは基準ツール v2.0.8 自身の既存仕様（無改変）です。トップレベルの `tags` は「人が確認・確定した
タグ」を様式切替をまたいで保持する仕組みになっており、本サンプルのように様式適用後に一度も確認操作を
行っていない場合は、直前の変換時点（＝タグ未付与の状態）のまま残ります。一方 `source_record.tags` は
その時点で選択中の様式のルールを適用した場合の自動タグ付け結果（提案値）です。α版はこの挙動を変更して
いません。評価者がタグ付けルールの動作を確認したい場合は `source_record.tags` を参照してください。
