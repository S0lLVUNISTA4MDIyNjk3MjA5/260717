# Reviewer Adversarial Matching Fixture RA-01

このfixtureは、Human Evaluation用の既存サンプルやユーザー作成HVACデータとは独立して、
レビュアーが照合ロジックの一般化能力を検証するために作成した adversarial fixture です。

## 狙っている衝突

- 「ユニット」「室内」「室外」などの一般名詞
- 複数機器で共通する `200V`
- 「冷房能力」「定格容量」等の一般的な技術語
- `OU-1` と `OU-2` の共通prefix
- `以上` のような短い比較語
- 正解相手が存在しない unmatched node

特定語の blacklist を要求するfixtureではありません。
候補集合内で識別力の低い evidence を一般化して抑止できることを確認するためのものです。

## Cross-format Ground Truth

A→B / B→A の正解は6組だけです。

- FCU-1 ↔ FCU-1
- OU-1 ↔ OU-1
- OU-2 ↔ OU-2
- IU-2 ↔ IU-2
- VEU-1 ↔ VEU-1
- CP-1 ↔ CP-1

A側 `HU-1` とB側 `DP-1` は意図的に相手を用意していません。
これらは **unmatchedのまま** が正解です。

したがって cross-format のAcceptanceは:

- expected accepted edges = 6
- wrong edges = 0
- HU-1 unmatched
- DP-1 unmatched

です。

## Self-match Ground Truth

A→A: 7 self edgesのみ / wrong 0  
B→B: 7 self edgesのみ / wrong 0

## Manual code tests

### Test C1 — strict code field
`equipment_code -> equipment_code`, method=`code`

期待:
- 上記6 cross edgesのみ
- wrong 0
- OU-1 と OU-2 を混同しない

### Test C2 — mixed code/name field
`equipment_code_name -> equipment_code_name`, method=`code`

このfieldは例えば:
`OU-1 ビル用マルチ室外機`
のように code + 自然語を含みます。

期待:
- codeらしいidentifierを根拠に正しい6組だけを結ぶ
- 「ユニット」「室外」「室内」など自然語だけでcode edgeを作らない
- OU-1 と OU-2 を共通prefixだけで同一扱いしない

## 判定方法

件数だけではなく、accepted edge ID集合を完全一致で比較してください。

`actual_edge_set === expected_edge_set`

を必須とし、top-confidenceだけを確認してPASSにしないでください。
