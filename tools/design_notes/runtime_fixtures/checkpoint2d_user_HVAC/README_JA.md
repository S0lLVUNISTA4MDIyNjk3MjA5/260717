# Supplemental/User-HVAC — ファイル一覧と現在版の判定資料について

このディレクトリの各ファイルの位置づけを明確にするための案内です。

## 現在の評価入力（現行版で使用するもの）

- `A_hvac_requirement_spec.json` / `B_hvac_delivery_spec.json`
  — 現在のテスト入力（HVAC-01/HVAC-02の照合対象そのもの）。
- `expected_relationships.csv`
  — **現行のGround Truth**。人手評価で「正解かどうか」を判断する基準はこのファイル。

## 修正前baseline（歴史的証跡・現在の判定には使わない）

- `REVIEWER_RESPONSE_5ea48fc4_BASELINE_JA.md`
- `HVAC_EVALUATION_SUMMARY_5ea48fc4_BASELINE.csv`

この2件は commit `5ea48fc4`（HE-1 Remediation Checkpoint 2-D着手前）時点の独立レビュアー評価
結果であり、`HOLD`判定・誤対応件数などはすべて **修正前の状態** を指す。有用な経緯記録として
削除せず保持しているが、**現在版（Checkpoint 2-D以降）の合否判定には使用しないこと**。

Checkpoint 2-D（RC1/RC2/RC3修正）以降、このbaseline評価が指摘した誤対応はすべて解消済みで
あることを `matching_correctness_checkpoint2d_verification.js` で確認済み（User HVAC A→B
4/4・誤対応0、B→A 4/4・誤対応0）。

## 現在版で判定に迷ったら

`Manual/KMS_L3-1_Human_Evaluation_Checklist_JA.csv` の `HVAC-01`/`HVAC-02` 行の「Expected
result」列に書かれている内容と、上記の現行 `expected_relationships.csv` を基準にすること。
baseline側のHOLD報告書（5ea48fc4関連の2ファイル）の数値と現在の結果が異なっていても、それは
修正が効いている証拠であり、異常ではない。
