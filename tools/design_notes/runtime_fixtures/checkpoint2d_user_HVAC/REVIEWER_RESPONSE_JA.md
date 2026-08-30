# KMS 5ea48fc4 HVAC照合評価 — 独立レビュアー向け回答

## 総合判定

**HOLD / 汎用照合ロジックのHuman Acceptance不可**

同梱のL3-1 Ground Truthケースに対する今回の誤対応抑止は有効ですが、独立したHVAC A/Bでは低識別力の部分一致による誤対応が残ります。機能の信頼性は`PARTIAL`、検出事項は`LOGIC-MAJOR 1件`です。

製品コードは変更していません。`G_hvac_dictionary_snapshot.json`はユーザー指定により評価対象外です。

## 固定対象

- 配布ZIP: `KMS_L31_Human_Evaluation_5ea48fc4(1).zip`
- ZIP SHA-256: `ff2681cd33c70cdb267e06e2b031bbded06b68caa9781d2502b54abe85914834`
- Source: `claude/canonical-matching-level3-l3-1-he1-remediation`
- Source commit: `5ea48fc4a1605fb657ca7cf5717ccb4469ab950a`
- 実行環境: Node.js `v24.19.0`

## 評価入力

HVACファイルは配布ZIP内のサンプルではなく、ユーザーが別途提供したファイルです。この証拠一式の`inputs/`に同梱しています。

|役割|ファイル|行数|
|---|---|---:|
|JSON A|`A_hvac_requirement_spec.json`|5（説明文1＋設備4）|
|JSON B|`B_hvac_delivery_spec.json`|4（設備4）|

正しい関係は、設備コード`FCU-1`、`OU-1`、`IU-2`、`OU-2`が一致する4組です。A側の説明文には対応先がありません。完全なA×B正解表は`expected_relationships.csv`を参照してください。

## 実測結果

|テスト|正解edge|誤edge|総edge|判定|
|---|---:|---:|---:|---|
|A→B・既定設定|4|5|9|FAIL|
|B→A・既定設定|4|5|9|FAIL|
|A→A・自己照合|5|8|13|FAIL|
|B→B・自己照合|4|8|12|FAIL|
|A→B・しきい値0.71|0|0|0|FAIL（正解も消える）|
|A→B・手動code方式|4|3|7|FAIL|
|B→A・手動code方式|4|2|6|FAIL|

既定A→Bの代表的な誤対応根拠は、`ユニット`、`200v`、`室外機`などです。正しい4件と誤った5件が同じ信頼度`0.70`で受理されるため、利用者がスコアだけで区別できません。

## 前版からの改善

|テスト|前版の誤edge|今回の誤edge|
|---|---:|---:|
|A→B|9|5|
|B→A|7|5|
|A→A|20|8|
|B→B|12|8|

誤対応数は減っていますが、0件にはなっていません。

## レビュアー判定

- 同梱Ground Truthの限定ケース：PASS
- HVACを使用した独立回帰：FAIL
- 照合結果の汎用的な信頼性：PARTIAL
- Human Acceptance停止理由：正解と誤対応が同じ信頼度0.70で受理され、Humanがスコアだけで区別できないため
- しきい値0.71による回避：不採用。正しい4件もすべて消えるため
- 再評価条件：正しいedgeを維持したまま、A→B・B→A・A→A・B→Bの誤edgeが0件となり、最低2回同一結果を再現すること

## Findings

### LOGIC-MAJOR-01：低識別力の語・コード断片による誤対応

`trace_key_text`から抽出された`ユニット`、`200v`、`室外機`などが、無関係な設備間のedgeを成立させています。また手動`code`方式でも、`OU-1`と`OU-2`を適切に区別できず誤対応が残ります。

このFindingは、表示だけの問題ではなくedge集合自体がGround Truthと異なるため、UXまたはDOCではなくLOGIC-MAJORに分類します。

## 証拠上の限界

本結果は、配布物の`04-Matching/index.html`に含まれる照合ロジックと同梱JavaScriptをNode VM上で実行したものです。実Chromiumでの画面表示、Graph、Excel出力はこの結果に含みません。

## ガバナンス

- Product files changed: 0
- commit / push / PR / tag / Release: なし
- 辞書Snapshot評価: 対象外
