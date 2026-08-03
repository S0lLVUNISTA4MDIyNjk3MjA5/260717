# Alpha Next P1 — Verification Report (FEEDBACK-INDEPENDENT)

対象branch: `claude/alpha-next-feedback-independent-p1`
branch base SHA (evaluation baseline): `356c1f18c42a3dfcbfab44a0c89436d500b870b1`

このpackageは正式Releaseではなく、内部検証用の次版候補です。現在人間が評価しているpackage
(`trial_package.zip`, baseline commit `356c1f18c42a3dfcbfab44a0c89436d500b870b1`)とは同一物では
ありません。

## 1. Baseline freeze 確認

- baseline commit `356c1f18c42a3dfcbfab44a0c89436d500b870b1` の
  `tools/knowledge_builder/trial/trial_package.zip` を、その正確なcommitから直接取得して
  SHA-256を再計算した結果: `23090a97078b78c6b20b2a09a60622c628d4f98d1551a1304a772a35003bdd85`
  (2,655,330 bytes) — 既報値と完全一致。
- 本branchはこのbaseline commitから作成した(`git checkout -b
  claude/alpha-next-feedback-independent-p1 356c1f18c42a3dfcbfab44a0c89436d500b870b1`)。
- `tools/knowledge_builder/trial/`配下は本branchで一切変更していない。

## 2. 既存の全通常テスト(baseline commit時点、本branch上で実行)

| Command | Exit Code | PASS | FAIL | 所要時間(概算) |
|---|---:|---:|---:|---:|
| `node tools/knowledge_builder/verification/pdf_direct_adapter_verification.js` | 0 | (ALL PASS) | 0 | 3s |
| `node tools/knowledge_builder/verification/excel_direct_adapter_verification.js` | 0 | (ALL PASS) | 0 | 0s |
| `node tools/knowledge_builder/verification/knowledge_builder_core_verification.js` | 0 | (ALL PASS) | 0 | 1s |
| `node tools/knowledge_builder/verification/knowledge_builder_excel_direct_checkpoint2.js` | 0 | (ALL PASS) | 0 | 9s |
| `node tools/knowledge_builder/verification/knowledge_builder_excel_direct_checkpoint2b.js` | 0 | (ALL PASS) | 0 | 4s |
| `node tools/knowledge_builder/verification/knowledge_builder_excel_direct_checkpoint2c.js` | 0 | (ALL PASS) | 0 | 5s |
| `node tools/knowledge_builder/verification/knowledge_builder_excel_direct_checkpoint2c1.js` | 0 | (ALL PASS) | 0 | 2s |
| `node tools/knowledge_builder/verification/knowledge_builder_pdf_direct_checkpoint3b.js` | 0 | 88 | 0 | 20s |
| `node tools/knowledge_builder/verification/knowledge_builder_ui_smoke_test.js` | 0 | 154 | 0 | 7s |
| `node tools/knowledge_builder/verification/knowledge_builder_medium_sample_smoke_test.js` | 0 | 83 | 0 | 43s |
| `node tools/knowledge_builder/verification/knowledge_builder_input_matrix_checkpoint4.js` | 0 | 740 | 0 | 21s |

全て `NODE_PATH="$(npm root -g)"` を設定して実行(リポジトリにPlaywrightのローカルinstallが
ないため、`/opt/node22/lib/node_modules`のグローバルPlaywrightを使用)。実行ディレクトリは
リポジトリルート(`/home/user/260717`)。

## 3. 新規追加した恒久テスト

`tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_evidence_verification.js`
(Node-only、Playwright不使用)。

| Command | Exit Code | PASS | FAIL |
|---|---:|---:|---:|
| `node tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_evidence_verification.js` | 0 | 27 | 0 |

検証内容: (§1)同一入力からの生成結果の再現性(PDF/Excel双方、Candidate含む)、(§2)必須識別子
(node_id/edge_id/source_document_idの形式・重複0件・相互参照整合性)、(§3)provenance保持と
原文(verbatim)の非改変、(§4)JSON妥当性と再読込による情報欠落なしの確認、(§5)Relation
Candidate生成の決定性。

`tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_package_verification.js`
(Node-only、Playwright不使用。`build_package.js`実行後のpackage staging領域を検証)。

| Command | Exit Code | PASS | FAIL |
|---|---:|---:|---:|
| `node tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_package_verification.js` | 0 | 18 | 0 |

検証内容: manifestと実ファイルの一致、manifest内重複0件、manifest参照先の実在、package内必須
ファイルの存在、SHA256SUMSが実ファイルと一致、ZIP展開後の内容がstagingと一致、
package(ZIP)自体の再現性(同一入力から2回連続buildしてSHA-256が一致)、package生成前後で
git管理下ファイルに変化がないこと。

### package(ZIP)再現性に関する注記

`build_package.js`はmanifest.jsonの`generated_at`とZIP内全ファイルのmtimeを固定値にしているため、
**package容器(ZIP・manifest・SHA256SUMS)自体は同一入力から常にビット単位で再現する**
(§9で確認済み)。

ただし、`case_*/output/*_dataset.json`(Case A/BをUI経由で実行して得た保存Knowledge JSON)には
製品UIが実行時刻から生成する`ingested_at`/`revision.updated_at`/`generation.generated_at`等の
タイムスタンプが含まれており、これは製品runtimeの既存仕様(本作業では変更していない)である
ため、`run_cases.js`を再実行するたびに値が変わる。そのため「UI経由の保存JSON自体がbit単位で
再現するか」は対象外とし、代わりに(a)恒久テスト§1で、タイムスタンプを固定引数として直接
指定した場合の`pdf_direct_adapter.js`/`excel_direct_adapter.js`/`relation_candidate_engine.js`
の純関数レベルでの完全な再現性を確認し、(b)本packageのcase出力(1回分のスナップショット)を
そのまま同梱している。

## 4. repository外の一時検査(恒久テスト化していないもの)

- baseline commitのZIP(既報値照合)を`git show <sha>:path > /tmp/...`で取得し、
  `sha256sum`で1回照合した(§1)。恒久テスト化はしていない(baseline SHAは固定引数であり、
  将来のbaselineごとに値が変わるため、恒久テストとして汎用化するには別途設計が必要と判断)。
- 展開後のZIPをPlaywrightで実際に開き、Case A/Case Bの一連の操作(プレビュー→取込→Candidate
  生成→保存)をUI経由で実行し、console error 0件・外部通信0件を確認した
  (`tools/knowledge_builder/alpha_next_p1/run_cases.js`、結果は
  `run_cases_report.json`)。これはリポジトリの一時実行スクリプトであり、恒久テストスイートには
  追加していない(UI経由のE2E確認はChecktool 5と同種の一時検証に位置づけ、恒久回帰は
  非UIのpure-function検証側に寄せた)。
- 「package生成後にtracked fileが変化しない」確認は、`build_package.js`実行前後の
  `git status --porcelain`比較として1回実施した(§6参照)。恒久テスト化はスクリプト自体の
  実行を要するため、CIに組み込む場合は別途シェル/CIジョブとしての実装が必要(NOT TESTED扱い
  として明記)。

## 5. Case A / Case B 実測結果

`run_cases_report.json`(実測の生データ)より要約。

### Case A: PDF x Excel

- 入力: `train_hvac_customer_requirements.pdf` (SHA-256
  `27a68f00ef94df9346735c712f794587281003ff1e98a1c6c0293aa9e785730c`),
  `train_hvac_design_review.xlsx` (SHA-256
  `e23a3349e19a65b2d411abf9bf5a4296bd037550495da59e8d4fba64fbfb2820`)
- 出力: `output/case_01_pdf_excel_dataset.json` (SHA-256
  `5c1764bcade49a621a77d3769f4bff7e069b05c5aae7e0ea1847842d5f34c5c9`)
- 総Node 42 (customer_requirements.pdf: document1/section14/statement12 ; design_review.xlsx:
  document1/section1/statement13)、構造Edge 40、Candidate 7、warning 0、diagnostics error 0、
  JSON parse可、reload可、console error 0、外部通信0。

### Case B: PDF x PDF

- 入力: `train_hvac_customer_requirements.pdf` (同上SHA-256),
  `train_hvac_unit_purchase_specification.pdf` (SHA-256
  `666765aa64013a601963442de5ed350da87c5fb8e81055ccef9deaad25c13796`)
- 出力: `output/case_02_pdf_pdf_dataset.json` (SHA-256
  `e7ce06d3e93c77aa4321c8e08ada0f270d966e3fcd6a70bf7c62a9823f129dd2`)
- 総Node 57 (purchase_specification.pdf: document1/section16/statement13)、構造Edge 55、
  Candidate 33、warning 0、diagnostics error 0、JSON parse可、reload可、console error 0、
  外部通信0。

## 6. NOT TESTED

- 全9通り(PDF/Excel/Trace JSON x PDF/Excel/Trace JSON)の再実行はCheckpoint 4の既存回帰
  (`knowledge_builder_input_matrix_checkpoint4.js`)でカバー済みのため、本packageでは
  Case A/B(PDF x Excel, PDF x PDF)のみ再実行した。Trace JSON入力の次版向け再実行はNOT TESTED。
- 「package生成後にtracked fileが変化しない」ことの自動テスト化(CIジョブ化)はNOT TESTED
  (§4参照、1回限りの手動確認のみ実施)。
- Candidate精度・Graphの理解しやすさ等、人間評価に依存する主観的な項目はFEEDBACK-DEPENDENTと
  して対象外(本packageでは扱わない)。
