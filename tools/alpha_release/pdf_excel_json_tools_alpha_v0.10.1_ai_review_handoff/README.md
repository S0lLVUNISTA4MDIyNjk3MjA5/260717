# PDF／Excel → JSON α版 v0.10.1 生成AIレビュー受け渡し

Build date: 2026-07-29

**本配布物は限定評価版（α版）です。** 実業務データでの精度保証、大規模データでの性能保証、
実Chrome／Edgeでの手動E2E確認は行っておらず、正式な業務用途を意図したものではありません。
評価目的以外での利用は想定していません。

## 現行版数

- PDF版: `spec_to_json_conversion_tool_alpha_v0.10.1.html` — **v0.10.1-alpha**
- Excel版: `excel_to_json_conversion_tool_alpha_v0.10.1.html` — **v0.10.1-alpha**

## 現行実装の主要機能

- **生成AI連携**: プロンプトコピー、AI入力JSON保存（固定ID・内容ハッシュ・原文・タグ辞書を含む）、
  AI回答取込（件数・ID・内容ハッシュ・原文の全件検証後に一括反映）。AI確認済み（`ai_reviewed`等）は
  人手確認（`review_status`等）とは別項目として保持し、AI取込が人手確認状態を書き換えることはありません。
- **quantity sidecar（数量注釈JSON）**: PDF版・Excel版とも、照合用JSONと同一の
  `JSON.stringify`→`JSON.parse`スナップショットから、数量注釈JSONを1操作で生成します
  （PDF版は母体ツールに元々あった機能、Excel版はv0.10.1で新規に同一ライブラリ・binding-coreを
  移植して追加）。2ファイル目の生成に失敗した場合は、1ファイル目が物理的にダウンロード済みでも
  成功表示を出さず「生成に失敗しました」というエラーのみを表示します。
- **共通タグ辞書（shared tag vocabulary）**: `shared/tag_vocabulary.json`
  （`vocabulary_id: "trace-domain-ja"`、`vocabulary_version: "1.0.0"`）をPDF版・Excel版共通の
  初期辞書として使用します。出力側の`tag_vocabulary.vocabulary_sha256`は、出力時点で有効な
  タグ集合（画面上で編集済みならその内容）をcanonical化して都度計算する値で、キャッシュしません。

## 今回の変更

v0.10.0からの変更点は以下の5件です。既存の表示形式、確認状態、照合タグ、JSON保存、PDF／Excel保存、
STEP 2の生成AI連携（プロンプトコピー・AI入力JSON保存・AI回答取込）は維持しています。

### Excel版: AI確認情報の欠落を修正

`buildTraceOutput()`が照合用JSON（`trace`様式）を再構築する際、`review_status`・`tags`等は
コピーしていましたが、`ai_reviewed`／`ai_reviewed_at`／`ai_review_method`／`ai_review_model`／
`ai_review_comment`の5項目をコピーしていませんでした。単純な配列入力・ラップ入力・
`_trace_records`入力・既存照合用JSONの再出力という4系統いずれの入力経路でも、これら5項目が
各レコードのトップレベルへ正しく残ることを確認しています。

### Excel版: 数量注釈（quantity-annotation）サイドカーJSON出力を追加

PDF版の母体ツールが既に持つ数量抽出ライブラリ・binding-core・schemaを無改変のままExcel版へ移植し、
照合用JSONと同じ入力から数量注釈サイドカーJSONを生成できるようにしました。両JSONは
`JSON.stringify`→`JSON.parse`で確定させた単一のスナップショットから1操作で生成し、2ファイル目の
生成に失敗した場合は成功表示を出さず「照合用JSON＋数量注釈JSONの生成に失敗しました」という
エラーのみを表示します（1ファイル目が先に物理的にダウンロードされていても、その成果物セットは
使用しないでください）。

### PDF版／Excel版共通: 共通タグ辞書（shared tag vocabulary）を導入

これまでPDF版・Excel版がそれぞれ個別に持っていた既定タグ辞書を、`shared/tag_vocabulary.json`
1ファイルに統一しました。

- スキーマ：`{schema, vocabulary_id, vocabulary_version, allowed_tags, aliases}`
- 辞書ファイル自体には`vocabulary_sha256`を含みません（自己参照を避けるため）。出力側の
  `tag_vocabulary.vocabulary_sha256`は、出力時点で有効なタグ集合（画面上で編集済みの場合はその
  内容）をcanonical化して都度計算した値であり、キャッシュしません。
- 辞書ファイルの読込は、`vocabulary_id`／`vocabulary_version`が空、`allowed_tags`の重複（正規化後の
  重複を含む）、`aliases`の参照先不在など、契約として不正な内容を検出した場合に読込全体を拒否します。
- PDF版・Excel版で、フィールド名・階層・正規化ロジックはすべて同一です。

### 版数・メタデータの統一

画面タイトル・バナー表示・`ALPHA_TOOL_VERSION`をPDF版・Excel版とも`v0.10.1-alpha`へ統一しました。
`generator.version`・`ALPHA_BASE_TOOL`・内部の実装フェーズ識別子（`V12_PHASE6_VERSION`等）は、
母体ツール自体のバージョンを示す互換性識別子であるため変更していません。

### Excel版: trace_textへのAI管理フィールド混入を修正

照合用JSON生成時、`text_columns`（例:「内容」列）に指定された列が全行で空白の場合、
`textFromColumns()`のフォールバック処理が行オブジェクトの全キーを結合していたため、
AI確認状態管理用の`ai_reviewed`（既定値`false`）が`trace_text`／`trace_content`／
`trace_key_text`へ文字列として混入する不具合がありました。`ai_reviewed`等5つのAI管理
フィールドをフォールバックの除外対象へ追加して修正しています（数値`0`や実データとしての
`boolean false`は従来どおり意味のある値として保持されます）。

## 維持した機能

- 原資料表示／レビューJSON
- JSON表示・JSON保存
- 内容編集、タグ付け、検証、照合用JSON出力
- 作業保存・復旧、プロファイル、比較などの詳細機能
- STEP 2の生成AI連携（プロンプトコピー・AI入力JSON保存・AI回答取込・人手確認状態との分離）
- オフライン用ライブラリとサンプル

## ファイル

- `pdf_tool/spec_to_json_conversion_tool_alpha_v0.10.1.html`
- `excel_tool/excel_to_json_conversion_tool_alpha_v0.10.1.html`
- `shared/tag_vocabulary.json`（PDF版・Excel版共通の初期タグ辞書）

各HTMLは、同梱された`vendor`フォルダと同じ位置関係のまま使用してください。ChromeまたはEdgeを推奨します。

## 検証

- 全インラインJavaScriptの構文検査
- PDF版: AI回答検証・改ざん拒否経路のfail-closed実証（source_path改ざん・レコード数不一致・
  不正なレコード型・不正なAI値型・vendor/samplesのバイト一致検査を含む）
- Excel版: AI確認情報5項目が4系統の入力経路すべてで保持されることの実ブラウザ確認
- Excel版: 照合用JSON＋数量注釈JSONが単一スナップショットから1操作で生成されること、
  2ファイル目生成失敗時に成功表示を出さないこと、生成完了後の状態変更が既生成分へ遡って
  影響しないことの実ブラウザ確認
- 共通タグ辞書: PDF版・Excel版の既定値一致、辞書ファイル読込後のID・版数・ハッシュ一致、
  実ファイルの独立再計算ハッシュとの一致、7種の不正辞書に対するfail-closed検査、
  5種の正当な辞書内容変更後のハッシュ再計算検査
- Excel版trace_text: 欠落セル・空文字・null相当・数値0・実データboolean false・通常文字列の
  6境界値検査、および修正コードを意図的に戻すと不具合が再現することを確認するmutation検査
- 各チェックポイントの回帰検査（v0.10.0時点の検証スクリプトを再実行し、退行がないことを確認）
- 実行環境・使用ブラウザ・外部networkリクエスト有無を含む実ブラウザスモークテストの詳細は
  `SMOKE_TEST_REPORT.md`を参照してください。
- 照合ツール（`json_ab_trace_matching_tool`）との互換性評価（生成側・照合側の責務分離を含む）は
  `THREE_TOOL_COMPATIBILITY_REPORT.md`を参照してください。

実Chrome／EdgeでのクリックE2E確認は、検証環境にブラウザ本体がないため未実施です（詳細は
`SMOKE_TEST_REPORT.md`を参照）。
