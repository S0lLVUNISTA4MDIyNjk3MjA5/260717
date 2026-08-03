# Count Reconciliation (Alpha Next P1, feedback-independent)

このファイルはFEEDBACK-INDEPENDENT作業の一部として、既存資料に書かれた値と、次版branch上で
実測した値を突き合わせたものです。**評価baseline (`356c1f18c42a3dfcbfab44a0c89436d500b870b1`)
配下の資料そのものは変更していません。** ここは新規追加の突合資料です。

## 対象文書と実測方法

`tools/knowledge_builder/alpha_next_p1/run_cases.js` が、製品HTML(無改変)をPlaywrightで実際に
操作し(ファイル選択→プレビュー→取込→Candidate生成→保存)、`dataset.nodes`/`dataset.edges`から
文書ごとのnode_type別件数を集計した(`run_cases_report.json`に生の実測記録あり)。

## 文書別 node/section/statement 数

| 文書 | 既存資料(baseline `expected_observations.md`)の値 | 実測値(本re-run) | 差分 | 原因 | 確認状態 |
|---|---|---|---|---|---|
| `train_hvac_customer_requirements.pdf` | document 1 / section **2** / statement 12 / 総Node **15** | document 1 / section **14** / statement 12 / 総Node **27** | section +12 / 総Node +12 | 下記「原因分析」参照 | **再現確認済み**(実行コマンド・実測データで確認、推測ではない) |
| `train_hvac_design_review.xlsx` | document 1 / section 1 / statement 13 / 総Node 15 | document 1 / section 1 / statement 13 / 総Node 15 | 差分なし | — | 確認済み(一致) |
| `train_hvac_unit_purchase_specification.pdf` | document 1 / section **3** / statement 13 / 総Node **17** | document 1 / section **16** / statement 13 / 総Node **30** | section +13 / 総Node +13 | 下記「原因分析」参照 | **再現確認済み** |

## ケース合計

| ケース | 既存資料の総Node/構造Edge | 実測の総Node/構造Edge | 差分 | 確認状態 |
|---|---|---|---|---|
| ケースA (PDF x Excel) | 記載なし(個別文書の値から算出すると 15+15=30) | 42 / 40 | 総Node +12 | 再現確認済み |
| ケースB (PDF x PDF) | 記載なし(個別文書の値から算出すると 15+17=32) | 57 / 55 | 総Node +25 | 再現確認済み |

Candidate件数(ケースA 7件、ケースB 33件)は既存資料の値と実測値が一致しており、差分なし。

## 原因分析(再現確認できた原因)

`tools/knowledge_builder/core/pdf_direct_adapter.js`の`matchFixedHeadingLine()`は、「第N章」の
ような章見出しと、「N.N タイトル」のような番号付き項目見出しの両方を、**同一階層のsection**
として検出する(sectionの入れ子構造はない)。そのため、章見出しに加えて「2.1 車室温度」の
ような各項目見出し行もそれぞれ独立したsection Nodeになり、見出し直後の本文段落1つが、その
sectionの子であるstatement Nodeになる。

既存資料(baseline `expected_observations.md`)は「章見出しだけがsectionになる」という誤った
前提で書かれており、番号付き項目見出しがsectionとしてカウントされていなかった。これは
製品の不具合ではなく、資料側の記載誤りであることを実際のAdapter出力(`run_cases_report.json`の
`node_breakdown_by_document`)で確認済み。

`train_hvac_customer_requirements.pdf`の実際のsection一覧(14件、出現順): 第2章(空)、2.1〜2.7
(各statement 1件)、第3章(空)、3.1〜3.5(各statement 1件)。空sectionは章見出し2件のみ。

`train_hvac_unit_purchase_specification.pdf`の実際のsection一覧(16件、出現順): 第1章(空)、
1.1〜1.2、第2章(空)、2.1〜2.4、第3章(空)、3.1〜3.7。空sectionは章見出し3件のみ。

## 未確認の原因

なし。今回の差分はすべて実際のAdapter出力で再現確認できており、推測に基づく記載はない。

## 補足: baseline上の既存資料はすでに一部訂正されている

`claude/child-handover-qcycsj`ブランチのcommit `fc83f68`(このAlpha Next P1のbaseline commit
`356c1f1`より後、かつ本作業の対象外)で、上記と同じ原因分析に基づき
`tools/knowledge_builder/trial/trial_package/reference/expected_observations.md`が実測値に
更新されている。ただし本作業は**baseline commit `356c1f1`から分岐**しており、`fc83f68`の内容は
このbranchには含まれない(baselineを一切変更しないため意図的)。次版用の期待観察結果
(`tools/knowledge_builder/alpha_next_p1/package/expected_observations_next.md`)は、本re-runの
実測値から独立して新規作成している。

## 製品runtimeへの変更

なし。本reconciliationの過程で製品コード(Adapter/Engine/Store/Contract/UI)は一切変更していない。
