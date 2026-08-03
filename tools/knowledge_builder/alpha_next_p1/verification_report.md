# Alpha Next P1 — Verification Report (FEEDBACK-INDEPENDENT)

## Branch topology (是正Finding 3)

- **人間評価baseline SHA**: `356c1f18c42a3dfcbfab44a0c89436d500b870b1` — 現在人間が評価している
  packageを固定する参照commit。このP1作業の内容は最初この commit 上で作成された
  (`git checkout -b claude/alpha-next-feedback-independent-p1 356c1f18c42a3dfcbfab44a0c89436d500b870b1`)。
  ただしこのcommitは**現branchの直接baseではない**(下記参照)。
- **PR integration base branch**: `claude/child-handover-qcycsj`
- **PR integration base SHA**: `fc83f683ac231289b8f1fe6c7f0a9185bbf2433f` — 現在のPR headの
  直接の親。元のP1 commit(`674d1758152c408e0c9dfda659c4bcbf0107827c`)を、Codexレビューでの
  base branch誤り指摘を受けてこのcommitへ`git cherry-pick`した。
- **現在のbranch**: `claude/alpha-next-feedback-independent-p1-r2`
- fc83f683の資料是正(Checkpoint 5.1でのnode/section数訂正)は本branchに保持されている
  (`git diff fc83f683..HEAD -- tools/knowledge_builder/trial/` が空であることで確認済み)。
- 人間評価baseline自体(`tools/knowledge_builder/trial/`配下)は、本branch・本remediationの
  いずれでも一切変更していない。

このpackageは正式Releaseではなく、内部検証用の次版候補です。現在人間が評価しているpackage
(`trial_package.zip`, baseline commit `356c1f18c42a3dfcbfab44a0c89436d500b870b1`)とは同一物では
ありません。

## 1. Baseline freeze 確認

- baseline commit `356c1f18c42a3dfcbfab44a0c89436d500b870b1` の
  `tools/knowledge_builder/trial/trial_package.zip` を、その正確なcommitから直接取得して
  SHA-256を再計算した結果: `23090a97078b78c6b20b2a09a60622c628d4f98d1551a1304a772a35003bdd85`
  (2,655,330 bytes) — 既報値と完全一致(初回作業時に確認済み。値は再測定していないが、
  `tools/knowledge_builder/trial/`配下は本branchで無変更のため引き続き有効)。
- `tools/knowledge_builder/trial/`配下は本branch・本remediationのいずれでも一切変更していない。

## 2. 既存の全通常テスト(integration base commit時点、本branch上で実行)

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

`knowledge_builder_input_matrix_checkpoint4.js`はそれ自身の
`verification/evidence/checkpoint4/*`を実行のたびに上書きする(実行時刻を含むため)既存仕様の
副作用がある。このremediationの作業範囲外のファイルであるため、実行後に
`git checkout -- tools/knowledge_builder/verification/evidence/checkpoint4/`で復元した。

## 3. 恒久テスト(Codex Round 1 Findingsで強化)

`tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_evidence_verification.js`
(Node-only、Playwright不使用)。

| Command | Exit Code | PASS | FAIL |
|---|---:|---:|---:|
| `node tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_evidence_verification.js` | 0 | 41 | 0 |

検証内容: (§1)同一入力からの生成結果の再現性(PDF/Excel双方、Candidate含む)、(§2)必須識別子
(node_id/edge_id/source_document_idの形式・重複0件・相互参照整合性)、(§3)provenance保持と
原文(verbatim)の非改変、(§4)JSON妥当性と再読込による情報欠落なしの確認、(§5)Relation
Candidate生成の決定性と**固定Case契約どおりの正確な件数**(Case A=7件、Case B=33件。
以前の`length >= 1`から強化)、(§6, 是正Finding 2)`run_cases.js`の`validateCaseResult()`に
対するtamper/failure injection検査(golden実測値がPASSすることを確認したうえで、
入力SHA/node数/structural edge/Candidate件数/parse/reload/diagnostics error/warning/
console error/external request/ingest_okを1項目ずつ改変し、必ずrejectされることを確認)。

`tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_package_verification.js`
(Node-only、Playwright不使用。`build_package.js`実行後のpackage staging領域を検証)。

| Command | Exit Code | PASS | FAIL |
|---|---:|---:|---:|
| `node tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_package_verification.js` | 0 | 37 | 0 |

検証内容: manifestと実ファイルの一致、manifest内重複0件、manifest参照先の実在、package内必須
ファイルの存在、SHA256SUMSが実ファイルと一致、ZIP展開後の内容がstagingと一致、
package(ZIP)自体の再現性(同一入力から2回連続buildしてSHA-256が一致)、package生成前後で
git管理下ファイルに変化がないこと(§6)、**(是正Finding 1)§10: TZ x umask
決定性matrix**(TZ={UTC, Asia/Tokyo} x umask={0022, 0002}の4通りで子プロセスとして
`build_package.js`を再実行し、ZIP size・ZIP SHA-256・manifest.json内容・SHA256SUMS内容・
展開後ファイル一覧・展開後各ファイルSHA-256が4通りすべてで一致することを確認)、
**(是正Finding 4)§11: 失敗注入時のcleanup検査**(存在しないZIPを展開しようとして
`extractZipAndHash()`が例外を投げること、かつ例外後も一時ディレクトリが残らないことを確認)。

### package(ZIP)決定性ビルドに関する注記(是正Finding 1)

`build_package.js`は外部`zip`コマンドを使わず、Node組み込みの`zlib`のみで依存なしのZIP writerを
実装している。旧実装(外部`zip`コマンド)は、各エントリのタイムスタンプをファイルmtimeから
**プロセスのローカルタイムゾーンへ変換したDOS日時**として書き込んでいたため、同じUTC時刻でも
`TZ=UTC`と`TZ=Asia/Tokyo`でZIPのバイト列が異なっていた(Codex Round 1 Finding 1で指摘)。
新実装はDOS日時を固定値の純粋な算術で計算し(TZ依存のDateゲッターを一切使わない)、
Unix権限ビットもstagingの実際のファイルmode(umaskの影響を受けうる)を読まず、常に
`0644`(通常ファイル)をハードコードしている。extra fieldは全エントリで長さ0(UT/Ux拡張
フィールドを一切付与しない)。エントリ順序は明示的なordinal比較でソートしている。
結果として、`TZ=UTC`/`TZ=Asia/Tokyo` x `umask=0022`/`umask=0002`の4通り全てでZIPが
bit単位で一致することを§10で確認済み。

`case_*/output/*_dataset.json`(Case A/BをUI経由で実行して得た保存Knowledge JSON)には
製品UIが実行時刻から生成する`ingested_at`/`revision.updated_at`/`generation.generated_at`等の
タイムスタンプが含まれており、これは製品runtimeの既存仕様(本作業では変更していない)である
ため、`run_cases.js`を再実行するたびに値が変わる。そのため「UI経由の保存JSON自体がbit単位で
再現するか」は対象外とし、代わりに(a)恒久テスト§1で、タイムスタンプを固定引数として直接
指定した場合の`pdf_direct_adapter.js`/`excel_direct_adapter.js`/`relation_candidate_engine.js`
の純関数レベルでの完全な再現性を確認し、(b)本packageのcase出力(1回分のスナップショット)を
そのまま同梱している。

### run_cases.jsのfail-closed化に関する注記(是正Finding 2)

`run_cases.js`は固定Case契約(`CASE_A_EXPECTED`/`CASE_B_EXPECTED`)を持ち、実測値との差分を
`validateCaseResult()`(純関数、Playwright非依存)で網羅的に検出する。preview/ingestエラー、
入力SHA不一致、node内訳不一致、total node不一致、structural edge不一致、Candidate件数不一致、
JSON parse/reload失敗、diagnostics error/warning/console error/external network requestが
1件以上、のいずれかがあれば`main()`はexit 1になる。通常実行(オプションなし)は
`work/output/`・`work/run_cases_report.json`(いずれもgitignore対象)へ書き出し、
commit済みのcase出力snapshot(`output/*.json`, `run_cases_report.json`)は変更しない。
明示的に`--update-snapshots`を指定した場合のみsnapshotを更新する。

### 環境解決に関する注記(是正Finding 4)

`run_cases.js`はPlaywright/Chromiumの絶対パス固定(`/opt/node22/lib/node_modules/playwright`,
`/opt/pw-browsers/chromium`)を廃止した。解決順は (1) 環境変数`PLAYWRIGHT_MODULE`/
`CHROMIUM_EXECUTABLE` (2) `require('playwright')`によるNODE_PATH/repository解決
(3) Playwright管理下のbrowser(executablePath指定なし) (4) いずれも不可なら、解決経路を
含む明確なエラーメッセージとともに非0終了。一時領域は`KB_ALPHA_NEXT_TMPDIR`(未設定なら
`TMPDIR`、それも未設定なら`os.tmpdir()`)で設定可能。browser/context・ダウンロード用一時
ディレクトリはtry/finallyで確実に解放する(§7参照)。

## 4. repository外の一時検査(恒久テスト化していないもの)

- baseline commitのZIP(既報値照合)を`git show <sha>:path > /tmp/...`で取得し、
  `sha256sum`で1回照合した(§1)。恒久テスト化はしていない(baseline SHAは固定引数であり、
  将来のbaselineごとに値が変わるため、恒久テストとして汎用化するには別途設計が必要と判断)。
- `run_cases.js`のPlaywright/Chromium解決の失敗注入を2パターン(存在しないパスを指した
  `CHROMIUM_EXECUTABLE`、存在しないパスを指した`PLAYWRIGHT_MODULE`)手動実行し、いずれも
  非0終了・明確なエラーメッセージ・一時ディレクトリの残存なし、を確認した。恒久テストには
  していない(Playwright/実browserの起動を要するため、pure-functionの恒久テスト2件とは
  別区分の一時検証に位置づけている)。

## 5. Case A / Case B 実測結果

`run_cases_report.json`(実測の生データ、`--update-snapshots`で最新化)より要約。

### Case A: PDF x Excel

- 入力: `train_hvac_customer_requirements.pdf` (SHA-256
  `27a68f00ef94df9346735c712f794587281003ff1e98a1c6c0293aa9e785730c`),
  `train_hvac_design_review.xlsx` (SHA-256
  `e23a3349e19a65b2d411abf9bf5a4296bd037550495da59e8d4fba64fbfb2820`)
- 出力: `output/case_01_pdf_excel_dataset.json` (SHA-256
  `b00b8a55d0ef8dfedf48988ebd2ebe44b8c49981f92bb5d6c044962a78e25df7` - UI由来のタイムスタンプを
  含むため実行のたびに変わる。node/edge/candidate件数は固定Case契約どおり)
- 総Node 42 (customer_requirements.pdf: document1/section14/statement12 ; design_review.xlsx:
  document1/section1/statement13)、構造Edge 40、Candidate 7、warning 0、diagnostics error 0、
  JSON parse可、reload可、console error 0、外部通信0。
- `validateCaseResult(actual, CASE_A_EXPECTED)`: **ok=true, failures=0**。

### Case B: PDF x PDF

- 入力: `train_hvac_customer_requirements.pdf` (同上SHA-256),
  `train_hvac_unit_purchase_specification.pdf` (SHA-256
  `666765aa64013a601963442de5ed350da87c5fb8e81055ccef9deaad25c13796`)
- 出力: `output/case_02_pdf_pdf_dataset.json` (SHA-256
  `03f3c621e326e9c90d32f8318cc4fb7f69e8b88ecec6be342c49bbfa59689a4a` - UI由来のタイムスタンプを
  含むため実行のたびに変わる)
- 総Node 57 (purchase_specification.pdf: document1/section16/statement13)、構造Edge 55、
  Candidate 33、warning 0、diagnostics error 0、JSON parse可、reload可、console error 0、
  外部通信0。
- `validateCaseResult(actual, CASE_B_EXPECTED)`: **ok=true, failures=0**。

## 6. NOT TESTED

- 全9通り(PDF/Excel/Trace JSON x PDF/Excel/Trace JSON)の再実行はCheckpoint 4の既存回帰
  (`knowledge_builder_input_matrix_checkpoint4.js`)でカバー済みのため、本packageでは
  Case A/B(PDF x Excel, PDF x PDF)のみ再実行した。Trace JSON入力の次版向け再実行はNOT TESTED。
- Candidate精度・Graphの理解しやすさ等、人間評価に依存する主観的な項目はFEEDBACK-DEPENDENTと
  して対象外(本packageでは扱わない)。
