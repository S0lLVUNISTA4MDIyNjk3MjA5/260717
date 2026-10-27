# JSON A/B トレース照合ツール V12.2.0-alpha.1

**限定評価用α版**です。オフライン動作するZIP配布型ブラウザツールとして配布します。

> 本ツールの自動照合結果は、人間による確認を前提としています。
> 正式な設計判定の唯一の根拠として使用しないでください。

α版の詳しい制限事項は、同梱の`KNOWN_LIMITATIONS.md`を必ず参照してください。

## 詳細操作説明書

画面別・機能別の詳細な操作手順は、同梱の
`trace_matching_tool_detailed_operation_manual_v12.2.0_alpha.1.pdf`を参照してください。

## α版利用条件

本α版は次の利用者にのみ提供してください。

- 限定された評価担当者
- 不具合報告が可能な利用者
- 正式業務へ直接使用しない利用者
- 出力結果を人間が再確認できる利用者

次の用途には使用しないでください。

- 正式な設計承認
- 顧客への正式成果物提出
- 安全性判断の唯一の根拠
- 本番業務への無監督導入

## 対応環境

本α版はPlaywright同梱Chromiumで検証しています。Google ChromeおよびMicrosoft Edgeは、同じChromium系ブラウザですが、本α版のリリース前には実ブラウザでの個別検証を実施していません。

**検証済み環境:**
- Linux
- Playwright同梱Chromium

**限定評価対象(α版利用者による評価を想定。個別事前検証は未実施):**
- Windows版Google Chrome
- Windows版Microsoft Edge

**未検証:**
- Firefox
- Safari
- モバイルブラウザ

実際に使用したChromiumの実行ファイル・版数は`alpha_release_report.md`に記録します。

Chrome／Edgeで問題が発生した場合は、正式な設計判断や成果物作成を中止し、ブラウザ名・版数・OS・操作手順・画面メッセージを添えて報告してください（同梱の`BROWSER_VALIDATION_REPORT.md`をご利用ください）。「Chromium系ブラウザなので確実に動作する」という保証はありません。

## 起動方法

1. ZIPを展開する
2. フォルダ構成を変更しない(`runtime/`フォルダの内容を移動・削除しない)
3. `json_ab_trace_matching_tool_v12.2.0-alpha.1.html`をブラウザで開く(対応環境は上記を参照)

`runtime/`フォルダの中身が欠けていると、ナレッジグラフ・Excel保存・日本語分かち書き・数量比較レビュー・辞書機能が正しく動作しません。ZIP展開時のフォルダ構成をそのまま保ってください。

## JSON A / JSON Bとは

- **JSON A**: 要求仕様側のトレースデータ(customer requirements等)
- **JSON B**: 設計・実装側のトレースデータ(design review等)

両方のJSONファイルを読み込んでトレース照合を行います。

## quantity sidecarとは

JSON A/Bそれぞれに対応する「数量注釈」データです。付属のPDF→JSON変換ツール・Excel→JSON変換ツールが、入力ドキュメントから数量値・単位・条件等を抽出して生成します。quantity sidecarを読み込むと、自動数量比較(quantity_extraction/property_mapping/interval_semantics/comparison_mode/satisfaction)が有効になります。

## 基本操作

1. **JSON Aの読込み**: 画面上部の入力欄からJSON Aファイルを選択します。
2. **JSON Bの読込み**: 同様にJSON Bファイルを選択します。
3. **照合**: 「読込み・照合」ボタンで実行します。
4. **照合結果一覧**: タブから照合結果の一覧表示・Excel保存ができます。
5. **ナレッジグラフ**: トレース関係を可視化したグラフ表示です。
6. **quantity sidecar**: 数量注釈ファイル(要求側・実仕様側)を追加で読み込むと、数量比較が有効になります。
7. **review session開始**: 「数量比較レビュー」パネルでレビュー担当者名を入力し、レビューを開始します。
8. **レビュー確認**: 各比較項目(quantity_extraction/property_mapping/interval_semantics/comparison_mode/satisfaction)を確認・承認します。
9. **レビュー済みJSON保存**: レビュー内容を反映した正式なJSON成果物を保存します。
10. **レビュー済みExcel保存**: 同内容をExcel形式で保存します。
11. **session破棄**: レビューをやり直す場合は「破棄」ボタンでsessionを終了できます。

## 同梱されている照合・辞書機能

本配布版には、開発版と同じ次の機能が含まれています(いずれも`runtime/`内のファイルを使用します)。

- **照合列の自動推定(canonical matching)**: 読み込んだ入力の列から、照合キーとして安全に推定できる列の組だけを自動で提案します(全レコードで同じ値の定数列などは自動選択しません)。推定できない場合は推定せず、手動設定を促します。
- **部分一致の抑制(partial-segment suppression)**: 多くの行に共通して現れる定型的な部分(見出しなど)だけが一致した場合の部分一致を、照合結果に採用しません。
- **辞書Snapshot (Private Dictionary)**: 作成済みの辞書Snapshotファイルを読み込み、「辞書Snapshotを照合セッションに設定」で有効にできます。有効にすると、辞書に基づく辞書タグが照合に使われます。
- **Project設定 (Project Snapshot Pin)**: 「Private Dictionary Project設定」パネルで、Project設定ファイルの保存・読込と、照合セッションへの適用ができます。
- **辞書参照列(Nested Selection)**: 「辞書参照列(入れ子列 source_record / table_row)」パネルで、辞書の照合に使う入れ子列を選択・適用できます。選択内容は現在のセッションに適用され、「Selection設定を保存」「Selection設定を読込」で専用の設定ファイルとして保存・読込できます。この設定ファイルは、照合ロジックJSON・トレースプロファイル・辞書Snapshot・Project設定ファイルには含まれません。
- **Human Evaluation(人手による照合品質評価)**: 「Human Evaluation」タブで、自動照合結果の各対応に対し人間が **CORRECT / INCORRECT / UNSURE** を記録できます(INCORRECTでは問題種別の選択が必要です)。評価の対象は、trace_idを持ち重複しない照合エンジンの対応のみです。これは照合結果を変更しない読み取り専用の品質評価で、Trace Reviewとは別機能です。評価は「Human Evaluationを保存」「Human Evaluationを読込」で専用ファイル(`human_evaluation.json`)として保存・読込します。照合ロジックJSON・トレースプロファイル・Excel出力には含まれず、ページを再読込すると読込み直すまで空に戻ります。入力や照合結果が変わった評価は、削除されずSTALE / ORPHANEDとして表示されます。
  Human Evaluationタブには、現在の対応のA・Bそれぞれの**入力record(項目名と値)を読み取り専用で表示**します(照合に使われた項目は強調されます)。また任意で、**1行に1つの`pair_id`を書いたテキストファイル(Sample pair list)**を読み込むと、その一覧だけを書かれた順序で表示・移動できます。Sample pair listは実行中の表示用で、`human_evaluation.json`にもブラウザにも保存されず、ページを再読込すると解除されます。

## データと通信

本配布版は外部CDNを使用せず、通常操作に外部通信を必要としません。

(この記載は現時点の実装構成に基づくものです。無条件の「外部送信は絶対に発生しない」という保証ではありません。通信遮断環境下での網羅的なE2E確認は今後のCheckpointで実施し、その結果を`alpha_release_report.md`に記録します。)

## エラー時の対応

| 状況 | 内容・対応 |
|---|---|
| **stale(古い)** | quantity sidecarファイルの再選択やトレース関係の変更後、レビューsessionが「古くなっています」と表示されます。この状態では承認操作・正式出力ができません。sessionを破棄して再度開始してください。 |
| **identity mismatch** | レビュー対象のデータが、session開始時点と異なる状態になっていることを検出した場合に表示されます。sessionを破棄して最新の状態で開始し直してください。 |
| **Schema不正** | 入力ファイルの形式が期待するSchemaと一致しない場合、fail closed(処理を進めず停止)します。入力ファイルの生成元(PDF/Excel変換ツール)を確認してください。 |
| **runtimeファイル欠落** | `runtime/`フォルダの内容が一部でも欠けていると、対応する機能(グラフ表示・Excel保存・日本語分かち書き・辞書機能等)が動作しません。ZIPを展開し直してください。 |
| **保存ボタンが無効になる条件** | レビュー未開始・投影がready状態でない・stale状態・identity不一致・レビュー操作の処理中(in-flight)のいずれかに該当すると、レビュー済みJSON/Excel保存ボタンは無効化されます。 |

## 不具合報告時に必要な情報

不具合をご報告いただく際は、以下の情報を添えてください。

- 製品版数(`V12.2.0-alpha.1`)
- ブラウザ名・版数
- OS
- 入力ファイルの種別(JSON A/B、quantity sidecarの有無等)
- 操作手順
- 画面に表示されたメッセージ
- ブラウザのconsole error(開発者ツールのConsoleタブの内容)
- 再現可否(毎回起きるか、まれにか)

**入力ファイルや画面のスクリーンショットに機密データが含まれる場合は、そのまま送付せず、必要な範囲だけを抜粋・マスキングしてください。**
