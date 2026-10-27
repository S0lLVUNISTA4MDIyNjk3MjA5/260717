# Knowledge Data Builder — Alpha Next P1 Candidate Package

**Candidate package for internal verification. Not a formal release. Not the package
currently under human evaluation.**

このpackageは、現在人間が評価している評価用パッケージ(baseline commit
`356c1f18c42a3dfcbfab44a0c89436d500b870b1`、`trial_package.zip`,
SHA-256 `23090a97078b78c6b20b2a09a60622c628d4f98d1551a1304a772a35003bdd85`)を
**一切変更せず**、それに依存しない(FEEDBACK-INDEPENDENT)作業として、次版候補の
再現性・証跡・評価資料の整合性を検証する目的だけに生成したものです。

- 人間評価の結果を待たずに実施できる作業のみを対象にしています。
- 製品UI・STEP構成・ボタン名称・初期表示・Graph表示仕様・詳細テーブル構成・タグ抽出仕様・
  PDF見出し判定仕様・Excel取込仕様・JSON公開契約・node/relation生成仕様・runtime製品コードは
  一切変更していません(`tools/knowledge_builder/ui/knowledge_builder_tool_v0.2.0-alpha.html`、
  `tools/knowledge_builder/core/*.js`はbaselineから無変更)。
- 中身のツール本体(`tool/knowledge_builder_tool_v0.2.0-alpha.html`)は、baselineと同じ製品HTMLを
  読み取り専用でインライン化した梱包用コピーです(内容は無改変)。

## 内容

- `tool/` — 製品ツール本体(梱包用スタンドアロンコピー)
- `case_01_pdf_excel/input/` — ケースA入力(顧客要求PDF、設計レビューExcel。baselineと
  バイト同一)
- `case_01_pdf_excel/output/` — ケースAの実行結果(保存Knowledge JSON、本packageの生成時に
  実際にツールを操作して得たもの)
- `case_02_pdf_pdf/input/` — ケースB入力(顧客要求PDF、購入仕様PDF。baselineとバイト同一)
- `case_02_pdf_pdf/output/` — ケースBの実行結果
- `procedure_next.md` — 次版用評価手順(草案)
- `expected_observations_next.md` — 次版用期待観察結果(実測値に基づく更新版)
- `verification_report.md` — 検証報告書
- `manifest.json` — package内ファイル一覧(パス・サイズ・SHA-256)
- `SHA256SUMS` — 標準形式のSHA-256一覧

## 重要な注意

- これは正式Releaseではありません。Remote tag、GitHub Release、公開は行っていません。
- 現在評価中のpackageと同一ではありません(内容は同じCase A/Bですが、このpackageはFeedback
  -Independentな検証のために別途生成したものです)。
