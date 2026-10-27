# 次版用評価手順(草案・FEEDBACK-INDEPENDENT作業の一部)

**これは草案です。人間評価の結果を踏まえて画面操作・用語・手順が変わる可能性があります
(UX改善はFEEDBACK-DEPENDENTのため、本作業では実施していません)。**

現時点の製品(UI・STEP構成は現行baselineと同一、無変更)を前提とした、Case A / Case Bの
実行手順を、本packageの再現手順として記録します。

## 前提

- `tool/knowledge_builder_tool_v0.2.0-alpha.html` をブラウザで直接開く(インターネット接続不要)。

## Case A: PDF x Excel

1. 文書Aの入力方式を「pdf」にし、`case_01_pdf_excel/input/train_hvac_customer_requirements.pdf`
   を選択する。
2. 「プレビュー取り込み」を押し、「プレビュー取り込み完了」を確認する。
3. 文書Bの入力方式を「excel」にし、`case_01_pdf_excel/input/train_hvac_design_review.xlsx`
   を選択する。
4. シート一覧からシートを選択し、「プレビュー取り込み」を押して完了を確認する。
5. 「Knowledge Nodeを生成してStep 2へ」を押す(取込)。
6. 「関連候補を自動生成」を押す。
7. Knowledge Graphを表示し、必要に応じてフィルタを確認する。
8. 「保存」を押し、Knowledge JSONをダウンロードする。

## Case B: PDF x PDF

1. 文書Aの入力方式を「pdf」にし、`case_02_pdf_pdf/input/train_hvac_customer_requirements.pdf`
   を選択する。
2. 「プレビュー取り込み」を押し、完了を確認する。
3. 文書Bの入力方式を「pdf」にし、
   `case_02_pdf_pdf/input/train_hvac_unit_purchase_specification.pdf` を選択する。
4. 「プレビュー取り込み」を押し、完了を確認する。
5. 「Knowledge Nodeを生成してStep 2へ」を押す(取込)。
6. 「関連候補を自動生成」を押す。
7. Knowledge Graphを表示し、必要に応じてフィルタを確認する。
8. 「保存」を押し、Knowledge JSONをダウンロードする。

## 本packageでの実行方法(自動化・再現用)

`tools/knowledge_builder/alpha_next_p1/run_cases.js` が上記操作をPlaywrightで自動実行し、
`case_*/output/*.json` と同内容の結果を生成する。実行コマンド・結果は
`verification_report.md` を参照。
