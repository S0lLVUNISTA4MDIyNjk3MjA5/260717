# Reviewer RA-02 — Explicitly Disabled vs Auto-Inferred Key-Pair State

目的:
`照合ペアが未設定/再推定が必要` と `利用者が有効な照合ペアを明示的にすべてOFF` を区別できるか検証する。

このfixtureは照合精度ではなく **configuration-state semantics** を検査する。

## Ground Truth

S0 Auto / uninitialized:
- 通常の安全な自動推定を許可
- A1↔B1, A2↔B2 の2 edge

S1 one valid pair, explicitly disabled:
- trace_title↔trace_title enabled:false
- expected edge = 0
- defaultKeyPairs() へfallbackしてはいけない

S2 multiple valid pairs, all disabled:
- trace_title / trace_text 等をすべて enabled:false
- expected edge = 0
- defaultKeyPairs() へfallbackしてはいけない

S3 one enabled, one disabled:
- enabled pairだけがactive
- disabled pairを暗黙復帰させない

S4 genuinely invalid/missing fields:
- 入力変更でfieldが存在しなくなった等、reconcileが必要なケース
- この場合のsafe auto-reinferenceは許容
- S1/S2とは別状態として扱う

## 重要

修正を以下のようにしてはいけない:
- `enabled.length === 0`なら常に空配列、だけで済ませて未初期化も壊す
- UI checkboxだけで抑止し、内部APIではfallbackする
- 全OFF時だけminConfidenceを上げる
- fixture固有のfield名で分岐する

必要なのは明示的な状態区別:
AUTO / UNINITIALIZED / EXPLICIT_CONFIGURED / EXPLICIT_ALL_DISABLED / RECONCILE_NEEDED
のうち少なくとも意味的に同等な区別。
