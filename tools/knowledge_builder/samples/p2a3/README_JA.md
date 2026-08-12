# P2-A3 synthetic サンプルデータ

鉄道車両用空調装置をテーマとした**完全 synthetic** のサンプル一式。
実在企業・実在車両・実在製品・実案件・実人名は一切含まれない。型番はすべて架空。

## 構成

```text
standard/
  train_hvac_requirement_spec_sample.pdf     7ページ / 要求仕様書
  train_hvac_design_review_sample.xlsx       3シート / 設計レビュー表
edge_cases/
  alias_conflict_sample.pdf                  同一aliasが2つのcanonicalを指す
  newline_boundary_sample.pdf                NB-01（改行境界の過剰取得）
  multi_sheet_sample.xlsx                    可視2 / 非表示1 / 空1シート
sample_expectations.json                     固定P2-A2 coreによる実測期待値
MANIFEST.sha256                              全サンプルのSHA-256
```

## 生成

```bash
python3 generate_train_hvac_pdf_samples.py      # PDF（reportlab）
node    generate_train_hvac_excel_samples.js    # XLSX（vendored SheetJS）
node    generate_sample_expectations.js         # 期待値をP2-A2 coreの実測から生成
```

新規 package 依存はない。`npm install` も不要。

## 検証

```bash
node verify_samples.js
```

次を確認する。

1. **determinism** — 独立した2つの空ディレクトリへ再生成し、互いに byte 一致し、かつ commit 済み
   サンプルとも一致すること
2. **manifest** — commit 済みサンプルが `MANIFEST.sha256` と一致すること
3. **expectations** — `sample_expectations.json` が固定 core の再測定と一致すること

決定性のために、PDF は reportlab の `invariant=1`（作成時刻・document ID・producer を固定）、
XLSX は `wb.Props.CreatedDate` を固定値にしている。時計から時刻を取得する箇所はない。

## 期待値の扱い

`sample_expectations.json` の件数・ハッシュは**すべて固定 P2-A2 core の実測結果**である。
人手で推測して固定してはいけない。サンプルを変更したら generator を再実行すること。

`candidate_evaluation.json` そのものはリポジトリへ commit しない。サンプルは synthetic だが、
成果物の形は実運用で private content を運ぶものと同一のため、ハッシュのみを記録する。

## rule coverage（standard sample 実測）

| rule | 出現 |
|---|---|
| TERM_STRUCTURAL_KEY | 12 |
| TERM_STRUCTURAL_HEADING | 7 |
| TERM_REPEATED_VALUE | 15 |
| TERM_EXPLICIT_QUOTED | 7 |
| ALIAS_EXPLICIT_PARENTHETICAL | 6 |
| ALIAS_EXPLICIT_DEFINED_AS | 8 |

candidate 40 / alias 6 / conflict 1 / rejected 84。conflict は `FACU` が
`外気導入制御装置`（日本語 defined-as）と `Fresh Air Control Unit`（英語 defined-as）の
2 canonical を指す構成。

## edge case の意図

- `alias_conflict_sample.pdf` … `CV` と `DCU` で日英2種の conflict（計2件）。自動解決されないこと
- `newline_boundary_sample.pdf` … 折り返し行が結合された結果、英語 defined-as の canonical が
  直前の短い語句まで取り込む NB-01 を1件再現。同じ版で、直前が句点で終わる**正常境界**の
  対照ケースも1件含む
- `multi_sheet_sample.xlsx` … 非表示シートと空シートが adapter 判定で除外されること、
  可視2シートのみが抽出対象になること
