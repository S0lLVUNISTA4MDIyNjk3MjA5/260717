# 次版用期待観察結果(実測値ベース・FEEDBACK-INDEPENDENT作業の一部)

**運営者向け参考資料の草案です。完全なRelation Candidateの正解表ではありません。**
本ファイルの数値はすべて、本packageの生成過程で実際にツール(baselineから無変更の製品HTML)を
Playwrightで操作し、`dataset.nodes`/`dataset.edges`から実測した値です(過去資料の期待値を
そのまま転記したものではありません)。実測記録は`tools/knowledge_builder/alpha_next_p1/
run_cases_report.json`、突合の詳細は`tools/knowledge_builder/alpha_next_p1/reconciliation/
count_reconciliation.md`を参照してください。

## Case A: PDF x Excel

| 文書 | document | section | statement | 総Node | 構造Edge |
|---|---|---|---|---|---|
| `train_hvac_customer_requirements.pdf` | 1 | 14(うち空section 2) | 12 | 27 | 26 |
| `train_hvac_design_review.xlsx` | 1 | 1 | 13 | 15 | 14 |
| **合計** | | | | **42** | **40** |

- Candidate件数: **7件**(想定していた7組の明確対応ペアすべてが候補として出現)
- diagnostics error: 0件 / console error: 0件 / 外部通信: 0件
- 保存JSON: parse可能・reload可能

## Case B: PDF x PDF

| 文書 | document | section | statement | 総Node | 構造Edge |
|---|---|---|---|---|---|
| `train_hvac_customer_requirements.pdf` | 1 | 14(うち空section 2) | 12 | 27 | 26 |
| `train_hvac_unit_purchase_specification.pdf` | 1 | 16(うち空section 3) | 13 | 30 | 29 |
| **合計** | | | | **57** | **55** |

- Candidate件数: **33件**。想定7組の明確対応ペアは比較的高い信頼度(confidence 0.25〜0.42)で
  含まれる一方、PDF同士の自然文比較のため定型語句由来の低信頼度ノイズ候補が多く含まれる
  (Relation Candidate Engineの文字bigram類似度の既知の性質。意味理解によるマッチングではない)。
- diagnostics error: 0件 / console error: 0件 / 外部通信: 0件
- 保存JSON: parse可能・reload可能

## PDF側のsection構造に関する注記

`pdf_direct_adapter.js`の`matchFixedHeadingLine()`は、章見出し(「第N章」)と番号付き項目見出し
(「N.N タイトル」)を同一階層のsectionとしてフラットに検出する(入れ子はない)。章見出しは
本文段落を持たない空sectionになり、番号付き項目見出しは直後の本文段落1つをstatementとして
持つ。この構造は本packageのCase A/B双方で一貫して確認できた。

## 未確認・今後の課題

- 本packageはFEEDBACK-INDEPENDENT作業の一部であり、Graphの見やすさ・Candidateの有用性等の
  主観評価は含まない(人間評価の対象)。
- 本packageの数値はbaseline評価packageと同一の入力データ・同一の製品コードから得られたもので、
  baseline評価packageの結果と数値上一致することを確認済み(node/edge/candidate件数は
  `count_reconciliation.md`のとおり)。
