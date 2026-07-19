# shadow-mode挿入点の設計（`-rc1`）

`trace_comparison_schema_v1.md`で確定したスキーマを、本体3ツールのどの処理の後に生成するかを設計する。**本節はコード変更を行わず、挿入点・データフロー・未解決事項を確定するのみ**（`trace_comparison_schema_v1.md` §0の「本節で決定しないこと」の続き）。

> **改訂履歴**
> - `22c5e24`→`938ccf7`：6件の必須修正（数量と意味候補の対応の曖昧さ／照合行から元レコードを引く契約の未確定／入力の取り違え・陳腐化の未検出／`quantity_pair_id`等の順序依存／`quantity_columns`必須指定の方針不一致／全組み合わせ生成の絞り込み未設計）へ対応。`quantity-annotation/1.0`・`trace-comparison/1.0`の両スキーマを`-rc1`（修正完了までの暫定版）とした。
> - `938ccf7`→本改訂：レビュアー交代後の指摘で、(1) `simpleHash()`（32-bit FNV-1a）はハッシュ衝突を実証済みで陳腐化・取り違え検出に不十分、(2) `quantity_id`が`occurrence_index`経由で抽出順序に間接依存したまま、(3) Excel全列走査は「数量の所在検出」に過ぎず列の役割（標準値/顧客対応値等）の自動判定になっていない、(4) `not_analyzed`が件数集計のみで個別ペアを追跡できない、との指摘を受けた。本改訂で(1)(2)を解消し、(3)(4)の設計を追加した。修正完了の判定基準は9節。

## 1. 生成を2フェーズへ分割する理由

`trace-comparison/1.0-rc1`のレコードは、（a）要求側・実仕様側それぞれ単独で計算できる部分（`requirement_analysis`/`actual_analysis`＝数量抽出＋意味候補）と、（b）A-B対応が確定してから初めて計算できる部分（`relationship`＝どのA-Bペアか、`mapping`/`automation`/`comparison`＝そのペアの比較結果）に分かれる。この2つは実行タイミングが異なる既存ツールにまたがるため、1回の処理では生成できない。

- （a）は`spec_to_json_conversion_tool_v1.18.html`・`excel_to_json_conversion_tool_v2.0.8.html`側で、照合用JSON（`chapter-section-trace-v1`/`excel-row-trace-v1`）を生成した**直後**に計算できる（照合エンジンを一切必要としない）。
- （b）は`json_ab_trace_matching_tool_v12.1.15.html`側で、A-B照合が完了した**直後**にしか計算できない（`relationship`が照合結果そのものに依存するため）。

したがって、挿入点は本体3ツールそれぞれに1箇所ずつ、計3箇所になる（この構成自体はレビューで承認済み）。

## 2. 挿入点A・B：PDF/Excel側での「数量注釈シャドー出力」（`quantity-annotation/1.0-rc1`）

### 2.0 数量単位でまとめる構造・識別子の導出（必須修正1・再指摘への対応）

初版の`quantities[]`と`semantics_candidates[]`を独立配列にする設計は、1つの文章・セルに複数の数量がある場合にどちらがどちらに属するか判別できないという欠陥があった。`semantic_mapping_prototype.js`の`buildPropertyCandidateRecords()`（552行目）が、まさに同じ問題を「1つの数量＝1レコード」の`analyses[]`的な配列（`quantity_ref`＋`quantity_record`＋`property_candidates`＋`interval_semantics_candidates`を1件にまとめる形）で既に解決している。これをそのまま踏襲する。

**ハッシュアルゴリズムの訂正**：当初`json_ab_trace_matching_tool_v12.1.15.html`の`simpleHash(text)`（10451行目、32-bit FNV-1a）を`quantity_id`/`content_hash`/`dataset_signature`へ流用する設計にしていたが、これは表示用フィンガープリント（`currentDatasetSignature()`が既に使っている用途）には十分でも、取り違え・陳腐化を安全に検出する完全性ハッシュとしては不十分との指摘を受けた。実際に検証したところ、`simpleHash()`と同じ構造の入力（`"trace|field|0|" + ランダム文字列`）で9万件程度の探索で衝突が発生することを確認した（32-bit空間では誕生日のパラドックスにより約6.5万件が理論的な目安であり、想定される実データ規模で現実に起こり得る）。このため、識別子・ハッシュにはSHA-256を採用する。

- **ブラウザ側**：`spec_to_json_conversion_tool_v1.18.html`に既に実装済みの`v12Sha256(value)`（5736行目、`crypto.subtle.digest('SHA-256', ...)`、`crypto.subtle`が使えない環境向けの純JS実装`v12Sha256Fallback()`も5732行目に既存）と`v12HashParts(namespace, parts)`（5737行目）を、3ツール共通のユーティリティとして再利用する（5節の「core共通化」の対象に、`simpleHash()`ではなくこちらを含める）。
- **Node側の検証**：`trace_comparison_example_verification.js`では組み込みの`crypto.createHash('sha256')`を使用し、実際にこの方式で`quantity_id`/`content_hash`を計算・検証した（`trace_comparison_schema_v1.md` §11）。
- `simpleHash()`自体は、`currentDatasetSignature()`（UI表示用の軽量フィンガープリント、完全性保証を要求しない用途）としては元の用途のまま使い続けてよく、変更は不要である。

**`quantity_id`の生成規則**（内容から一意に定まる識別子とし、抽出順序には依存させない）：

```
quantity_id = v12Id("q-", v12HashParts("quantity-id-v1", [trace_id, source_field, String(source_span.start), String(source_span.end), normalized_text]))
```

> **訂正（フェーズA実装時）**：当初この式を`sha256([...].join(""))の先頭32桁`と記載していたが、これは2.0節冒頭で述べた`v12HashParts()`と異なる素朴な連結方式であり、区切り文字を持たない`.join("")`では要素の境界があいまいになる問題（例:`["ab","c"]`と`["a","bc"]`が同じ文字列になる。`hash_3paths_verification.js`の`part_boundary_ambiguity`系ベクトルがまさにこの種の衝突を検出するために存在する）を再発させてしまう誤りだった。実装では2.0節で既に採用を決めた`v12HashParts(namespace, parts)`（NUL区切り、`parts`は個別に正規化、`namespace`は正規化しない）と、既存の`v12Id(prefix, digest)`（128-bit切り詰め）をそのまま再利用する。上の式はこの実装と一致させた。

以前の版は`occurrence_index`（同じ`source_text`がセル内に複数回現れる場合の出現順カウンタ）を使っていたが、これは`extractQuantities()`の出力順序が原文の出現順序と一致するという**暗黙の前提**に依存しており、真の意味で順序非依存になっていないとの再指摘を受けた（`semantic_mapping_prototype.js` 559〜569行目が既に認識していた既知の弱点そのもの）。

**この指摘を受け、`source_span`（原文内の絶対文字位置）を予約から実装へ格上げした**：`quantity_extraction_prototype.js` v2.14で、`extractFromSentence()`が内部で既に計算していた`absStart`/`absEnd`を`source_span: { start, end }`として戻り値へ含めるよう修正済み（`quantity_extraction_prototype.md` 5.17節、`condition_candidates`側の数量にも付与）。同一表記が1文中に複数回出現しても、それぞれ異なる`source_span`を持つことを回帰テスト（4件追加、既存64件と合わせて68件）で確認した。**`occurrence_index`は`source_field`内での位置を人間に分かりやすく示す表示用の補助情報として残すが、識別子の導出には`source_span`だけを使う。**

**原文が変わった場合の扱い**：`source_span`は原文の文字位置に依存するため、原文編集（挿入・削除等）で後続の位置がずれると、同じ数量でも`quantity_id`が変わり得る。これは意図的な設計である——無理にIDを安定させようとするより、`content_hash`の不一致（3.3節）で陳腐化を検出し比較を止める方が安全側に倒れる。原文変更後の数量が「同じ数量の続き」なのか「別の数量」なのかは自動で引き継がず、新規候補としてレビューへ提示する。

**ハッシュ対象の範囲**：`content_hash`は本文（`source_field`の値）だけでなく、意味候補生成に影響する周辺情報も含める。範囲を明文化しないと、タグや列見出しを変更しても古い意味候補が有効に見えてしまう、との指摘を受けた。

| 対象 | ハッシュに含める内容 |
|---|---|
| PDF側(`requirement_analysis`) | `trace_id`、`source_raw_text`、`tags` |
| Excel側(`actual_analysis`) | `trace_id`、対象セル値（`source_field`の値）、列見出し（`source_field`のキー名自体）、`tags`、行識別情報（`source_row`） |

正規化方式は`quantity_extraction_prototype.js`の`normalizeText1to1()`（全角ASCII→半角変換）と同一のものをハッシュ計算前に適用し、`provenance.normalization`（`trace_comparison_schema_v1.md` §2.0）へ方式名を記録する。

### 2.1 出力形（`quantity-annotation/1.0-rc1`）

```json
{
  "schema_version": "quantity-annotation/1.0-rc1",
  "side": "requirement",
  "source_trace_file": "customer_hvac_requirements_trace.json",
  "hash_algorithm": "SHA-256",
  "id_hash_algorithm": "SHA-256/128",
  "dataset_signature": "QA-SHA256:9f1c2ab0e3d7...(64hex、元trace(_trace_records全体)のみから導出。sidecar自身のanalyses/意味候補は含めない)",
  "generated_at": "2026-07-19T07:00:00Z",
  "generator": { "tool": "quantity_extraction_prototype.js + semantic_mapping_prototype.js", "version": "v2.14 / v2.19" },
  "ruleset_version": {
    "quantity_extraction": "v2.14",
    "semantics_rules": "v2.19",
    "auto_applicable_thresholds": { "modeConfidence": 0.4, "margin": 0.2, "propertyConfidence": 0.7 }
  },
  "records": [
    {
      "trace_id": "req-cooling-capacity",
      "content_hash": "7a48895380cb969ebc07b77c7bad7482e74429c0256d587f6f422c9318d82582...(64hex、切り詰めない)",
      "analyses": [
        {
          "quantity_id": "q-be1c0825cbf56b0f1a2b3c4d5e6f7089",
          "source_field": "source_raw_text",
          "occurrence_index": 0,
          "source_span": { "start": 18, "end": 23 },
          "normalized_text": "12 kW",
          "quantity": { "...": "extractQuantities()の1件分の出力そのもの(v2.14以降、source_spanも含む)" },
          "interval_semantics_candidates": [ { "value": "acceptable_region", "confidence": 0.6, "...": "..." } ]
        }
      ]
    }
  ]
}
```

- `hash_algorithm`：`dataset_signature`/`content_hash`（完全性検出用、64桁のまま切り詰めない）で使ったアルゴリズム名（`"SHA-256"`固定）。`quantity_id`（128-bitに切り詰め）は別途`id_hash_algorithm: "SHA-256/128"`で明示する（2.0節参照）。
- `dataset_signature`：元trace JSON（`_trace_records`全体、`trace_id`昇順で連結）からSHA-256で導出する。**取り違え検出の第一段階**：突き合わせ時に、参照した`sysList`/`plmList`から再計算した`dataset_signature`と一致しない場合、そのファイル全体を`source_mismatch`として扱う（3.3節）。
- `records[].content_hash`：レコード単位（`trace_id`単位）の内容ハッシュ。2.0節の表で定義したハッシュ対象範囲（本文＋タグ＋列見出し＋行識別情報）からSHA-256で算出する。**取り違え検出の第二段階**：ファイル全体は一致していても個別レコードが編集されている場合に検出する。
- `generator`/`ruleset_version`：どのバージョンの抽出ロジック・語彙・閾値で生成されたかを記録する。`AUTO_APPLICABLE_THRESHOLDS`のような閾値が変わると、同じ入力でも`automation.auto_applicable`の結果が変わり得るため、再現性の根拠として必須とする。

### 2.2 PDF側（`spec_to_json_conversion_tool_v1.18.html`）

> **訂正（フェーズA着手時、実ブラウザ実行で判明）**：当初この節は`buildTraceExport(obj, profile, adapterSide)`（2396行目）・`downloadTraceJsonObject(obj, filename)`（2438行目）を現行の生成関数として記載していたが、これらは実際にはUIから呼ばれないコードだった（`#btn-trace-export`のクリックハンドラが後から`v12ExportTraceSide`へ上書きされている。ファイル内の`/* 関数名：Phase 6統合実装へ移行 */`という注記群が、大規模な後続改修（「Phase 6」）の存在を示していた）。Playwrightで`$("#btn-trace-export").onclick.toString()`を確認して発見した（`baseline_v1_handoff.md` §7参照）。以下は現行の生成コードを前提に書き直した。

- 既存の生成関数：`v12BuildTrace(obj, profile, side)`（6392行目）が`v12TraceRecordsFromModel(model, side)`（6368行目）を呼んで`{..., _trace_records: records}`を組み立てる。呼び出し元の`v12ExportTraceSide(obj, profile, side, label)`（6396行目）が`v12DownloadJson(trace, ...)`でダウンロードする。**これらの関数は変更しない**。
- 新設する関数：`buildQuantityAnnotationSidecar(trace, side, sourceTraceFileName)` — `trace._trace_records`を読み取り専用の入力として受け取り、各レコードの`source_raw_text`に対して`extractQuantities()`を適用し、2.0節の`quantity_id`規則で`analyses[]`を組み立てる。
- 呼び出し位置：新しい別関数`v12ExportQuantityAnnotationSide(obj, profile, side, label)`を新設し、新しい別ボタン（`#btn-quantity-annotation-export`/`-b`）のハンドラとする。この関数の中で`v12BuildTrace(obj, profile, side)`を1回だけ呼び、その戻り値（`trace`変数）から`v12DownloadJson(trace, ...)`（既存の照合用JSONと同じ内容）と`buildQuantityAnnotationSidecar(trace, ...)`（数量注釈JSON）の**両方**をこの1回のクリック内で生成・ダウンロードする。既存の`v12ExportTraceSide()`・`#btn-trace-export`は一切変更しない（独立した別のv12BuildTrace()呼び出しのまま残る）。
- **同一性保証**：`v12BuildTrace()`は`generated_at`（現在時刻）以外に非決定的な要素を持たない（`v12BuildDocumentModel()`の結果に依存するが、これは編集中の`data`状態を読むだけの純粋な変換）。同一クリック操作内で1回だけ呼び出し、その戻り値を両方の生成物（trace JSON本体・数量注釈sidecar）で共有する設計であれば、再実行による不一致の懸念自体が生じない。

> **訂正（フェーズA初回実装のレビューで判明）**：初回実装では、新ボタンのハンドラが`v12BuildTrace()`を1回呼ぶところまでは上記のとおりだったが、その戻り値からsidecarだけをダウンロードし、trace JSON本体は**ダウンロードしていなかった**（既存の`#btn-trace-export`から別途取得する運用を前提にしていた）。これは「同一スナップショットから生成する」が構造的保証ではなく運用上の期待に留まる欠陥だった（文書またはレビュー状態を編集してから照合用JSON→数量注釈JSONの順にクリックすると、2ファイルが別スナップショットになり得る）。上記の記述はこの欠陥を修正した実装（新ボタンが1クリックでtrace JSON本体とsidecarの両方をダウンロードする）に合わせて書き直した。回帰テストとして、`v12BuildTrace()`をモンキーパッチして呼び出し回数を計測し、ちょうど1回であることと、両ファイルの`generated_at`が完全一致することを`quantity_annotation_pdf_verification.js`で直接検証する（同一性検査を意図的に壊すコード変更を注入し、実際に終了コード1になることを確認済み）。

### 2.3 Excel側（`excel_to_json_conversion_tool_v2.0.8.html`）— 列の役割候補生成（必須修正5・再指摘への対応）

初版で提案した「利用者が`quantity_columns`を明示的に指定する」運用は、ユーザーの一貫した方針（人間の事前準備を最小化する）に反するため撤回し、続く改訂で「全スカラー列を自動走査する」設計へ変更した。しかし再レビューで、**これは数量の「所在検出」に過ぎず、列の「役割」（標準値列か顧客対応値列か等）の自動判定にはなっていない**との指摘を受けた。

現行の`inferRole()`（`semantic_mapping_prototype.js` 514行目）は、列名の**完全一致**でのみ役割を決めている：

```js
if (ctx.sourceColumn === '標準機種情報') return { role: 'baseline_design', ... };
if (ctx.sourceColumn === '検討結果') return { role: 'resolved_design', ... };
```

このままでは、列名が「標準仕様」「客先対応値」のような同義の別見出しである汎用帳票では、数量は見つかっても役割が`unknown`のままになり、「標準機種は不充足、顧客対応後は充足」という主要ユースケースを自動生成できない。

**列役割候補の自動生成へ変更する**：

1. **既定動作**：`buildTraceOutput()`が返す各レコードの`source_record`に含まれる全フィールドのうち、文字列型・数値型の値を自動走査し、`extractQuantities()`を適用する（所在検出、変更なし）。
2. **明らかな管理列の自動除外**：列名が`trace_id`/`stable_uid`/`stable_key`/`*_hash`/`No`/`ID`/`行番号`等のIDパターン、または`tags`/`unregistered_tags`/`review_status`等の既存の管理用フィールド名と一致する列は自動的にスキャン対象から除く（`json_ab_trace_matching_tool_v12.1.15.html` 3240〜3247行目の既存パターンを流用）。
3. **列役割候補の生成（新規）**：`inferRole()`の完全一致判定を、次の複数の手がかりから候補と根拠・確信度を生成する方式へ拡張する。
   - **列名キーワード**：列見出しに「標準」「規格」「仕様」等を含めば`baseline_design`寄り、「検討」「対応」「実施」「結果」等を含めば`resolved_design`寄りの弱い根拠とする（現行の完全一致リストを、部分一致のキーワード集合へ一般化する）。
   - **値の分布**：同じ列の値がシート内で一定・変化が少なければ「基準・標準」寄り、行ごとにばらつきが大きければ「個別対応・検討結果」寄りという弱い根拠にする。
   - **表内位置**：`標準機種情報`列の右隣・近傍に位置する列は、検討・対応系の列である可能性が高いという弱い根拠にする（実データでの相対位置に基づく、確定的な判定ではない）。
   - **周辺見出し**：同じ行・同じ見出しグループ内の他フィールドのテキスト（`shadow_mode_integration_design.md`自身がこの節で示す例のように、行内の他フィールドを周辺語コンテキストに含める設計、`trace_comparison_schema_v1.md` §11参照）。
   - 上記を`role_candidates: [{ role, confidence, evidence }]`の形で保持し（`property_candidates`と同型のパターン）、**確信度が閾値未満の場合は`role: "unknown"`のまま比較不能とする**（構造的根拠だけで役割を確定しない、という8.11節以来の非対称設計の原則をここでも適用する）。
4. **`quantity_columns`／列役割の明示指定は任意のoverride**：自動候補の確信度が低い場合に、利用者が列名と役割の対応を明示的に指定するための任意設定として残す（必須ではない）。
5. **自動候補と人間修正を区別して記録する**：`role_candidates`（自動生成、`confirmed: false`）と、利用者が`quantity_columns`／列役割指定で上書きした結果（`source: "manual_override"`）を別フィールドとして保持し、自動候補を上書きで消さない。
6. **列候補の提示**：初回の自動走査結果から「数量が検出された列」「役割候補の内訳」をUI上に参考情報として表示する。これにより、利用者は列役割指定で絞り込むかどうかを実データを見てから判断できる。

この設計により、事前の様式準備・辞書登録は一切不要になり、初回実行の結果を見てから任意で絞り込む、という順序は維持される。ただし`role_candidates`の生成規則自体（キーワード集合・重み付け）は、単一のHVACサンプルだけでは実データによる検証ができないため、対象帳票の実データが手に入った時点で確定させる必要がある（未実施）。

**実装状態（フェーズA、`quantity_annotation_excel_verification.js`・`quantity_annotation_excel_xlsx_verification.js`で実ブラウザ検証済み）**：

- 上記1〜3（既定の全列走査、管理列の自動除外、列役割候補の生成）を実装した。`excel_to_json_conversion_tool_v2.0.8.html`に`isManagementColumn()`（`rowContentHash()`が既に持つ管理フィールド一覧`tags`/`unregistered_tags`/`review_status`/`review_method`/`reviewed_at`/`review_comment`/`exclusion_reason`/`trace_id`/`content_hash`/`stable_uid`を土台にし、`stable_key`と`No`/`ID`/`行番号`/`*_id`/`*_hash`等のIDパターンを追加）、`inferColumnRoleCandidates()`（列名キーワード・表内位置・値分布の3種の根拠を評価し`role_candidates`を生成。`inferRole()`の完全一致判定は置き換えた、移植も再利用もしていない）を実装した。
- `role_candidates`は`quantity-annotation/1.0-rc1`出力のトップレベルに`column_role_candidates: [{ column, role_candidates }]`として追加した（PDF側の出力にはこのフィールド自体が存在しない、Excel固有の任意フィールド）。列ごとに1回だけ生成し、行ごとに重複させない。**数量が1件も検出されなかった列(例:「設計項目」のような記述列)はcolumn_role_candidatesに含めない**（quantity_annotation_schema_v1.jsonが「数量所在列ごと」と説明していることと実装を一致させた。表内位置の計算そのものには全scannable列の並び順を内部的に使うが、出力する候補は数量が検出された列だけに絞る）。

> **訂正（859349fへのレビューで発見・修正、高深刻度）**：当初、周辺見出し（4番目の手がかり）を「対象セル・列見出し・同一行内の他列の値」すべてを連結した`nearbyText`として`generateIntervalSemanticsCandidates()`へ渡していた（`trace_comparison_example_verification.js`が確立していた「行内の他フィールドをnearbyTextに含める」設計を汎用化する形で実装した）。しかし、この設計は本来`generatePropertyCandidates()`（設計特性・概念の対応付け、フェーズB・比較エンジン側の責務で未実装）のためのものであり、フェーズAが実装しているinterval_semantics候補生成（数量そのものの形・語彙判定）へ混ぜるべきではなかった。連結の区切り記号`" / "`が`localClauseText()`の節区切り（、。，）として認識されないため、列見出し自体や他列の文言がそのまま強いキーワード根拠として二重計上されてしまっていた（例:「検討結果」という列見出し自体が`ACHIEVED_POINT_KEYWORD_PATTERN`の`検討(?:の)?結果`に一致し、セル値の内容に関わらず`achieved_point`へ強い根拠(weight 0.4)が加点され、`modeConfidence >= 0.4`のような下流の自動判定閾値を実際に誤って超えてしまうことを実データで確認した）。修正後は、`nearbyText`を対象セル自身の値のみに限定し、列名は既存の`ctx.sourceColumn`（`ACTUAL_SEMANTICS_RULES`内で`column_role`根拠として意図的に0.05のみ加点される、唯一の正しい列名由来の経路）だけを通す形にした。回帰テストとして、列見出し自体がキーワードに一致するケース・セル自身にキーワードがあるケース(正しく加点される)・別セルの語が伝播しないケース・列名を中立名に変えても結果が変わらないケースを追加した。

- **4番（`quantity_columns`／列役割の明示指定によるoverride）と5番（自動候補と人間修正の区別記録）は未実装**：設計文書自体が「任意設定として残す（必須ではない）」と明記している機能であり、本フェーズでは自動候補生成のみに留めた（「候補は生成してよいが確定はしない」の原則どおり）。
- 6番（列候補のUI表示）も未実装（本フェーズはJSON生成のみが対象、UI表示は次工程）。
- `role_candidates`の生成規則自体（キーワード集合・重み付け・閾値）は、上記のとおり単一のHVACサンプルによる合成データでの検証に留まり、実データによる検証はまだできていない（この制約は変わらない）。
- **実際の`.xlsx`経路の検証**：`quantity_annotation_excel_verification.js`はツール自身の「作業中JSON読込」（`work_format: excel-json-work-v2`という正規経路だが、`XLSX.read()`自体は経由しない）で検証していたため、レビューで「.xlsx解析後の列順序・数値セル・数式セル・空欄・見出し正規化を通っていない」と指摘された。`quantity_annotation_excel_xlsx_verification.js`（新規）は、実際に`.xlsx`バイナリを生成し、Playwrightの`page.route()`でCDN(`cdn.jsdelivr.net`)へのリクエストをローカルの同一バージョンのSheetJSへ差し替えることで、製品側のCDN依存・依存ゼロ方針を一切変更せずに実`.xlsx`アップロード経路を検証した（このサンドボックス環境ではCDNアクセス自体がネットワークポリシーで拒否されているため、`page.route()`による差し替えが必須だった）。列順序が表内位置の根拠へ正しく反映されること（作業中JSON側のテストとは逆の列順序を使い、根拠の有無が実際に変わることを確認）、数式セルのキャッシュ済み値からの抽出、単位付き書式の数値セル（`preserveTypes`設定により挙動が変わることを含む）、空欄・管理列の扱いを確認した。テスト実行には追加で`xlsx`パッケージが必要（`tools/design_notes/package.json`、`npm install`が必要。製品コードには影響しない）。

## 3. 挿入点C：照合エンジン側での「比較レコード組み立て」

### 3.1 位置

`json_ab_trace_matching_tool_v12.1.15.html`の照合完了後（`mergedResult`が populate された後）に、新しいオプトインのボタン（例：`downloadComparisonSidecarBtn`）を追加する。

### 3.2 照合行から元レコードを引く契約（必須修正2への対応）

初版の「`_sysRowId`/`_plmRowId`等の内部キーで引き当てる」という記述を、実装可能な形に確定する。

**`traceMatrixRows`を生成する時点で、各行に次の4フィールドを内部的に保持させる**（表示用の`A_ID`/`B_ID`は従来どおり変更しない。これは表示専用の別フィールドとして併存させる）：

```js
{
  requirement_trace_id,   // sysList側レコードのtrace_idそのもの
  actual_trace_id,        // plmList側レコードのtrace_idそのもの
  matcher_a_id,            // 現行のA_ID(表示用、従来通り)
  matcher_b_id             // 現行のB_ID(表示用、従来通り)
}
```

取得元：`traceMatrixRows`の生成ロジック（`json_ab_trace_matching_tool_v12.1.15.html`、`matchPlmParts()`・`traceMatrixRows`組み立て箇所）が、既に`sysRowId()`/`plmUniqueKey()`を呼んで`A_ID`/`B_ID`を決定している。その同じ呼び出し箇所で、対応する`sysList`/`plmList`エントリの`row.trace_id`を追加で保持させるだけでよく、新しい突き合わせロジックを別途書く必要はない。

**未定義だった4つの挙動を確定する**：

| ケース | 挙動 |
|---|---|
| `trace_id`重複（同一側に同じ`trace_id`が複数） | `relationship.source`を`"ambiguous_trace_id"`とし、`comparison`は生成しない（`null`）。人間確認を必須にする。重複自体は`baseline_v1_handoff.md`の既存不変条件（本体側の`trace_id`一意性検証、`excel_to_json_conversion_tool_v2.0.8.html`の「`trace_id`が重複していない」検証、§10）に反する入力であり、sidecar側で無理に解決しようとしない。 |
| 元レコードが見つからない（`quantity-annotation`側に該当`trace_id`がない） | `comparison`は`null`。`automation.auto_applicable`は生成せず、代わりにレコード自体を生成しない（3.4節の`not_analyzed`集計へ回す）。 |
| A未対応／B未参照（`traceMatrixRows`上でペアが存在しない） | そもそも`requirement_ref`×`actual_ref`のペアが存在しないため、`trace-comparison/1.0-rc1`のレコード自体を作らない。既存UIの「A未対応」「B未参照」集計（`baseline_v1_handoff.md` §7.2.4）とは別の関心事として扱う。 |
| 同じA-Bペアが複数行に現れる（重複マッチ） | `comparison_id`は`requirement_ref.trace_id + actual_ref.trace_id + quantity_pair_id`から決まるため、複数行があっても同じ`comparison_id`に収束する。後勝ち・先勝ちの優先順位は決めず、**生成時点で重複を検出したら警告として記録し、両方は生成しない**（どちらの`relationship`情報を採用すべきか自明でないため、人間確認へ回す）。 |

### 3.3 取り違え・陳腐化の検出（必須修正3への対応）

突き合わせ時に、次の順で整合性を確認する：

1. `quantity-annotation`ファイルの`dataset_signature`を、現在ロード中の`sysList`/`plmList`から再計算した値と比較する。不一致なら、そのファイル全体を`source_mismatch`として扱い、そのファイルに由来する比較レコードは一切生成しない（部分的に使わない）。
2. 個別レコードの`content_hash`を、`mergedResult.sysList`/`plmList`の該当レコードの`source_raw_text`/`source_record`から再計算した値と比較する。不一致なら、その`trace_id`のレコードだけを`stale_annotation`として扱う。
3. 1・2のいずれにも該当しない場合のみ、通常の比較処理へ進む。

**`source_mismatch`・`stale_annotation`は、「該当数量なし」（3.4節の`not_analyzed`）とは明確に区別する**。前者は「入力が信頼できない」ことを示し、後者は「入力は信頼できるが対象がない」ことを示すため、UI上の扱いも診断上の重大度も異なるべきである。

### 3.4 全組み合わせ生成の絞り込み（必須修正6・再指摘への対応）

要求側`analyses[]`×実仕様側`analyses[]`の全直積をそのまま候補にするのではなく、次の順で段階的に絞り込む。

**再指摘への対応**：以前の版は「除外件数と理由コードを`not_analyzed`集計として保持する」という設計だったが、これは件数だけの集約で「どの数量ペアがなぜ落ちたか」を個別に追跡できない、また実データ（`CONCEPT_DICTIONARY`がHVACサンプル限定）では同一次元の候補が僅差で並ぶことがあり、候補集合の「重なり」による足切りが広すぎたり狭すぎたりし得る、との指摘を受けた。`not_analyzed`を**件数集計ではなく、除外された数量IDペアと理由コードの個別リスト**に変更し、除外規則自体も段階的な候補生成（全直積をメモリ上に展開しない）へ改める。

**候補生成の段階化**（全直積を作らず、次元インデックス等から段階的に絞り込む）：

1. **canonical dimension一致**：`quantity.unit.dimension`が一致する組み合わせだけを候補にする（次元ごとにインデックスを作り、`power`同士・`temperature`同士のように次元が一致する数量だけを突き合わせる。これにより`N×M`の全組み合わせを毎回試す必要がなくなる）。
2. **設計特性候補の一致**：段階1を通過したペアについて、`generatePropertyCandidates()`の出力上位候補の`concept_id`が一致するものを優先する（7節の`margin`ベースの縮約と合わせて使う。候補集合の「重なり」だけで機械的に足切りするのではなく、次点候補の扱いも含めて8節参照）。
3. **条件候補の整合**：`condition_candidates`が双方にある場合、次元・値が大きく矛盾するペア（例：要求側は「50 °Cで」、実仕様側は「10 °Cで」）を除外する。
4. **意味ペアからcomparison mode導出可能**：`deriveComparisonModeCandidate()`が`null`を返すペア（`COMPARISON_MODE_DERIVATION_TABLE`に未登録の組み合わせ）を除外する。これは新しい絞り込みではなく、既存の安全設計（`baseline_v1_handoff.md` §4不変条件2・3）をそのまま候補削減にも使うということ。
5. 1〜4を通過してなお複数ペアが残る場合（一対多）は、どちらも正しく複数対応し得るケース（例：1つの実仕様値が複数の要求条件を満たす）と、競合する複数候補（同じ実仕様値が複数の無関係な要求と紐づいてしまう）を区別する規則が必要（未確定）。
6. 最大候補数（例：1レコードあたり`N`件まで）を超えた場合の打ち切りと、打ち切ったこと自体を診断情報に残す規則が必要（未確定）。

**`not_analyzed`のデータ形（個別ペア追跡）**：

```json
{
  "not_analyzed": [
    {
      "requirement_quantity_id": "q-be1c0825cbf56b0f",
      "actual_quantity_id": "q-9f0a1b2c3d4e",
      "reason_code": "dimension_mismatch",
      "detail": "requirement.dimension=power, actual.dimension=temperature"
    }
  ]
}
```

理由コード：`no_annotation`（3.2節、quantity-annotation側に該当`trace_id`が見つからない）／`source_mismatch`／`stale_annotation`（3.3節）／`dimension_mismatch`／`concept_mismatch`／`condition_mismatch`／`no_comparison_mode`／`candidate_limit_exceeded`（5節・6節、最大候補数超過）。件数だけのサマリが必要な場合は、この個別リストから都度集計すればよく、個別リストと別に件数フィールドを二重に持たせない。

## 4. UIへの影響（オプトインの原則）

3箇所の新設ボタンはいずれも、既存のボタン・既存のイベントハンドラ・既存のJSON生成関数を変更しない、**追加のみ**の変更にする。利用者がクリックしなければ何も生成されず、既存のワークフロー（PDF/Excel変換→照合→レビュー）は現状のまま動作する。

## 5. コードの重複を避ける（推奨修正への対応）

`extractQuantities()`・`simpleHash()`・`generatePropertyCandidates()`等のロジックを3つのHTMLへ個別にコピーすると、修正が3箇所に分散し、`ruleset_version`の整合性も崩れやすくなる。共有方法の候補（未決定、実装時に選定）：

- 3ファイルが`<script>`で読み込む共通の外部JSファイル（`tools/shared/quantity_core.js`のような単一ソース）に切り出す。単一HTMLファイルという既存の配布方式（ネットワーク接続なしで動作する前提）を崩さないよう、ビルド時にインライン化する手順が必要になる可能性がある。
- 最低限、`ruleset_version`に記録するバージョン文字列だけは3ファイルで確実に同期させる（コードは別々でも、フィンガープリントで不整合を検出できるようにする）。

## 6. 回帰テスト（実装前に用意する）

sidecar結合処理（2〜3節）自体は、既存5スイート（プロトタイプ側の数量抽出・意味候補生成）ではカバーされない新規ロジックのため、実装時に少なくとも次のケースをテストする。1〜8は前回の版から引き継ぎ、9〜16は再指摘（ハッシュ完全性、列役割自動判定、レビュー状態遷移、手動追加・付け替え、候補数膨張、スキーマ検証）への追加。

**ID・ハッシュ関連**：
1.（**PDF側・Excel側完了**）1文/1セルに複数数量がある場合に、正しい`quantity_id`で`analyses[]`が分かれること（`quantity_annotation_pdf_verification.js`・`quantity_annotation_excel_verification.js`で確認）
2.（**PDF側・Excel側完了**）同一表記の数量（例：「50 °C」が同じ文/セルに2回出現）が異なる`source_span`で区別されること（`occurrence_index`ではなく`source_span`が識別の根拠になっていることを、実際にPlaywrightで確認済み。`quantity_extraction_prototype.js`側の回帰テストで既に検証、2.0節）
3.（**PDF側・Excel側完了**）`content_hash`のハッシュ対象（本文・タグ、Excel側は列見出し・行識別情報・同一行内の他列も含む）をそれぞれ単独で変更すると、ハッシュ値が不一致になること（本文だけを変更対象にしていないかの検証。両ツールで確認）
4. JSONオブジェクトのプロパティ順だけを変えても`content_hash`/`dataset_signature`が同じ値になること（ハッシュ対象を正規化してから計算していることの検証。`v12CanonicalJson()`/`canonicalValue()`のキーソート仕様に依拠しており、専用テストは未実装）
5.（**PDF側完了、Excel側は別形の検証で完了**）`_trace_records`のレコード順を変更しても`dataset_signature`が同一値になること（`trace_id`昇順への正規化により順序非依存と仕様化した）。PDF側は実際に配列を反転させて確認したが、Excel側は`source_path`が入力配列の位置をそのままエンコードするフィールド（`buildTraceOutput()`の既存仕様）であるため、単純な配列反転では「内容が同一のまま順序だけ変わる」状況を作れない（反転すると各レコードのsource_path自体が変わってしまう）。位置エンコードされたフィールドを内容の一部として扱い配置が変われば陳腐化検出するのは安全側の設計として妥当と判断し、代わりに「比較エンジン側がtrace._trace_recordsだけから独立にdataset_signatureを再計算できる」という、より直接的な契約をNode側の独立実装で検証した（`quantity_annotation_excel_verification.js`）。
6. 旧`ruleset_version`のquantity-annotationファイルを現行ルールで読み込むと、警告または再生成要求になること（未実装。読み込み側＝比較エンジンが未実装のため）
7.（**PDF側・Excel側完了**）`_trace_records`の再生成後（同一入力での再実行）も`quantity_id`/`content_hash`/`dataset_signature`が変化しないこと（2.0節の内容ベースID規則の安定性そのものの検証。両ツールで確認。`comparison_id`は比較エンジン未実装のため未検証）

**照合行・元レコード解決関連**：
8. `A_ID`/`B_ID`が`trace_id`と一致しないケース（3.2節、実データで既に確認済みの`B_ID != trace_id`）でも`requirement_trace_id`/`actual_trace_id`が正しく解決されること
9. A/B両側で`trace_id`が重複するケースで、3.2節の表のとおり`ambiguous_trace_id`として扱われ、`comparison`が生成されないこと
10. 元レコードが欠落しているケース（`quantity-annotation`側に該当`trace_id`がない）で`not_analyzed`（理由: `no_annotation`）に記録され、エラーにならないこと
11. 同一A-Bペアが複数の照合行に現れるケース（重複マッチ）で3.2節の表のとおり処理されること
12. 手動追加・付け替え（`traceMatrixRows`が通常照合以外の経路で生成された場合）でも`requirement_trace_id`/`actual_trace_id`が正しく保持されること（未実装、`relationship.source: "manual"`のケース）
13. トレースマトリクスの表示順変更やフィルタ後も、同じ元レコードへ解決すること

**取り違え・陳腐化関連**：
14. `quantity-annotation`の原文ハッシュ不一致が`stale_annotation`として検出され、通常の比較（`not_analyzed`の`no_annotation`）と混同されないこと

**候補生成・絞り込み関連**：
15. 単位次元が不一致のペアが3.4節の段階1で除外され、`not_analyzed`（理由: `dimension_mismatch`）に個別ペアとして記録されること
16. A未対応／B未参照のケースで、そもそも`trace-comparison/1.0-rc1`レコードが生成されないこと
17. 温度・能力・圧力等、複数次元の数量が同じ行に混在するケースで、無関係な次元同士がペアにならないこと
18. 標準値と対応後値の一対多比較（3.4節5番、未確定の規則）が要件として洗い出されていること
19. 数量が多いレコード同士の組み合わせで候補数が`N×M`へ単純に膨張しないこと（3.4節6番の打ち切り規則の検証）

**列役割自動判定関連**（2.3節）：
20.（**完了**）`標準機種情報`/`検討結果`以外の同義見出し（例：「標準仕様」「客先対応値」）でも役割候補が生成されること（`quantity_annotation_excel_verification.js`で確認）
21.（**完了**）列役割が曖昧な場合（確信度不足）に、自動で比較へ進まないこと（根拠の乏しい列がrole_candidatesを持たないか低確信度のままであることを確認。比較自体はフェーズAの範囲外＝未実装のため「進まない」の直接検証ではなく、候補生成が自動確定しないことの検証）

**レビュー状態遷移関連**（`trace_comparison_schema_v1.md` §10）：
22. `satisfaction`が前提（`quantity_extraction`/`property_mapping`/`comparison_mode`）の確認前は`not_eligible`のままで、確認操作を受け付けないこと
23. `comparison === null`のケースで`satisfaction`が最初から`not_applicable`で初期化されること
24. `property_mapping`の判断を変更した場合、下流（`comparison_mode`/`satisfaction`）の確認状態が失効する（再確認が必要になる）こと（未確定の仕様、実装時に決める）

**スキーマ検証・統合テスト関連**：
25.（**quantity-annotation側完了**）`quantity-annotation/1.0-rc1`・`trace-comparison/1.0-rc1`のJSON Schemaを定義し、生成物を機械検証すること。`quantity-annotation/1.0-rc1`は`tools/design_notes/quantity_annotation_schema_v1.json`を作成し、`tools/design_notes/json_schema_minivalidator.js`（依存パッケージなしの最小JSON Schema検証器。ajv等はプロジェクトの依存ゼロ原則により導入せず、実際に使うキーワードのみ自前実装）で実際のPDF側生成物を検証済み（`quantity_annotation_pdf_verification.js`)。`trace-comparison/1.0-rc1`側のSchemaは未着手。
26. PDF側出力→数量注釈sidecar→Excel側出力→照合→比較sidecarという一連の流れを、実ブラウザで統合的に確認すること（`runtime_fixtures/`の先行検証と同じ手法で、3ツール間のデータ受け渡しを実データで確認する）
27.（**完了・再実行可能**）Node（`crypto.createHash('sha256')`）・ブラウザ（`crypto.subtle.digest`）・純JSフォールバック（`v12Sha256Fallback()`）の3経路が、同じ入力に対して同じハッシュ値を返すこと（既知ベクトルテスト）。日本語、全角ASCII、CRLF改行、連続空白、絵文字、境界の曖昧性を試す組み合わせ（`["ab","c"]`と`["a","bc"]`）等11個の固定ベクトルで確認する。当初は結果fixtureのみコミットし、検証スクリプト自体はscratchに置いたままだったため「一回限りの実証」に過ぎず、本体側の`v12HashParts()`/`v12Normalize()`/`v12Sha256()`/`v12Sha256Fallback()`が将来壊れても自動検出できない、との指摘を受けた。次の2ファイルを恒久的にリポジトリへ保存し、再実行可能にした。
    - `tools/design_notes/hash_3paths_verification.js`：Playwrightに依存する完全版。ブラウザ2経路（`crypto.subtle`・`crypto.subtle`を無効化して強制したフォールバック）を実際に実行し、Node経路と突き合わせる。他5スイートと異なりPlaywright必須のため、意図的に「依存パッケージなし」の原則の例外としている。実行結果を`runtime_fixtures/hash_3paths_verification.json`へ書き出す（`source_file`・`source_blob_sha`（`spec_to_json_conversion_tool_v1.18.html`のgit blobハッシュ）・11ベクトルの`namespace`/`parts`・3経路それぞれの値を保存する）。
    - `tools/design_notes/hash_3paths_node_check.js`：Playwright不要の軽量版。他5スイートと同じく依存パッケージなしで動く。(a) 現在の`spec_to_json_conversion_tool_v1.18.html`のgit blobハッシュが、fixtureに記録された`source_blob_sha`と一致するか（不一致ならHTML側が変更されており、完全版の再実行が必要という警告）、(b) 11ベクトルそれぞれについてNode側のハッシュ計算が記録済みの値を再現するか、を回帰確認する。ブラウザ経路そのものは実行しないため、`crypto.subtle`/`v12Sha256Fallback()`側の退行は検出できない（それは完全版でのみ検出できる）。
    この検証の過程で、`trace_comparison_example_verification.js`の`hashParts()`が`namespace`まで正規化しており、実際の`v12HashParts()`（`namespace`は正規化しない）と契約が食い違っていたことを発見し、訂正した。

## 7. 候補配列から単一`mapping`への縮約（必須修正4の一部への対応）

`generatePropertyCandidates()`は候補の配列を返す（`semantic_mapping_prototype.js` 484行目）。`trace_comparison_schema_v1.md`の`mapping`セクションは単一の`concept_id`を想定していたが、複数候補がある場合にどれを採用するかの規則が未定義だった。

`evaluateAutoApplicable()`が`requirementCandidates`/`actualCandidates`に既に適用している「上位候補と次点候補の差（`marginOf()`）が閾値`AUTO_APPLICABLE_THRESHOLDS.margin`（現行0.2）以上かどうか」という同じ判定パターンを、`property_candidates`にもそのまま適用する：

- 上位候補と次点候補の差が閾値以上 → `mapping.status: "resolved"`、上位候補を`mapping.concept_id`として採用。
- 差が閾値未満、または候補が1件もしくは0件 → `mapping.status: "ambiguous"`、`mapping.concept_id`は`null`とし、`mapping.candidates`に全候補を残す（消さない）。この場合、その比較レコードは`automation.auto_applicable.applicable`の計算に進まず、`fail_reasons`に`"設計特性の対応が一意に決まらない"`を追加する。

これは新しい閾値を発明するのではなく、既存の`marginOf()`パターンを一貫して適用するだけであり、`propertyConfidence`という単一スカラー値を前提にしていた現行の`evaluateAutoApplicable()`のシグネチャ変更（`propertyConfidence`→`propertyCandidates`配列を渡す形へ）が必要になる。この関数シグネチャ変更は本体統合時のプロトタイプ側の修正事項として`trace_comparison_schema_v1.md`側にも記録する。

## 8. 未解決事項

- **本体3ツールへの実装は一部着手**：PDF側の数量注釈シャドー出力（2.2節）はフェーズAで実装・実ブラウザ検証済み（`spec_to_json_conversion_tool_v1.18.html`の`buildQuantityAnnotationSidecar()`/`v12ExportQuantityAnnotationSide()`、新設ボタン`#btn-quantity-annotation-export`/`-b`）。Excel側の数量注釈シャドー出力（2.3節）も同様にフェーズAで実装・実ブラウザ検証済み（`excel_to_json_conversion_tool_v2.0.8.html`の`buildQuantityAnnotationSidecarExcel()`/`exportQuantityAnnotationExcel()`、新設ボタン`#buildQuantityAnnotationBtn`）。`json_ab_trace_matching_tool_v12.1.15.html`側の`requirement_trace_id`/`actual_trace_id`/`matcher_a_id`/`matcher_b_id`保持（3.2節）、比較レコード組み立て（3節）は未着手のまま。
- **レビュー状態の永続化先の一本化**：`trace-comparison/1.0-rc1`の`review`セクションをファイルに書き戻す運用にするか、既存の`localStorage`（`v11_trace_review_store`）に相乗りさせるかは未決定。後者は`_reviewKey`のキー形式（`matcher_id`ベース）が`comparison_id`（`trace_id`ベース）とキー空間が異なるため、素直には統合できない。
- **コード共有方式**（5節）：単一HTMLファイル配布という制約下での共通化方法が未決定。`simpleHash()`ではなく`v12Sha256()`/`v12HashParts()`（2.0節）を共有対象にする、という方針までは決めた。
- **`generatePropertyCandidates()`の概念辞書**：本体統合の前提条件であり、これ単体でも相応の設計・実データ収集作業になる（HVACサンプル限定の`CONCEPT_DICTIONARY`を実データから作り直す必要がある）。
- **`evaluateAutoApplicable()`のシグネチャ変更**（7節）：`propertyConfidence`（スカラー）→`propertyCandidates`（配列＋margin判定）への変更は、既存86件のテストスイートに新規ケースを追加する必要がある。
- **列役割候補生成の規則自体**（2.3節）：キーワード集合・重み付けは単一のHVACサンプル＋合成データだけでは実データによる検証ができない（実装自体は完了）。
- **列役割の手動override**（2.3節4・5・6番）：設計文書が「任意設定」と明記している機能で、フェーズAでは未実装のまま（自動候補生成のみ）。
- **候補生成の一対多規則・最大候補数**（3.4節5・6番）：未確定。
- **`quantity-annotation/1.0-rc1`のJSON Schema定義**（6節25番）：作成・実生成物での検証済み。`trace-comparison/1.0-rc1`側のSchemaは未着手のまま。

## 9. `-rc1`から正式版への昇格条件

次がすべて満たされた時点で、`quantity-annotation/1.0-rc1`・`trace-comparison/1.0-rc1`から`-rc1`を外して正式版とする：

1. 6節の回帰テスト（26項目）が実装・全件成功していること
2. 7節の`evaluateAutoApplicable()`シグネチャ変更とそれに伴うテスト追加が完了していること
3. 3.2節の4ケース（`trace_id`重複・元レコード欠落・A未対応/B未参照・重複マッチ）が実データまたは合成データで一度は再現・確認されていること
4. `json_ab_trace_matching_tool_v12.1.15.html`側に3.2節のフィールド保持が実際にコードとして実装されていること（設計だけでなく実装）
5. `trace_comparison_schema_v1.md` §11の完全な具体例が、実データからの機械生成・機械検証で作られており、かつ文書に埋め込まれたJSONと生成物のdeep-equalが自動テストされていること（`trace_comparison_example_verification.js`で達成済み。文書側の手修正による乖離を、実際に一度検出・修正した経緯がある。今後スキーマ側に変更があった場合は再実行して検証を保つ）
6. ハッシュの桁数・正規化方式・ハッシュ対象範囲が固定されていること（`content_hash`は64桁=256-bitのまま切り詰めない、意味候補生成へ渡す入力一式(`source_record`全体)をcanonical JSON化してハッシュ対象にする、`quantity_id`は32桁=128-bitで`id_hash_algorithm`により明示、正規化・ハッシュ入力構築は`v12Normalize()`/`v12HashParts()`と同一契約に統一。**この条件は`content_hash`/`quantity_id`/`dataset_signature`ともPDF側・Excel側で達成済みであり、比較エンジン側（挿入点C）のみ未達成**（下記の状態表を参照）。
7. 8節の未解決事項のうち、少なくとも概念辞書とコード共有方式について実装方針が決まっていること（完全解決までは求めないが、「未定」のままでの正式版化はしない）

**ハッシュ関連の実装状態**（条件6の内訳。「設計確定」と「実装済み」を混同しないよう明示する）：

| 項目 | 状態 |
|---|---|
| `content_hash`の完全長化（64桁）・対象範囲拡張（`source_record`全体） | `trace_comparison_example_verification.js`で実装・テスト済み |
| `quantity_id`の128-bit化 | `trace_comparison_example_verification.js`で実装・テスト済み |
| ハッシュ入力構築の`v12HashParts()`との契約統一（namespaceは正規化しない、各partのみ個別正規化、NUL文字区切り） | `trace_comparison_example_verification.js`で実装・テスト済み（実際の`v12HashParts()`の契約と食い違っていた箇所を3経路同値テストで発見・訂正した経緯がある） |
| `dataset_signature`の64桁仕様 | 設計確定（`trace_comparison_schema_v1.md` §2.0） |
| `dataset_signature`の生成・検証（**PDF側**） | **フェーズAで実装・実ブラウザ検証済み**（`spec_to_json_conversion_tool_v1.18.html`の`v12ComputeDatasetSignature()`。`trace_id`昇順への正規化、重複`trace_id`拒否、レコード順序変更に対する不変性を`quantity_annotation_pdf_verification.js`で確認。`trace_comparison_example_verification.js`（Node側の比較レコード例）側は、`trace-comparison`セクション自体が未実装のため引き続き`null`のまま）。**初回実装のレビューで、ハッシュ対象が元trace(`trace._trace_records`)ではなくsidecar自身の派生レコード(`{trace_id, content_hash, analyses}`)になっている誤りが見つかり修正した**（analyses/意味候補/rulesetの結果に依存してしまうと、抽出規則が変わっただけで元データが同じでも署名が変わり、逆に元trace側のタグ等が変わっても本文・タグのハッシュ範囲が同じなら検出できない場合がある、という取り違え検出の根幹に関わる欠陥だった）。修正後は`trace._trace_records`だけから導出し、side違い(analyses/意味候補の中身が変わる)でも署名が変わらないこと、比較エンジン側が`trace._trace_records`だけから独立に同じ値を再計算できることを検証した。 |
| `dataset_signature`の生成・検証（**Excel側**） | **フェーズAで実装・実ブラウザ検証済み**（`excel_to_json_conversion_tool_v2.0.8.html`の`v12ComputeDatasetSignature()`、PDF側と同名・同一契約。`trace_id`昇順への正規化、重複`trace_id`拒否を`quantity_annotation_excel_verification.js`で確認。レコード順序変更に対する不変性は、Excel側`_trace_records`の`source_path`が入力配列位置をそのままエンコードする既存フィールドであるため単純な配列反転では検証できず、代わりに「trace._trace_recordsだけからの独立再計算が一致する」という、より直接的な形で検証した） |
| `dataset_signature`の生成・検証（比較エンジン側） | 未実装 |
| 本体3ツール（ブラウザ）でのハッシュ生成（**PDF側・Excel側**） | **実装・実ブラウザ検証済み**（両ツールとも`v12Sha256()`/`v12HashParts()`/`v12Id()`を同名・同一契約で移植し再利用。Excel側の`canonicalJson`相当は、ツール既存の`canonicalValue()`をそのまま再利用し重複実装しなかった。3ツール間でハッシュ計算ロジックの二重管理を避けている） |
| 本体3ツール（ブラウザ）でのハッシュ生成（比較エンジン側） | 未実装 |
| Node・`crypto.subtle`・純JSフォールバックの3経路の同値性 | **検証済み・再実行可能**（`tools/design_notes/hash_3paths_verification.js`（Playwright必要）＋`hash_3paths_node_check.js`（依存パッケージなし）。日本語・全角ASCII・CRLF・連続空白・絵文字を含む11ベクトルすべてで3経路一致を確認。この検証で`hashParts()`のnamespace正規化が実際の`v12HashParts()`と異なる契約になっていたことを発見・訂正した） |

**この改訂までに完了した項目**（上記条件との対応）：条件5（§11の機械検証・deep-equal自動化）は完了。条件6は`content_hash`/`quantity_id`/`dataset_signature`・ハッシュ入力構築契約・3経路同値性について、PDF側・Excel側とも完了（比較エンジン側のみ未完了、上表）。PDF側・Excel側それぞれの`quantity-annotation/1.0-rc1`生成（2.2節・2.3節）はフェーズAで実装・実ブラウザ検証済み（`quantity_annotation_pdf_verification.js`37件、`quantity_annotation_excel_verification.js`38件（意味候補への列見出し・他セルの漏れ込み防止、数量ゼロ件の列をcolumn_role_candidatesから除外、の回帰テストを追加）、`quantity_annotation_excel_xlsx_verification.js`13件（実`.xlsx`経由、新規）、`quantity_annotation_ported_lib_check.js`10件（両ツールの移植ライブラリを検証）、`quantity_annotation_schema_check.js`9件、いずれも成功。同一スナップショット保証は、PDF側は`v12BuildTrace()`呼び出し回数のモンキーパッチ計測、Excel側は1クリックで両ファイルをダウンロードする実装＋`generated_at`一致検証で、それぞれ直接検証した。意図的な退行注入で実際に検出できることも両ツールで確認した）。`quantity-annotation/1.0-rc1`のJSON Schema（`quantity_annotation_schema_v1.json`）も作成し、`quantity`/`evidence`/`intervalBound`の内部構造(区間の`value`/`inclusive`必須化、単位・抽出信頼度の必須フィールド)まで検証する形に強化した上で実生成物を検証済み（6節25番の一部。Excel固有の`column_role_candidates`も含めてSchema化した）。`quantity.kind`は当初レビューで`const:"interval"`への変更を提案されたが、`quantity_extraction_prototype.js`（297行目）が「12/15 kW」のような並列値に対し`kind:'alternatives'`（`lower`/`upper`を持たない別形状）を実際に生成することを確認したため採用せず、`oneOf`による判別可能な共用体（`json_schema_minivalidator.js`に追加）で両形状を区別しつつ`kind:"unknown"`等は拒否する形にした。トップレベルに`id_hash_algorithm: "SHA-256/128"`フィールドを追加し、文書・実出力・Schemaの3者を一致させた。`source_span.end>=start`・`source_text`が元trace(`source_raw_text`)の`source_span`位置と一致すること、というJSON Schemaでは表現できない不変条件も、実データに対する検査として追加した。条件1〜4・7は引き続き未達（比較エンジン側の回帰テストは設計のみで未実装、`evaluateAutoApplicable()`シグネチャ変更は未着手、`trace-comparison`側の本体コード実装は未着手）。フェーズA（2節、PDF側・Excel側の数量注釈シャドー出力）は完了とみなせる状態になった。

## 10. 次工程の推奨順序

1.（**完了**）2節の数量注釈シャドー出力（PDF/Excel側、既存コードへの影響ゼロ）を実装・検証する。6節の回帰テストのうち1〜3・5・7・20・21番はこの段階で検証済み（4・6番は比較エンジン側実装後に検証、25番は`quantity-annotation`側のみ完了）。
2. 対象帳票（本体で実際に使われているPDF/Excelサンプル、可能なら匿名化済みのもの）を用いて、概念辞書・列役割候補生成の規則を実データから検証・確定する（1番の規則自体は合成データで実装済み、実データ検証は未実施のまま）。
3. 7節の`evaluateAutoApplicable()`シグネチャ変更をプロトタイプ側（`semantic_mapping_prototype.js`）に先行実装し、86件のテストスイートを更新する（本体へ移植する前にプロトタイプ側で安全性を確認する、という既存の開発順序を踏襲）。
4. 3節の比較レコード組み立てを実装し、6節の回帰テストのうち8〜19番、および4・6番を検証する。
5. `trace_comparison_schema_v1.md` §10のレビュー状態遷移を実装し、6節22〜24番を検証する。
6. レビュー状態の永続化先を決定する（8節）。
7. `trace-comparison/1.0-rc1`側のJSON Schema定義とブラウザ統合テスト（6節26番）を追加する。
