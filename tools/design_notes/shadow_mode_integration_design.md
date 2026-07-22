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
- **実際の`.xlsx`経路の検証**：`quantity_annotation_excel_verification.js`はツール自身の「作業中JSON読込」（`work_format: excel-json-work-v2`という正規経路だが、`XLSX.read()`自体は経由しない）で検証していたため、レビューで「.xlsx解析後の列順序・数値セル・数式セル・空欄・見出し正規化を通っていない」と指摘された。`quantity_annotation_excel_xlsx_verification.js`（新規）は、実際に`.xlsx`バイナリを生成し、Playwrightの`page.route()`でCDN(`cdn.jsdelivr.net`)へのリクエストをローカルの同一バージョンのSheetJSへ差し替えることで、製品側のCDN依存・依存ゼロ方針を一切変更せずに実`.xlsx`アップロード経路を検証した（このサンドボックス環境ではCDNアクセス自体がネットワークポリシーで拒否されているため、`page.route()`による差し替えが必須だった）。列順序が表内位置の根拠へ正しく反映されること（作業中JSON側のテストとは逆の列順序を使い、根拠の有無が実際に変わることを確認）、数式セルのキャッシュ済み値からの抽出、空欄・管理列の扱いを確認した。テスト実行には追加で`xlsx`パッケージが必要（`tools/design_notes/package.json`、`npm ci`が必要。製品コードには影響しない）。

> **訂正（6df4304へのレビューで発見・修正、中重大度2件）**：
>
> 1. **既定設定で単位付き数値セルを抽出できなかった**：`preserveTypes`（数値・真偽値を保持、既定true）チェック時、Excel側の既存の`convertCellValue()`は数値セルの生値（例: `12.5`）をそのまま保持するため、セル書式で単位を表現する帳票（例: 表示形式`0.0" kW"`で画面上は「12.5 kW」と見えるが、生値は`12.5`のみ）では、単位情報が失われ数量を抽出できていなかった。これは安全側の失敗ではあるが、「利用者の様式準備・設定を極力なくす」というExcel側の主要要求に反すると指摘された。修正: 新設した`v12DisplayedRowsForCurrentSheet()`が、既存の`convertSheet()`を`preserveTypes`だけ一時的にfalseへ切り替えて再利用し（呼び出し後は必ず元に戻す。DOM表示や他の変換結果には影響しない）、セルの表示文字列版の行配列を得る。数量抽出は、数値型セルかつ表示文字列が生値と異なる場合にその表示文字列を使う（生値自体は変更しない）。各`analysis`に`source_representation`（`"raw_value"`／`"formatted_display"`）・`source_value_text`（実際に抽出対象にした文字列）を追加し、どちらのテキストに対する`source_span`かを明示した。元trace側にも`source_record_display`（列ごとの表示文字列）を追加し（`outputData`自体は変更せず、`deepClone`したコピーへ追加する。既存の`#downloadJsonBtn`が後で同じ`outputData`を参照しても影響しない）、`content_hash`・`dataset_signature`のハッシュ対象に含めた。これにより、生値を変えずセル書式だけ変更した場合（例: `kW`→`kPa`。`W`は`quantity_extraction_prototype.js`の`UNIT_ALT`に無い単位のため抽出自体が成立せず検証に使えないと判明し、認識済みの別単位で検証した）でも陳腐化を検出できることを確認した。
> 2. **テスト依存が再現可能に固定されていなかった**：`package.json`が`playwright`を`^1.56.1`という範囲指定にしつつ、`package-lock.json`を`.gitignore`していたため、将来の`npm install`が同じテスト環境を再現する保証がなかった。修正: バージョンを完全固定（`1.56.1`）にし、`package-lock.json`をコミットし、テスト実行手順を`npm ci`に統一した。ブラウザ側（`page.route()`で差し替えるCDN版と同一内容のローカルコピー）とNode側（`package-lock.json`が固定するコピー）の`xlsx`バージョンが実際に一致することを、`quantity_annotation_excel_xlsx_verification.js`が実行時に確認する。
>
> なお、`xlsx@0.18.5`にはnpm監査で検出される既知の脆弱性（Prototype Pollution、ReDoS、上流に修正版なし）がある。この依存はテスト実行時にのみ、自分で合成した`.xlsx`フィクスチャを処理する目的でのみ使用し、信頼できない外部入力を処理することはないため、実運用上のリスクは限定的と判断した。製品コード（`tools/`配下のツール本体）は引き続きこのパッケージに一切依存しない。

> **訂正（2b27e3eへのレビューで発見・修正、高深刻度1件・中重大度2件、「フェーズA完了は保留」の判定を受けた）**：
>
> 1. **【高深刻度】表示文字列の取得方法が「同一スナップショット保証」を再び破りうる、配列インデックスだけの位置結合だった**：`2b27e3e`時点の`v12DisplayedRowsForCurrentSheet()`は、元の`workbook`（Excelファイル読込直後の状態のまま、以後一切更新されない）を`convertSheet()`で毎回再変換して表示文字列版の行配列を得ていた。`exportQuantityAnnotationExcel()`はこれを、現在の`trace._trace_records`へ**配列の長さが一致することだけを確認して**先頭から順に結合していた（`trace._trace_records.forEach((r, i) => { r.source_record_display = displayedRows[i]; })`）。この方式は、セル値の編集・行の並べ替え（`#applySortToDataBtn`）・列名変更（ヘッダー編集）のいずれか1つでも操作された後にエクスポートすると、**stale化した元workbookの行順序と、操作後のcurrentDataの行順序がずれ、無関係な行の表示文字列を誤って結合してしまう**（例: 「12.5→20へ編集して抽出すると新値に追従するはず」の検証をすると、実際には編集前のstale値のまま返る。並べ替え後は別の行の値を誤って結合する）。`generated_at`が同一であることは構造的に保証されていても、その中身の対応関係自体が誤っているという、より根が深い問題だった。
>    修正: 表示文字列（number format適用後の文字列）を、**解析時点（`convertSheet()`実行時）に一度だけ捕捉し、`currentCellMeta[行index].__number_format`（列名→number formatコードの辞書）として、行本体とは別プロパティで保持する**方式へ全面的に置き換えた。`currentCellMeta`は行の並べ替え（`applySortToDataBtn`が`currentData`と対で並べ替える）・列名変更（`renameRowKey`ベースの改名。新設した`renameCellMetaColumn()`・`applyMapping()`の`__number_format`同期処理が、入れ子のキーも追従させる）・セル編集（`beginCellEdit`は同じ行の別プロパティ`[key]`へ`'manual-edit'`を書くだけで`__number_format`は破壊しない）のいずれでも`currentData`と一貫してindex整合性を保つこと、また`applyProfileToCurrentData()`内の`records = currentData.map((row, index) => ...)`→`buildTraceOutput()`内の`traceRecords = records.map((row, index) => ...)`がどちらもindex順を保つ写像であることを、実装前にコードを直接確認した上で採用した設計である。エクスポート時（`exportQuantityAnnotationExcel()`）は、`applyProfileToCurrentData(true)`が`currentCellMeta`をリセットする直前の`currentData`・`currentCellMeta`をローカル変数へ退避しておき、新設した`v12ResolveSourceRecordDisplay()`が、各traceレコードごとに**生値を`XLSX.SSF.format(保存済みformatコード, ライブな現在の生値)`へ都度再適用**して表示文字列を個別解決する（列名の対応は、適用中プロファイルの列マッピング規則がある場合`v12ColumnSourceAlias()`で逆引きする）。stale化した元workbookの再変換・配列インデックスだけの結合は完全に廃止した。回帰テストとして、セル編集後に新値へ追従すること・行を反転させても取り違えないこと（先頭↔末尾・隣接ペアの両方を1操作で確認）・列名変更後も新しい列名で解決できること・行を除外(`review_status: 'excluded'`)しても除外行自体および前後の生存行が取り違えられないこと（除外はフラグに過ぎず配列からの削除ではないことをコード調査で確認済み）を追加した（`quantity_annotation_excel_xlsx_verification.js`・`quantity_annotation_excel_verification.js`）。いずれも、修正前のコード（stale workbook再変換＋配列インデックス結合）へ一時的に戻すと実際に失敗することを確認した上でコミットしている。
> 2. **【中重大度】全シートモードで表示文字列機能が無診断のまま無効化されていた**：旧`v12DisplayedRowsForCurrentSheet()`は`outputModeAllSheets`のとき`null`を返すだけで、利用者には何も伝わらなかった。上記1番の修正により、この分岐自体が不要になった。`applyProfileToCurrentData()`は冒頭で`outputModeAllSheets = false`を強制しており、trace生成は常に単一シートの`currentData`／`currentCellMeta`（全シートモードの変換時も、シートごとに`convertSheet()`で生成され`__number_format`を保持している）を対象にするため、全シートモードかどうかに関わらず一貫して動作するようになった。
> 3. **【中重大度】表示形式の解決に失敗した場合、黙示的に生値のみへフォールバックし理由が残らなかった**：修正後は`v12ResolveSourceRecordDisplay()`が、解決に失敗した列を`record.source_record_display_unresolved: [{ source_field, code: "formatted_display_unavailable", reason }]`（`reason`は`value_not_numeric`／`format_empty`／`format_error`）として明示的に記録し、`source_record_display`には一切追加しない（黙示的な生値フォールバックの禁止）。「そもそもnumber formatが未捕捉（通常の数値列。大半のケース）」と「number formatはあるが解決に失敗」を区別し、前者では`source_record_display`・`source_record_display_unresolved`のどちらにも記録しないことを回帰テストで確認した。

> **訂正（4876006へのレビューで発見・修正、中重大度1件・回帰テスト不足1件）**：
>
> 1. **【中重大度】上記訂正2の「全シートモードでも一貫して動作する」という判断は誤りだった**：全シート変換は全シート分を`outputData`へ格納する一方、`currentData`／`currentCellMeta`には選択中シート分だけを設定する。数量注釈出力が`applyProfileToCurrentData(true)`を呼ぶと、この選択中シートだけからtraceが作られ、処理中に`outputModeAllSheets=false`へ変わるため、従来は全シート出力のように見える成功メッセージとともに1シート分だけを黙ってダウンロードしていた。異なるシートを1つのtraceへ連結すると、明示指定された`trace_id`の衝突や列役割候補の混在が起こり得る。フェーズAのExcel数量注釈出力は**単一シート単位を対象範囲**とし、全シート数量注釈は対象外と明記する。`exportQuantityAnnotationExcel()`の状態変更前に`allSheets.checked`／`outputModeAllSheets`／`originalWasAllSheets`の3状態を検査し、いずれかが真ならダウンロードを一切行わず、「数量注釈はシート単位で出力してください。全シートをオフにして対象シートを再変換してください」とエラー表示するガードを追加した。2シートの実`.xlsx`を通す回帰テストで、修正前は実際に選択中シート3件のtrace＋sidecarがダウンロードされて2件失敗し、修正後はダウンロード0件・明確な案内表示になることを確認した。
> 2. **【回帰テスト不足】`v12ColumnSourceAlias()`の単純なプロファイル列マッピング経路が未検証だった**：従来の列名変更テストは表編集UIによるヘッダー改名であり、`profile.columns[].source → target`の逆引きを通っていなかった。実`.xlsx`へ`{ source: "数値セル(単位付き書式)", target: "測定能力", type: "auto" }`、`preserve_unmapped:false`を適用し、`source_record_display["測定能力"] === "12.5 kW"`かつ数量analysisの`source_field === "測定能力"`になることを確認するテストを追加した。`v12ColumnSourceAlias()`を一時的にpass-throughへ退行させると、この2検査が実際に失敗することも確認済み。ドット区切りパスを含む複雑なマッピングは引き続き表示文字列逆引きの対象外だが、元列にnumber formatがありマッピング後の値が実在する場合は、`source_record_display_unresolved`へ`code:"formatted_display_unavailable"`・`reason:"path_mapping_unsupported"`・targetパスを記録するようにした。この診断テストも追加前には実際に失敗し、実装後に成功することを確認した。

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

0. 正本JSON Schemaで構造を検証し、`ruleset_version`を比較エンジンが明示的に対応する互換性表と照合する。現行の対応組は`quantity_extraction:v2.14`、`semantics_rules:v2.19`、`auto_applicable_thresholds:{modeConfidence:0.4,margin:0.2,propertyConfidence:0.7}`の完全な1組だけとする。いずれか1フィールドでも異なる場合はファイル全体を`ruleset_mismatch`として停止する。将来互換を認める場合は推測でバージョン範囲を広げず、検証済みの完全な組を互換性表へ追加する。
1. `quantity-annotation`ファイルの`dataset_signature`を、現在ロード中の`sysList`/`plmList`から再計算した値と比較する。不一致なら、そのファイル全体を`source_mismatch`として扱い、そのファイルに由来する比較レコードは一切生成しない（部分的に使わない）。
2. 個別レコードの`content_hash`を、`mergedResult.sysList`/`plmList`の該当レコードの`source_raw_text`/`source_record`から再計算した値と比較する。不一致なら、その`trace_id`のレコードだけを`stale_annotation`として扱う。
3. 0〜2のいずれにも該当しない場合のみ、通常の比較処理へ進む。

**`source_mismatch`・`stale_annotation`は、「該当数量なし」（3.4節の`not_analyzed`）とは明確に区別する**。前者は「入力が信頼できない」ことを示し、後者は「入力は信頼できるが対象がない」ことを示すため、UI上の扱いも診断上の重大度も異なるべきである。

> **実装更新（Phase B-1、2026-07-20）**：`quantity_sidecar_binding_core.js`と`json_ab_trace_matching_tool_v12.1.15.html`の任意入力欄に、ここまでの入力・検証・厳密結合層を実装した。`quantity-annotation/1.0-rc1`のSchema検証後、元traceの`_trace_records`だけから`dataset_signature`を再計算し、PDF型（`source_raw_text`）／Excel型（`source_record`＋`source_record_display`＋`source_row`）それぞれの契約で`content_hash`を再計算する。同一側の元trace／sidecarの`trace_id`重複、sidecar／元traceの相互欠落も診断として保持する。不整合は`schema_invalid`／`source_mismatch`／`stale_annotation`／`missing_annotation`／`missing_trace`／`duplicate_trace_id`／`duplicate_annotation_id`／`content_hash_unverifiable`として明示し、候補・数値比較・充足判定は生成しない。Excel側の`source_record_display_unresolved[].reason === "path_mapping_unsupported"`は`unparsed`（比較不能）として伝播し、黙って生値へフォールバックしない。
>
> 同じ実装単位で、通常照合・手動追加の照合行に`requirement_trace_id`／`actual_trace_id`（元レコードの安定ID）と`matcher_a_id`／`matcher_b_id`（現行表示ID）を別々に保持した。`quantity_sidecar_binding_verification.js`（Node）と`quantity_sidecar_binding_browser_verification.js`（実UI）で、署名・ハッシュ・欠落・重複・未解析の停止、候補／充足判定0件、`B_ID != trace_id`および手動追加経路での4 ID保持を回帰確認する。数量ペア絞り込み以降（3.4節）はこの実装単位に含めていない。

> **訂正（`cf17003`レビュー、2026-07-20）**：上記の初回Phase B-1実装は、(a)`ruleset_version`をSchema上の型としてしか検証せず、旧抽出・意味規則でも`ready:true`にしていた、(b)ブラウザ検証器を正本Schemaとは別の手書き近似実装としていたため、`source_span`等のネストした`additionalProperties:false`を完全には再現できていなかった、(c)`missing_annotation`をエラー扱いし、設計済みのレコード単位`not_analyzed(reason:no_annotation)`契約と食い違っていた、という3点が誤りだった。修正後は`SUPPORTED_RULESETS`の完全タプル照合をSchema検証直後に行い、不一致を`ruleset_mismatch`としてファイル全体停止する。正本`quantity_annotation_schema_v1.json`から`generated/quantity_annotation_schema_v1.browser.js`を機械生成し、Node・ブラウザが同じSchema駆動検証器を使う。生成物のdeep-equal／再生成差分と、全ネストobjectに対する余分プロパティ・必須欠落・型違反の差分テストを恒久化した。`missing_annotation`だけは`severity:warning`とし、該当レコードだけを`not_analyzed(reason_code:"no_annotation")`へ送り、正常レコードの結合を継続する。
>
> Phase A実生成物との独立性不足も訂正した。Phase B自身のハッシュ関数でsidecarを再合成するテストだけに依存せず、既存runtime fixtureのPDF 5件・Excel work-JSON 4件・Excel実`.xlsx` 3件をそのまま入力し、再計算・結合・診断0件を恒久回帰として確認する。実ブラウザテストのA/B入力もPDF／Excel work-JSONの実生成fixtureへ置き換えた。

> **訂正（`7bc4182`レビュー、2026-07-20）**：`bindSide()`が生成する`not_analyzed(reason_code:"no_annotation")`のレコードに`side`（`"requirement"`／`"actual"`）を持たせていなかった。`bindInputPair()`は`requirement.not_analyzed`と`actual.not_analyzed`を単純に配列結合するため、要求側・実仕様側の双方に同じ`trace_id`を持つレコードが存在し、かつ両側とも該当sidecarレコードが欠落しているケースでは、集約後の`not_analyzed`配列から「どちらの側の欠落か」を`trace_id`だけでは判別できなかった（`side`が無いため、`trace_id`だけをキーにすると要求側と実仕様側の欠落が衝突・混同されうる）。修正: `bindSide()`内の`notAnalyzed.push(...)`へ`side:expectedSide`を追加した。`bindInputPair()`側の集約処理自体（配列のスプレッド結合）は変更していない。各要素が`side`を保持するようになったことで、集約後も`side + trace_id`の組がそのまま安定した識別キーとして機能する。**結合層の`not_analyzed`は`side + trace_id`の組で識別し、配列内の格納順序・結合順序には依存しない契約とする**。回帰テストとして、要求側・実仕様側の双方が同じ`trace_id`（`"same"`）を持つケースについて、(a) 双方のsidecarレコードが欠落しても`requirement:same`と`actual:same`を`side`で識別できること、(b) 結果配列を逆順にしても`side + trace_id`をキーに同じ結果を再現できること（`Map`化して両エントリを引けることを確認）、(c) `actual`側だけ欠落した場合に`side:"actual"`として一意に特定でき、かつ`requirement`側の`not_analyzed`が0件のままであることを`quantity_sidecar_binding_verification.js`へ追加した。`side`付与を一時的に取り除くと、これら3件に加え既存の単側検証2件（`bindSide()`単体・`bindInputPair()`集約後のそれぞれで`side`を確認する強化済みの既存項目）の計5件が実際に失敗することを確認した上で復元している。

### 3.4 全組み合わせ生成の絞り込み（必須修正6・再指摘への対応）

要求側`analyses[]`×実仕様側`analyses[]`の全直積をそのまま候補にするのではなく、次の順で段階的に絞り込む。

**再指摘への対応**：以前の版は「除外件数と理由コードを`not_analyzed`集計として保持する」という設計だったが、これは件数だけの集約で「どの数量がなぜ落ちたか」を追跡できなかった。現在は、段階1では同一次元・異次元とも数量ID集合を持つバケット表現を使い、段階2以降で個々の意味候補を逐次評価する。数量ペアの全直積は中間配列として生成しない。

**候補生成の段階化**（全直積を作らず、次元インデックス等から段階的に絞り込む）：

1. **canonical dimension一致**：`quantity.unit.dimension`が一致する組み合わせだけを候補にする（次元ごとにインデックスを作り、`power`同士・`temperature`同士のように次元が一致する数量だけを突き合わせる。これにより`N×M`の全組み合わせを毎回試す必要がなくなる）。
2. **設計特性候補の一致**：段階1を通過したペアについて、`generatePropertyCandidates()`の出力上位候補の`concept_id`が一致するものを優先する（7節の`margin`ベースの縮約と合わせて使う。候補集合の「重なり」だけで機械的に足切りするのではなく、次点候補の扱いも含めて8節参照）。
3. **条件候補の整合**：`condition_candidates`が双方にある場合、次元・値が大きく矛盾するペア（例：要求側は「50 °Cで」、実仕様側は「10 °Cで」）を除外する。
4. **意味ペアからcomparison mode導出可能**：`deriveComparisonModeCandidate()`が`null`を返すペア（`COMPARISON_MODE_DERIVATION_TABLE`に未登録の組み合わせ）を除外する。これは新しい絞り込みではなく、既存の安全設計（`baseline_v1_handoff.md` §4不変条件2・3）をそのまま候補削減にも使うということ。
5. 1〜4を通過してなお複数ペアが残る場合（一対多）は、どちらも正しく複数対応し得るケース（例：1つの実仕様値が複数の要求条件を満たす）と、競合する複数候補（同じ実仕様値が複数の無関係な要求と紐づいてしまう）を区別する規則が必要（未確定）。
6. 最大候補数（例：1レコードあたり`N`件まで）を超えた場合の打ち切りと、打ち切ったこと自体を診断情報に残す規則が必要（未確定）。

**`not_analyzed`のデータ形（段階によって粒度が異なる。訂正後の統一契約）**：

> **訂正（Phase B-2実装、`00acf39`レビュー、2026-07-20、初回実装の問題と訂正経緯）**：上記「再指摘への対応」で決めた「除外された数量IDペアと理由コードの個別リスト」という設計（直下の当初のコード例）は、段階1（canonical dimension一致）へそのまま適用すると、**次元が一致しない数量同士の全組み合わせをそのまま個別リストへ展開してしまい**、要求側20件×実仕様側20件が異次元同士だった場合に400件の`not_analyzed`エントリを生成する、という組み合わせ爆発を起こす欠陥だった（レビューで指摘され、実際に20×20の合成データで400件生成されることを確認した）。「監査記録として個々のペアを追跡できるようにする」という元々の意図（3.4節冒頭の再指摘）自体は正しいが、**次元不一致という「大きな塊で起こる除外」にまで個別ペア粒度を適用すべきではなかった**——次元が違う数量同士は、そもそも人間が1件ずつ確認する対象ではなく、「この次元とこの次元は交わらなかった」という集合レベルの事実だけで十分な監査証跡になる。
>
> 修正: **段階ごとに除外の粒度を使い分ける契約へ統一する**。
> - **段階1（canonical dimension一致、実装済み）**：異次元の組み合わせは、次元バケット単位（`(要求側trace_id, 実仕様側trace_id, 要求側dimension, 実仕様側dimension)`の組ごと）で1件に圧縮した監査記録にする。個々の数量IDは`requirement_quantity_ids`/`actual_quantity_ids`という配列としてバケット内に保持し、除外されたペアの実数は`excluded_pair_count`（バケット内の数量ID数の積）として別途記録する。件数だけの集約（訂正前の「再指摘への対応」が明示的に否定した設計）ではなく、どの数量ID同士が除外されたかは配列として個別に追跡できるため、「監査記録として個々のペアを追跡できるように」という元の要求は満たしたまま、組み合わせ爆発だけを避けている。
> - **段階2以降（設計特性候補の一致・条件候補の整合・comparisonMode導出、未実装）**：これらは次元のような「粗い塊」ではなく、個々のペアの意味的な適合度で決まる除外のため、直下の当初の設計どおり**除外された数量IDペア1件＝1エントリ**の個別リストのままにする（実装時に、段階1を通過した候補一覧に対してのみ適用されるため、母数は段階1で既に大幅に絞り込まれており、組み合わせ爆発は起こらない）。
> - `quantity_sidecar_binding_core.js`の`generateDimensionCandidates()`として実装し、`quantity_dimension_candidate_verification.js`・`quantity_sidecar_binding_browser_verification.js`で回帰確認した。`77f440f`レビュー修正後はNode 54件、実UI 21件で、20×20異次元の圧縮、200×200同一次元の未展開、区切り文字入りID、次元欠落の一意化、手動追加・削除・付替え後の表示更新まで検証する。
> - 併せて、`bindSide()`/`bindInputPair()`側の追加防御も実装した：同一の要求trace_id+実仕様trace_idを持つ照合行が複数存在する場合は`duplicate_relation_pair`警告としていずれからも候補を生成しない（3.2節「同じA-Bペアが複数行に現れる」の既存方針をPhase B-2の候補生成にも適用）。sidecar内で`quantity_id`が重複した場合は`duplicate_quantity_id`エラーとして候補生成全体を停止する（側ごとに独立して検査し、要求側sidecarと実仕様側sidecarという別ファイル同士がたまたま同じ値を持つことまでは誤検出しない）。生成後の`quantity_pair_id`重複も防御的に検査し、該当候補をすべて除外する（他の2つの一意性検査が正しく機能していれば構造的に到達しないはずの分岐だが、念のため残している）。`dimension`が空文字・空白・未設定の数量は`dimension_unavailable`として個別に`not_analyzed`へ送り、他の解決可能な数量の候補生成は継続する。

> **訂正（`77f440f`レビュー、2026-07-20）**：異次元側を圧縮した後も、同一次元側は二重ループで数量ペアを全件`candidates[]`へ展開しており、200×200で40,000オブジェクトを生成していた。修正後は同一次元も`candidate_buckets[]`へ圧縮し、`requirement_quantity_ids[]`／`actual_quantity_ids[]`／`dimension`／`candidate_pair_count`と4参照IDだけを保持する。`candidate_count`は潜在ペア数の数値であり、`candidates[]`は空、`candidates_materialized:false`とする。段階2以降はこのバケットを逐次走査して絞り込み、全直積配列を作らない。併せて、照合行の複合キーを区切り文字連結から`JSON.stringify([requirement_trace_id, actual_trace_id])`へ変更し、`|`を含むID同士の衝突を解消した。`dimension_unavailable`はsidecar／trace単位で一度だけ索引化し、`side + trace_id + quantity_id + reason_code`で一意化する。手動関係の追加・削除・付替えは共通の表示無効化経路から数量ステータスも再描画し、診断APIだけ更新され表示が陳腐化する状態を防ぐ。

> **訂正（B-2.2b設計、`4c9e81e`承認後、2026-07-21）**：上記240行目「段階2以降は…除外された数量IDペア1件＝1エントリの個別リストのままにする（母数は段階1で既に大幅に絞り込まれており、組み合わせ爆発は起こらない）」という前提は誤りだった。`quantity_dimension_candidate_verification.js`が既に確認しているとおり、**単一の`candidate_buckets[]`要素の中だけでも**200×200＝40,000ペアのような大きな`candidate_pair_count`が起こり得る（段階1は次元が一致するかどうかでバケット間を分けるだけで、1つのバケット内部の数量ID数そのものは制限していない）。したがって段階2（設計特性候補＝conceptの一致）をこのバケット内で個々のペア粒度のまま評価すると、段階1で一度解決したはずの組み合わせ爆発が1バケット単位で再発する。
>
> 修正した設計（B-2.2b、`generateComparisonCandidates()`として実装）：
> 0. **API設計（B-2.2a round1で見つかった「別途渡された検証済み結果を信頼する」経路の再発防止）**：`generateComparisonCandidates()`は`{ binding, relations, candidateLimit }`のみを受け取り、`generateDimensionCandidates({binding, relations})`・`generatePropertyResolutions({binding})`は関数内部でそれぞれ1回だけ呼び出す。呼び出し側が別途計算した`dimensionResult`/`propertyResult`を引数として渡せる形にはしない——B-2.2a round1で、bindingとは別にtrace引数を渡せてしまい検証済みデータと食い違いうる経路が見つかった（本節236行目以降参照）のと同じ欠陥クラスを、この段階で新たに作り込まないための設計判断。`generatePropertyCandidates()`（数量1件ごとのconceptスコアリング）自体は`generatePropertyResolutions()`内で既に「bound数量1件につき1回だけ」評価される設計になっているため、`generateComparisonCandidates()`が`generatePropertyResolutions({binding})`を関数内部で1回呼ぶだけでも、レビューが求めた「事前生成した結果をside+quantity_idで参照するだけで再計算しない」という性能上の意図はそのまま満たされる（違いは「誰が呼ぶか」だけで、計算回数は変わらない）。
> 1. バケット内の要求側`quantity_id`・実仕様側`quantity_id`それぞれを、B-2.2a（`generatePropertyResolutions()`）が既に計算済みの`status`／`concept_id`によって**`concept_id`ごとにグルーピング**する（`status:"resolved"`のものだけ）。`status`が`"resolved"`でない（`"ambiguous"`／`"unavailable"`）数量IDは、この時点でどのconceptとも比較しようがないため、`side`＋`status`単位で1件に圧縮した`not_analyzed`（`reason_code:"property_unresolved"`）へ送る。`side + quantity_id`をキーにした`Map`で参照するだけで、`generatePropertyCandidates()`はこの段階で再計算しない。
> 2. 要求側・実仕様側の両方に同じ`concept_id`の`resolved`グループが存在する場合だけ、そのconcept内の`requirement_quantity_ids × actual_quantity_ids`をcomparison候補として実際に生成する（**この直積は「概念が一致した後に残る、実際に比較すべき小さな集合」であり、段階1が防ごうとした「無条件の全直積」とは異なる**。同じ行・同じconceptの数量は通常1〜数件程度に収まる想定だが、想定外の入力でも安全側に倒すため、下記4の上限を必ず適用する）。
> 3. 要求側にしか（または実仕様側にしか）存在しないconceptの`resolved`グループは、`side`＋`concept_id`単位で1件に圧縮した`not_analyzed`（`reason_code:"concept_mismatch"`）へ送る。個々の数量IDは`quantity_ids`配列として保持するため、監査時にどの数量が対応相手を持たなかったかは追跡できる。
> 4. **候補上限（3.4節6番の未確定事項への回答）**：1つの`(bucket, concept_id)`の組から生成される候補数が`candidateLimit`（既定値50、`generateComparisonCandidates()`の引数で上書き可）を超える場合、confidence降順（同点は`quantity_id`昇順）で決定的に上限件数まで切り詰め、超過分は`candidate_limit_exceeded`（`severity:"warning"`）として`excluded_pair_count`付きで1件に圧縮した`not_analyzed`へ送る（個別ペアへは展開しない）。これにより、想定外に同一行・同一conceptへ大量の数量が集中した場合でも、実際に生成されるcomparison候補・除外記録のいずれもO(バケット数×concept数)に収まり、O(バケット内数量数の2乗)には戻らない。
> 5. 数値比較・`comparisonMode`導出・充足判定はまだ行わない（3.4節3・4番、B-2.2bのスコープ外のまま）。`comparison_candidates[]`の各要素は`requirement_quantity_id`/`actual_quantity_id`/`concept_id`/`dimension`/4参照ID（`requirement_trace_id`/`actual_trace_id`/`matcher_a_id`/`matcher_b_id`）のみを持つ、次段階（条件候補の整合・comparisonMode導出）への入力としての識別情報にとどめる。
>
> 回帰テストは`quantity_comparison_candidate_verification.js`として新設した。単一concept一致・concept不一致（双方向）・`property_unresolved`除外・実fixtureでのend-to-end確認に加え、**1バケット内で同一conceptに大量の数量IDが集中するケース**（要求側10件・実仕様側10件の合成データ）で、(a) 生成される`comparison_candidates`が`candidateLimit`を超えないこと、(b) 超過分が個別ペアへ展開されず`candidate_limit_exceeded`1件（`excluded_pair_count`付き）に圧縮されること、を直接確認する。
>
> **訂正（`da4f3ee`レビュー、2026-07-21、初回実装の問題と訂正経緯）**：上記の設計方針自体は正しいと承認されたが、実装が方針どおりになっていない箇所が重大2件・中1件見つかった。
> 1. **【重大】candidateLimit適用前に全直積を中間生成していた**：`emitConceptGroupCandidates()`の初回実装は、`reqIds×actIds`の全ペアを配列へ`push()`してから`slice(0, candidateLimit)`していた。200×200なら40,000件、5,000×5,000なら2,500万件を先に生成してから大半を捨てており、「全直積を中間配列として生成しない」という3.4節の契約に反していた。修正: 配列を作らず、confidence降順にソート済みのID列を二重ループで走査しながら、`candidateLimit`到達時点で即座にループを打ち切る形にした。2,000×2,000（潜在ペア400万件）でも数十ms程度で完了することを`quantity_comparison_candidate_verification.js`のタイミング計測付きテストで確認した（全直積を再度生成する実装に戻すと同じ入力で2秒超になることも、バグ注入検証で確認済み）。
> 2. **【重大】per-group上限(candidateLimit)が「1つの(bucket, concept_id)組あたり」の上限にすぎず、全体の合計には上限がなかった**：バケット・concept数が多いケースでは合計候補数がいくらでも積み上がりうる、と指摘された。3.4節6番の原文「最大候補数（例：1レコードあたりN件まで）」はレコード＝バケット単位の上限を指しており、per-group自体は意図した設計のまま維持するが、**全体の合計にも別途`totalCandidateLimit`（既定値500）を新設し、超過時はどのバケット由来の候補を残すかという恣意的な判断を避けるため、`comparison_candidates`全体をfail closed（空配列・`ready:false`・`total_candidate_limit_exceeded`をerror診断）にする**設計へ変更した。個々のバケットの`candidate_limit_exceeded`監査記録（warning）はdiagnostics/not_analyzedへそのまま残るため、なぜ合計が超過したかの内訳は追跡できる。あわせて、切り詰め時にquantity_id（内容ハッシュ）の辞書順という意味のない基準で候補を捨てていた点も、confidence降順（同点はquantity_id昇順）へ変更した。ただし現行実装では、1つのbound record内の全analysisが`nearbyText`/`tags`を共有するため、同一バケット・同一side・同一conceptの候補間でconfidenceが実際に異なることは構造的に起こらず（`nearbyTextForRecord()`がレコード単位で数量所在列全体を一律除外する設計のため）、この並び替え自体は現時点では防御的な実装にとどまる（将来`nearbyText`計算がanalysis単位に細分化された場合に備える）。
> 3. **【重大】binding.ready===false時にPhase B-1の元診断が再び消えていた**：`blockedComparisonResult()`が`dimensionResult`/`propertyResult`だけを引き継ぎ、`binding`自体を受け取っていなかったため、`binding.ready===false`の早期returnでは`path_mapping_unsupported`・`source_mismatch`・`stale_annotation`・`ruleset_mismatch`等、Phase B-1がside・trace_id付きで検出済みの診断が消えていた（B-2.2aで一度修正した欠陥の再発、と指摘された）。修正: `blockedComparisonResult()`が`binding`も受け取り、すべての早期returnで`binding.diagnostics`/`binding.not_analyzed`を必ず引き継ぐようにした。実際の`bindInputPair()`で`path_mapping_unsupported`を発生させ、side・trace_id付きで残ることを確認する回帰テストを追加した。
> 4. **【中】candidateLimit/totalCandidateLimitの入力検証がなかった**：負数・非整数・`NaN`・`Infinity`・文字列・極端に大きい値をそのまま`slice()`・減算へ使うと誤動作しうる（呼び出し側が`Infinity`を渡すだけで上限機構を無効化できる、と指摘された）。修正: 両方とも1以上10,000以下の安全な整数であることを検証し、不正なら`candidate_limit_invalid`/`total_candidate_limit_invalid`でfail closedする。
>
> 回帰テストは62件から60件へ整理しつつ拡張した（テスト件数の詳細な内訳は`quantity_comparison_candidate_verification.js`のコメントを参照）。追加した主なケース：実際の`bindInputPair()`による`path_mapping_unsupported`の`binding.ready===false`経由の伝播、`candidateLimit`/`totalCandidateLimit`の不正値9パターンのfail closed、単一グループ・複数バケットいずれの経路でも合計超過時にfail closedすること、2,000×2,000でのタイミング計測による全直積非生成の直接証拠。4件の防御（全直積除去・全体上限・binding診断伝播・入力検証）をそれぞれ個別に無効化すると、対応するテストだけが失敗することを確認した上で復元した。
>
> **訂正（`7b4fc7b`レビュー、2026-07-21、上記round1修正になお重大3件・中1件）**：round1で導入した全体上限(`totalCandidateLimit`)自体に、なお実装上の穴が残っていた。
> 1. **【重大】全体上限を「候補を全部生成した後」に判定していた**：round1修正は全直積の中間配列こそ廃止したが、`totalCandidateLimit`の判定は依然として全バケット・全conceptの候補生成が完了した後に行っていた。`candidateLimit=10,000`・`totalCandidateLimit=1`・1,000個のconceptグループのような入力では、最大1,000万件の候補オブジェクトを生成してから最後に全破棄することになり、全体上限が「生成を防ぐ」のではなく「生成後に結果を破棄する」だけの仕組みになっていた、と指摘された。
> 2. **【重大】全体上限の判定材料が「切り詰め後の実現候補数」であり、真の潜在規模を反映していなかった**：例えば100グループ×潜在100件を`candidateLimit=1`で切り詰めると、実現後の合計は100件にすぎないが、真の潜在合計は10,000件になる。`totalCandidateLimit=500`のような設定では、100件という実現後の合計だけを見ていると超過を検知できず、9,900件の潜在的な組み合わせが監査対象から漏れたまま`ready:true`の通常結果として返っていた、と指摘された。
>   - 修正（1・2をまとめて）：候補生成を**Pass 1(潜在ペア数の集計のみ、候補オブジェクトは一切生成しない)**と**Pass 2(実際の候補生成)**の2段階に分離した。Pass 1は各`(bucket, concept_id)`組の`potentialPairCount`(`reqIds.length×actIds.length`の乗算のみ)を全グループにわたって合計し、この**切り詰め前の潜在合計**が`totalCandidateLimit`を超える場合は、Pass 2(候補生成)を一切実行せずfail closedする(`comparison_candidates:[]`・`ready:false`・`total_candidate_limit_exceeded`をerror診断、`not_analyzed`に`total_potential_pair_count`(潜在合計、旧`total_candidate_count`から改称)を記録)。潜在合計が上限以内であることを確認できた場合だけPass 2へ進み、そこで初めてper-group上限(`candidateLimit`)による切り詰めを行う。「多数の小さなグループの合計が実際の潜在規模を過小評価する」というレビューの反例と同じ構造(20バケット×潜在20件=合計400、`candidateLimit=1`で実現後の合計は20だが潜在合計400で判定してfail closedする)を`quantity_comparison_candidate_verification.js`へ追加した。あわせて、`totalCandidateLimit`は「文書全体の潜在合計」を表すようになったため、1レコードあたりの上限(`candidateLimit`、`MAX_SAFE_CANDIDATE_LIMIT=10,000`)とは別に、専用の上限(`MAX_SAFE_TOTAL_CANDIDATE_LIMIT=10,000,000`)を新設した(Pass 1の集計自体はバケット数×concept数に比例するだけの軽い加算処理であり、この上限を大きくしても組み合わせ爆発には繋がらない)。既定値も500→2,000へ引き上げた。
> 3. **【重大、設計判断として一部見送り】per-group上限超過時に不完全な候補集合をready:trueのまま返すのは安全でない、後段の条件整合・comparisonMode導出がこれを完全な結果として扱ってしまう**：レビューは「per-group超過も停止対象にし、完全にfail closedする方が単純で安全」を第一候補としつつ、代替案として「部分候補を残す設計にするなら、少なくとも`result_complete:false`を追加し、後段が不完全候補集合を確定結果として扱わない契約にする」ことも認めていた。**開発者としての判断: per-group単位の完全fail closedは採用せず、`result_complete`フィールドを追加する代替案を採った**。理由: 3.4節6番の原文が元々想定していたのは「打ち切りと、打ち切ったこと自体を診断情報に残す」という設計であり(全体停止ではない)、1件の異常なレコード(例: 1つのPDF段落に同じconceptの数量が60件集中する等)のために比較実行全体を止めてしまうと、同じ実行に含まれる他の無関係な正常レコードの結果まで失われ、実文書での実用性を著しく損なう。修正: `comparison_candidates`・`not_analyzed`・`diagnostics`(`candidate_limit_exceeded`、`severity:"warning"`のまま)は現状維持し、いずれかのグループでper-group切り詰めが発生した場合は`result_complete:false`を返すようにした(`blockedComparisonResult()`経由の早期return、および全体上限超過によるfail closedの場合も一律`result_complete:false`とする)。**段階3以降(条件候補の整合・comparisonMode導出・数値比較)を実装する際は、`result_complete===false`の結果を確定結果として扱わない契約とする**。
> 4. **【中】2,000×2,000のタイミングテストが固定1秒判定でCI環境差の影響を受けやすい**：CIホストの混雑・CPU性能・Node.jsバージョン・GC・並行ジョブの影響で、正しい実装が遅いホストで失敗する一方、誤った実装が高速ホストで1秒以内に収まる可能性もある、と指摘された。修正: Pass 1のみで完了する経路(潜在合計が`totalCandidateLimit`を超えてfail closedする経路)を主たる性能アサーションとし、閾値を500msへ緩和した(この経路はバケット数×concept数に比例する軽い集計処理のみで完了する構造のため、多少の環境差があっても十分な余裕がある)。実際にPass 2まで進む経路の計測は、合否判定に使わずログ出力のみ(非ブロッキング)にした。
>
> 回帰テストは60件から66件へ拡張した。追加した主なケース：全体上限判定の対象を潜在合計に変更したことの直接確認(単一グループ・複数バケットいずれも潜在合計で判定)、レビューが提示した反例(多数の小さなグループの合計)と同じ構造の再現テスト、`result_complete`フィールドの真偽値確認(切り詰めなし→true、per-group切り詰めあり→false)、Pass 1経由の高速なfail closedと、非ブロッキングなPass 2性能ログの分離。2件の防御(潜在合計ベースの全体上限判定・`result_complete`追跡)をそれぞれ個別に無効化すると、対応するテストだけが失敗することを確認した上で復元した。
>
> **訂正（`95af0db`レビュー、2026-07-21、round2修正になお重大3件・中1件）**：round2で導入した「潜在合計で判定するPass 1」自体に、なお実装上の穴が残っていた。
> 1. **【重大】潜在ペア数(探索空間の大きさ)と実体化候補数(実際にメモリへ載る量)を混同していた**：round2は`totalCandidateLimit`の検証上限をMAX_SAFE_TOTAL_CANDIDATE_LIMIT=10,000,000まで引き上げていたため、たとえば`candidateLimit=10,000`・1,000個のconceptグループ・`totalCandidateLimit=10,000,000`のような設定では、Pass 1の潜在合計チェックは通過するものの、Pass 2で実際に最大1,000万件のcomparison candidateオブジェクトを正規に実体化できてしまう、と指摘された。「探索空間の大きさ」と「実際にメモリへ載せる候補オブジェクト数」は別の量であり、別々の上限で守る必要がある。修正: 上限を2つに分離した。`totalCandidateLimit`(実体化見込み件数、`Σ min(potentialPairCount_i, candidateLimit)`の上限。検証上限もcandidateLimitと同程度の桁(`MAX_SAFE_TOTAL_CANDIDATE_LIMIT=100,000`)へ戻した)と、新設の`totalPotentialPairLimit`(切り詰め前の潜在ペア数合計の上限。Pass 1の集計自体は軽い加算処理のため、大きめの検証上限(`MAX_SAFE_TOTAL_POTENTIAL_PAIR_LIMIT=1,000,000,000`)を許容する)。レビューが指摘した具体的な攻撃形(`totalCandidateLimit:10,000,000`)は、検証上限自体を引き下げたことで、そもそも設定できなくなった(入力検証の時点でfail closedする)ことを回帰テストで確認した。
> 2. **【重大】上限超過を検出した後もバケット走査を最後まで続けていた**：Pass 1は全`candidate_buckets`を走査してから`totalPotentialPairCount`を判定しており、走査の途中で超過が確定していても、残りのバケットについて数量ID再走査・conceptグルーピング・記述子(`groupDescriptors`)への蓄積・`not_analyzed`生成を続けていた。全直積オブジェクトは作らなくなったが、上限超過後も無駄な走査・記述子蓄積が残っていた、と指摘された。修正: バケットの走査ループ自体を`potentialPairCount`/`materializedUpperBound`を1グループ加算するたびに判定し、いずれかの上限を超えた時点でlabeled breakによりバケット走査そのものを即座に打ち切るようにした。タイミング計測に頼らず、この打ち切りが実際に起きていることを**決定的に**証明するため、5バケット(「トリガー」2件+「マーカー」3件)の合成データで、意図的に早い段階で上限超過するよう設定し、後続の「マーカー」バケット固有の`property_unresolved`監査記録が`not_analyzed`に一切現れないことを確認する回帰テストを追加した(バグ注入で`break`を取り除くと、この決定的な証拠テストだけが正しく失敗することも確認した)。
> 3. **【中1】全体停止(fail closed)時のper-group監査記録が実態と一致していなかった**：全体上限超過でcomparison candidateを1件も生成していないにもかかわらず、走査済みの各グループについて`candidate_limit_exceeded`(「超過分を切り詰めました」、`excluded_pair_count`付き)という、あたかも部分的に候補を残したかのような監査記録を出力していた。実際の生成数は0件であり、この表現は事実と一致しない、と指摘された。修正: 全体停止経路専用の`reason_code:"candidate_limit_would_exceed"`(「実体化していれば超過していたはず」という仮定の監査記録、`materialized_pair_count:0`を明示)に変更し、実際に切り詰めが起きた場合専用の`candidate_limit_exceeded`とは区別した。あわせて、全体停止経路では個々のグループについて`diagnostics`配列へのwarning追加もやめた(全体の`total_candidate_limit_exceeded`というerror診断1件で十分であり、実体化していないのに個別warningを積み増すと事実と食い違うため)。
> 4. 【round2で指摘された中の点(2,000×2,000タイミングテストのCI耐性)は、上限を2種類に分離したことで見直しが必要になった】：単一の巨大グループ(2,000×2,000)は実体化見込み(`candidateLimit`で決まる、既定50)がすぐ`totalCandidateLimit`を満たしてしまうため、`totalPotentialPairLimit`側を明示的に絞ることでPass 1経由のfail closedを検証するようテストを更新した(数値そのものは変わらないが、どちらの上限を検証しているかを明確にした)。
>
> 回帰テストは66件から78件へ拡張した。追加した主なケース：`totalPotentialPairLimit`の不正値のfail closed、多数の大きなグループ(実体化見込みの累計超過)・多数の小さなグループ(潜在ペア数の累計超過、round2の反例を`totalPotentialPairLimit`側で再現)それぞれ専用のテスト、レビューが指摘した攻撃形の設定値(`totalCandidateLimit:10,000,000`)がそもそも設定できないことの確認、5バケットの合成データによる早期打ち切りの決定的な証明(タイミング非依存)。3件の防御(実体化上限チェック・早期break・fail closed時の正確な監査記録)をそれぞれ個別に無効化すると、対応するテストだけが失敗することを確認した上で復元した。
>
> **訂正（`0957659`レビュー、2026-07-21、round3修正になお重大2件・中3件）**：round3で対応した「潜在ペア数上限と実体化上限の分離」「早期打ち切り」自体は正しかったが、それとは別のメモリ経路と、監査結果の入力順依存が残っていた。
> 1. **【重大】候補オブジェクト数の上限だけではPass 2のメモリを保護できていなかった**：Pass 2の`emitConceptGroupCandidates()`は、実際に生成する候補数を`candidateLimit`件に打ち切る前に、`reqIds`/`actIds`をconfidence降順へ複製・全件ソート(`sortByConfidenceDesc()`)していた。要求側500,000件・実仕様側1件・`candidateLimit=50`のような入力では、生成する候補は50件だけでも、その前に50万要素の配列を複製し全件ソートしてしまう——`totalCandidateLimit`(実体化見込み件数の上限)はこの複製・ソート自体のコストを一切制限できていなかった、と指摘された。修正: このソート自体を撤廃した。理由は2つ: (a) 1つのbound record内の全analysisがnearbyText/tagsを共有するため、同一グループ内のconfidenceは構造上常に同値であり、confidence降順ソートは実質的に無意味だった、(b) stage 1(`dimensionSideIndex()`)が既にanalysesをquantity_id昇順でソート済みであり、`bucket.requirement_quantity_ids`/`actual_quantity_ids`はその順序を保ったまま届く——つまり`reqIds`/`actIds`は呼び出し時点で既にソート済みであり、独自に再ソートする必要が最初からなかった。修正後は`reqIds`/`actIds`をそのまま二重ループで走査し`candidateLimit`到達時点で打ち切るだけになり、この関数の計算量は`reqIds`/`actIds`の実際の長さに一切依存せずO(candidateLimit)になる。
> 2. **【重大】早期打ち切り結果がrelations引数の入力順に依存していた**：round3で追加したlabeled breakは`dimensionResult.candidate_buckets`(=relations引数の配列順をそのまま引き継ぐ)を順に走査しており、同じrelations集合でも配列順を変えるだけで、どのグループまで走査したか・打ち切り時点の観測値・打ち切りに巻き込まれたグループが変わってしまっていた。トレーサビリティ用の監査結果が入力の配列順という偶発的な要因で変化するのは不適切、と指摘された。修正: Pass 1へ入る前に、バケットを`requirement_trace_id`→`actual_trace_id`→`dimension`の安定キーで並べ替えるようにした。同じrelations集合であればrelations引数の順序に関わらず常に同じ結果になることを、正順・逆順それぞれで`generateComparisonCandidates()`を呼び出し比較する回帰テストで確認した。
> 3. **【中1】materialized・potential両方の上限を同じグループの加算で同時に超えても、片方(materialized優先)しか記録していなかった**：修正: 両方を独立して評価し、同時に超過した場合は`limit_kinds`(旧`limit_kind`から複数形へ改称)へ両方を記録するようにした。
> 4. **【中2】500msのタイミング判定がまだブロッキングだった**：round2で1秒→500msへ緩和したが、依然として固定閾値によるブロッキング判定自体が問題である、と繰り返し指摘された(この計測範囲には`generateDimensionCandidates()`/`generatePropertyResolutions()`による数千件のanalysis処理も含まれ、CIホストの混雑・GCの影響を受けうる)。修正: このタイミング計測を完全に非ブロッキングのログ出力のみへ変更した。早期打ち切り自体の構造的な証拠は、round3で追加した5バケットの決定的なテスト(タイミング非依存)で既に確立している。
> 5. **【中3】実体化上限の検証上限(100,000)がブラウザでの安全性未検証のまま設定されていた**：Playwright等でのブラウザ実測(ヒープ・テーブル描画等)ができていない現状で100,000は根拠なく大きすぎる、と指摘された。修正: `MAX_SAFE_TOTAL_CANDIDATE_LIMIT`を100,000→10,000へさらに引き下げた(既定値2,000は変更なし)。
>
> 回帰テストは78件から86件へ拡張した。追加した主なケース：片側20,000件(candidateLimitの400倍)でも正しくcandidateLimit件ちょうどに切り詰められること(全件複製・ソートの撤廃を正確性の面から直接確認、性能面は非ブロッキングのログ参考値にとどめる)、materialized・potential両方の同時超過で`limit_kinds`に両方が記録されること、relations配列の正順・逆順で結果(観測値・打ち切りに巻き込まれたグループ)が同一になること、新しい検証上限(10,000)の境界値確認。2件の防御(バケット安定ソート・limit_kinds複数記録)をそれぞれ個別に無効化すると、対応するテストだけが失敗することを確認した上で復元した(全件ソート撤廃自体は正確性に影響しない性能改善のため、意図的にバグを再注入しても既存のcheck()では検出されない設計であることも確認した——このため合否判定はブロッキングの正確性テストで行い、性能上の効果はログでのみ示す)。

段階1で同一次元を保持する候補バケット形：

```json
{
  "candidate_buckets": [{
    "requirement_quantity_ids": ["q-r1", "q-r2"],
    "actual_quantity_ids": ["q-a1", "q-a2"],
    "candidate_pair_count": 4,
    "dimension": "power",
    "requirement_trace_id": "req-1",
    "actual_trace_id": "actual-1",
    "matcher_a_id": "A-1",
    "matcher_b_id": "B-1"
  }],
  "candidate_count": 4,
  "candidates": [],
  "candidates_materialized": false
}
```

段階1（canonical dimension一致）の圧縮バケット形：

```json
{
  "not_analyzed": [
    {
      "reason_code": "dimension_mismatch",
      "requirement_quantity_ids": ["q-be1c0825cbf56b0f...", "..."],
      "actual_quantity_ids": ["q-9f0a1b2c3d4e...", "..."],
      "requirement_dimension": "power",
      "actual_dimension": "temperature",
      "excluded_pair_count": 400,
      "requirement_trace_id": "req-cooling-capacity",
      "actual_trace_id": "actual-row-12",
      "matcher_a_id": "A-12",
      "matcher_b_id": "B-7"
    }
  ]
}
```

段階2（設計特性候補の一致、B-2.2b実装済み。上記の訂正のとおり、単一バケット内の組み合わせ爆発を避けるため個別ペア粒度ではなくconcept単位で圧縮する）：

```json
{
  "comparison_candidates": [
    {
      "requirement_quantity_id": "q-be1c0825cbf56b0f",
      "actual_quantity_id": "q-9f0a1b2c3d4e",
      "concept_id": "performance.cooling_capacity",
      "dimension": "power",
      "requirement_trace_id": "req-1", "actual_trace_id": "actual-1",
      "matcher_a_id": "A-1", "matcher_b_id": "B-1"
    }
  ],
  "not_analyzed": [
    {
      "reason_code": "concept_mismatch",
      "side": "requirement",
      "concept_id": "environment.ambient_operating_temperature",
      "quantity_ids": ["q-..."],
      "requirement_trace_id": "req-1", "actual_trace_id": "actual-1"
    },
    {
      "reason_code": "property_unresolved",
      "side": "actual",
      "status": "ambiguous",
      "quantity_ids": ["q-..."],
      "requirement_trace_id": "req-1", "actual_trace_id": "actual-1"
    },
    {
      "reason_code": "candidate_limit_exceeded",
      "concept_id": "performance.cooling_capacity",
      "excluded_pair_count": 39950,
      "requirement_trace_id": "req-1", "actual_trace_id": "actual-1"
    }
  ]
}
```

段階3以降（条件候補の整合・comparisonMode導出、未実装。実装時は、段階2を通過して既に`concept_id`単位で絞り込まれた小さな候補集合に対してのみ適用されるため、この形のまま個別ペア粒度を維持してよい）：

```json
{
  "not_analyzed": [
    {
      "requirement_quantity_id": "q-be1c0825cbf56b0f",
      "actual_quantity_id": "q-9f0a1b2c3d4e",
      "reason_code": "condition_mismatch",
      "detail": "..."
    }
  ]
}
```

> **訂正（B-2.3a設計・実装、2026-07-21）**：段階3を「条件候補の整合・comparisonMode導出」を一括りにした未実装ブロックとして記載していたが、実装は次の2段階へさらに分割した（`comparisonMode`導出・単位変換・数値比較・区間比較・充足判定は依然として未実装のまま）。
> - **段階3-1**（`generateConditionResolutions({ binding })`）：数量ごとに、Phase A抽出時点で既に計算済みの`analysis.interval_semantics_candidates`（2.3節の訂正で確立した、対象セル自身のみに限定したnearbyTextで`generateIntervalSemanticsCandidates()`が生成する候補。quantity_annotation_schema_v1.json 2.3節で必須フィールド）を、7節の`resolvePropertyStatus()`と同型の閾値判定——ただし`propertyConfidence`ではなく`modeConfidence`を使う（`AUTO_APPLICABLE_THRESHOLDS`は確信度閾値をproperty候補用とinterval_semantics候補用で別々に持ち、`margin`閾値だけを共有する設計になっているため）——で`resolved`／`ambiguous`／`unavailable`へ正規化する。候補自体の再生成は行わない（段階2aのconcept候補は`generatePropertyCandidates()`で毎回再計算するのに対し、区間意味候補は既にPhase Aで確定済みのため、比較段階が担うのは閾値判定による正規化だけである）。`interval_semantics_candidates`はスキーマ上confidence降順である契約（`scoreSemantics()`末尾の`.sort()`）だが、JSON Schema自体はこの順序を強制しないため、外部データの順序を信頼せず判定前にconfidence降順へ並べ直す。新しい閾値の発明・曖昧候補の推測一意化は行わない。
> - **段階3-2**（`generateConditionAnnotatedComparisonCandidates({ binding, relations, candidateLimit, totalCandidateLimit, totalPotentialPairLimit })`）：段階2（`generateComparisonCandidates()`）の`comparison_candidates`各要素へ、両側の条件解決結果をフラットな4フィールド（`requirement_condition_status`／`requirement_condition_value`／`actual_condition_status`／`actual_condition_value`）として付加する。comparisonResult／conditionResultは呼び出し側から別引数として受け取らず、必ず同じbindingから内部で1回ずつ計算する（B-2.2a round1以来「検証済み結果を呼び出し側から別途受け取らない」という設計方針をそのまま踏襲し、bindingとは食い違う結果を渡せてしまう迂回経路を最初から塞ぐ）。
>
> B-2.2b承認時に明示された必須要件——「Stage 3以降の関数は`ready === true`かつ`result_complete === true`を要求し、これをStage 3の最初の回帰テストとして固定すべき」——をこの最初の段階3関数で実装した：`comparisonResult.ready !== true`または`comparisonResult.result_complete !== true`の場合、候補を1件も生成せず`comparison_candidates_not_ready_or_incomplete`（severity:error）としてfail closedする。`quantity_condition_candidate_verification.js`に、`candidateLimit`超過でper-group切り詰めが起き`result_complete:false`（かつ`ready:true`のまま）になる状況を意図的に再現し、この場合にfail closedすることを確認する回帰テストを追加した（この防御を一時的に無効化すると当該テストが実際に失敗することを確認した上で復元している）。
>
> 段階1の全数量を漏れなく処理する契約（`bindingAnalysesByTraceId()`）により、段階2の`comparison_candidates`が参照するquantity_idは構造上すべて段階3-1の結果に存在するはずだが、「渡されたデータを無条件に信頼しない」という原則により、対応する条件解決結果が見つからない場合は静かに既定値へフォールバックせず`condition_resolution_missing`（severity:error）としてfail closedする（`generatePropertyResolutions()`の`bound_record_missing`検査と同じ防御パターン）。
>
> comparisonResult・conditionResultはどちらも内部で`binding.diagnostics`／`binding.not_analyzed`を引き継ぐため、単純に連結すると同じ事実が二重に現れる。段階3-2は最終的な`diagnostics`／`not_analyzed`を内容一致（`canonicalJson`）で重複除去してから返す（この重複除去を無効化すると、`missing_annotation`等の警告が2件ずつ現れることを確認した上で復元している）。
>
> **訂正（`f77dfca`レビュー、2026-07-21、初回実装の問題と訂正経緯）**：上記の段階3-1初回実装には重大2件・中2件、および回帰テスト自体の不備1件が見つかった。
> 1. **【重大】interval_semantics_candidatesの`value`がJSON Schema上は任意の非空文字列(enum制約なし)であるにもかかわらず、resolveConditionStatus()がconfidence／marginだけで`resolved`を判定していた**：ruleset v2.19が実際には生成し得ない未知の文字列や、「候補が弱い場合の受け皿」でしかない`'unknown'`自体が、たまたま高いconfidenceを持つ形でsidecarへ格納されていた場合、そのままresolvedへ昇格してしまう(`COMPARISON_MODE_DERIVATION_TABLE`・`deriveComparisonModeCandidate()`は`'unknown'`を明示的に導出対象から除外する契約であり、「resolvedかつvalue:'unknown'」は下流の契約と矛盾する)、と指摘された。修正: `REQUIREMENT_SEMANTICS_RULES`・`ACTUAL_SEMANTICS_RULES`・`CONDITION_SEMANTICS_RULES`(semantic_mapping_prototype.js 83-213行目)が実際に生成しうるvalueの全体を`KNOWN_CONDITION_SEMANTICS_VALUES`としてallowlist化し(`'unknown'`を含め、この集合に無い値は最上位候補であってもresolvedにしない)、曖昧候補を推測で一意化しないのと同じ理由で、未知語を推測で「使える値」と扱わないようにした。
> 2. **【重大】interval_semantics_candidatesの配列サイズにJSON Schema上の上限(maxItems)がなく、resolveConditionStatus()より前の`sortedByConfidenceDesc()`が件数を検査せず全件複製・ソートしていた**：スキーマ上有効なsidecarへ1数量あたり極端に大きな候補配列を格納すると、B-2.2bが直積生成に対して行った組み合わせ爆発対策と同種の、未対策な計算コストが生じる、と指摘された。修正: `MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY`(64)を新設し、複製・ソートより前に件数を検査、超過時は`condition_candidate_limit_exceeded`(side・trace_id・quantity_id・observed_count・limitを保持、severity:error)として呼び出し全体をfail closedする(1件の異常な数量のために結合全体の信頼性が疑わしくなるため、B-2.2bのcandidateLimitのような部分的切り詰めではなく、`duplicate_quantity_id`と同じ「構造的な入力異常」として扱う判断)。同じ検査パスで、同一数量内でのvalue重複(正しい生成元では起こらない契約だがスキーマは禁止しない)も`condition_candidate_duplicate_value`として同様にfail closedするようにした。
> 3. **【中】段階3-2がstatus／valueの2フィールドだけを比較候補へ付加しており、後段(将来のcomparisonMode自動適用判定、semantic_mapping_prototype.js `evaluateAutoApplicable()`参照)が安全性判断に使うmargin・否定根拠の有無が失われていた**：resolutionは既にcandidates(evidence込み)を保持しているため導出は可能だが、この2フィールドへの縮約により、どちらの候補も同じ`status:"resolved"`になり得る「confidence0.6・否定根拠なし」と「confidence0.6・否定根拠あり」を区別できなくなる、と指摘された。修正: `marginOf()`と並び`hasOpposingEvidence()`(semantic_mapping_prototype.js 405-408行目)も一字一句移植し、各resolutionへ`top_confidence`・`margin`・`has_opposing_evidence`を明示フィールドとして保持、段階3-2の付加フィールドも6個(側ごとにstatus・value・top_confidence・margin・has_opposing_evidenceの5個×2側)へ拡張した。候補・evidence配列自体をペア数分複製する設計(レビューが提示した別案の1つ)ではなく、スカラー値だけを付加する軽量な方式を選んだ(`evaluateAutoApplicable()`が使う`extractionWarningsCount`は`analysis.quantity.extraction.warnings`由来でinterval_semantics候補とは無関係な関心事のため、意図的にこの関数の付加対象に含めていない)。
> 4. **【中】confidenceが同点の候補の出力順が、単純な`.sort()`の安定性により入力配列の元の順序(sidecar生成側の実装依存)にそのまま従っていた**：判定結果(status/value)自体はconfidenceの値だけで決まり同点候補の順序に依存しないが、`resolutions[].candidates`という監査用出力配列の順序が入力順に依存すると、スナップショット比較等での再現性を損なう、と指摘された。修正: `sortedByConfidenceDesc()`へvalue昇順の決定的なtie-breakを追加した。
> 5. **【回帰テスト不備】実fixtureを使った段階3-2のend-to-endテストが`realAnnotated.ready === true || realAnnotated.ready === false`という、booleanなら必ず真になる空虚な検証になっており、実質的に何も確認していなかった**、と指摘された。修正: B-2.2b自身の実fixtureテストと同じ方法(要求側×実仕様側の全trace_id組でrelationsを構築)で実在するrelationを渡し、比較候補が1件以上生成されること・両側のquantity_idが実在すること・statusが許可値であること・resolvedならvalueが非null、それ以外ならvalueがnullであることを検証するよう書き直した。
>
> 回帰テストは51件から81件へ拡張した。追加した主なケース：高confidence(0.9)の`'unknown'`単独候補・既存語彙に無い高confidence未知語がいずれもresolvedにならないこと、既存語彙9種すべてが単独十分confidenceでresolvedになること(allowlistが既存語彙自体を締め出していないことの確認)、65件の候補配列・同一数量内でのvalue重複がいずれもfail closedすること(side/trace_id/quantity_id等の診断内容込み)、同点confidence候補の出力順が入力順に関わらず決定的であること、resolution・段階3-2出力の両方でtop_confidence/margin/has_opposing_evidenceが正しい値を持つこと。5件の防御(allowlist・件数上限・value重複検査・tie-break・新規フィールドの実配線)をそれぞれ個別に無効化すると、対応するテストだけが失敗することを確認した上で復元した。
>
> **訂正（B-2.3b設計・実装、`fdb337a`承認後、2026-07-21）**：段階3を「条件候補の整合・comparisonMode導出」の2つに分けた上で、comparisonMode導出部分を段階3-3として実装した。`generateComparisonModeCandidates({ binding, relations, candidateLimit, totalCandidateLimit, totalPotentialPairLimit })`は、段階3-2(`generateConditionAnnotatedComparisonCandidates()`)をbindingから内部で1回だけ計算し(呼び出し側から別引数として受け取らない、B-2.2a round1以来の設計方針をここでも踏襲)、`conditionAnnotatedResult.ready !== true`または`result_complete !== true`の場合は候補を1件も生成せずfail closedする(`condition_annotated_candidates_not_ready_or_incomplete`、severity:error。段階3-2自身が段階2に対して課した契約と同じものを、段階3-3が段階3-2に対しても課す形で連鎖する)。
>
> 両側とも`condition_status:'resolved'`の比較候補だけを対象とし、次の3段階で絞り込む(いずれも新しい規則の発明ではなく、既存の`COMPARISON_MODE_DERIVATION_TABLE`だけを検索に使う)。
> 1. 両側とも`resolved`でなければ(`ambiguous`/`unavailable`いずれも)推測せず`condition_unresolved`として送る(両側のcondition status/valueを保持した監査記録)。
> 2. 両側`resolved`でも、どちらかに否定根拠(`has_opposing_evidence:true`)があれば自動導出へ進めない。「候補は生成するが`auto_applicable:false`を付ける」という代替案も検討したが、auto applicability自体を実装しない現段階では最も安全な「候補生成せず`condition_opposing_evidence`として保留」を選んだ。
> 3. 固定表(`COMPARISON_MODE_DERIVATION_TABLE`、semantic_mapping_prototype.js 368-374行目から一字一句移植。乖離検出は`quantity_annotation_ported_lib_check.js`が新設した`checkPortedComparisonModeTable()`が担う)に`(requirement_condition_value, actual_condition_value)`の完全一致が見つかった場合のみ`comparison_mode_candidate`(表の`mode`)を生成する。見つからなければ`comparison_mode_unavailable`として送る。`required_capability_domain × achieved_point`はv2.10で安全側の理由により意図的に対応表から除外されたままであり(単一の達成点は要求された能力領域全体をカバーした証明にならない)、復活させていない。
>
> 生成される候補は元のcomparison候補(4参照ID・`concept_id`・`dimension`・両側condition status/value等)をすべて保持したまま、`comparison_mode_candidate`(mode文字列)・`comparison_mode_confidence`(=`Math.min(requirement_condition_top_confidence, actual_condition_top_confidence)`、`deriveComparisonModeCandidate()`の保守的なmin採用方針をそのまま踏襲)・`derived_from`(両側のcondition value)の3フィールドを追加する。`confirmed`・`satisfied`・`applicable`・`auto_applicable`はまだ付けない。単位変換・数値比較・区間包含判定・auto applicability判定・充足判定は引き続き未実装のまま。
>
> 240行目で「段階2以降(設計特性候補の一致・条件候補の整合・comparisonMode導出)は個別ペア粒度のnot_analyzedのままにする」とした前提は、実装が進むにつれ各段階固有の圧縮・監査記録の形へ訂正されてきた(段階2=B-2.2bのconcept単位圧縮、段階3-1=B-2.3aの数量単位resolution)。段階3-3も同様に、既に段階2で`concept_id`単位に絞り込まれた小さな候補集合に対してのみ適用されるため、個別ペア粒度の`not_analyzed`のまま(`condition_unresolved`/`condition_opposing_evidence`/`comparison_mode_unavailable`)実装した。406行目の`condition_mismatch`(「comparisonMode導出の実装時に導入予定」としていた仮の理由コード)は実際には使用しておらず、上記3つの理由コードに置き換わったことをここで明示する。
>
> 回帰テストを新規ファイル(`quantity_comparison_mode_candidate_verification.js`、37件)として追加した。固定表5組すべてが対応するmodeを生成すること、`required_capability_domain × achieved_point`が引き続き未対応のままであること、対応表に無いその他の組み合わせ・両側未解決(ambiguous/unavailable)・否定根拠ありのいずれも推測しないこと、`result_complete !== true`の上流をfail closedすること(B-2.2b承認時に固定された段階3の契約をここでも直接検証)、relations正順・逆順で同一結果になること、`comparison_mode_confidence`が両側confidenceの最小値であること(片側の値だけを使う実装へ差し替えると検知できることを確認済み)、数値比較・単位変換・充足判定フィールドが混入しないこと、固定表の組数(5)が意図せず変化していないこと。5件の防御(上流ready/result_completeゲート・両側resolved検査・否定根拠検査・固定表参照・min採用)をそれぞれ個別に無効化すると対応するテストだけが失敗することを確認した上で復元した。
>
> **訂正（`b17d8e0`レビュー、2026-07-21、重大1件・中1件）**：初回実装には次の欠陥があった。
> 1. **【重大】公開exportされた`COMPARISON_MODE_DERIVATION_TABLE`(配列・各entryオブジェクトとも)が凍結されておらず、呼び出し側から実行時に変更できた**：ファイル末尾の`Object.freeze({...})`は戻り値のAPIオブジェクト自身だけを凍結する浅い凍結であり、その中に格納された配列・オブジェクトまでは凍結されない。`generateComparisonModeCandidates()`はexportされたのと同じ配列参照を`find()`しているため、呼び出し側が`core.COMPARISON_MODE_DERIVATION_TABLE.push({requirement:'required_capability_domain', actual:'achieved_point', mode:'point_in_region'})`のようなコードを実行すると、v2.10で安全側の理由により意図的に除外した組み合わせを実行時に復活させられることを実際に確認した(修正前の状態で再現・検証済み)。ソースコードの乖離検出(バイト単位diff)は実行後のランタイム変更を検出できない、という別種の防御が必要だった。修正: 移植ブロック自体(乖離検出対象、改変禁止)はそのままに、ポート直後の行で`COMPARISON_MODE_DERIVATION_TABLE.forEach(Object.freeze); Object.freeze(COMPARISON_MODE_DERIVATION_TABLE);`を追加し、配列・各entryの両方を凍結した(`bindSide()`の`deepFreeze()`と同じ「一度作った不変ツリーを外部から書き換えさせない」原則をここでも適用)。
> 2. **【中】not_analyzedの`condition_unresolved`/`comparison_mode_unavailable`監査記録がstatus/value/opposing_evidence/参照IDのみで、B-2.3aのcondition annotated candidateが既に保持している`top_confidence`/`margin`(両側)が引き継がれていなかった**：この結果、除外理由が「confidence不足」なのか「次点候補とのmargin不足」なのかを、B-2.3bの監査出力単体からは判別できなかった、と指摘された。修正: `auditBase`へ`requirement_condition_top_confidence`/`requirement_condition_margin`/`actual_condition_top_confidence`/`actual_condition_margin`の4スカラーを追加した(新たな計算は発生せず、B-2.2b承認時に確立した「候補・evidence配列は複製せずスカラー値だけを付加する」方式をそのまま踏襲)。
>
> 回帰テストを37件から46件へ拡張した。追加した主なケース：固定表配列・各entryが`Object.isFrozen()`でtrueであること、`push()`・entry直接書き換えのいずれも反映されないこと(組数・値が変化しない)、変更を試みた後も`required_capability_domain × achieved_point`がcomparison mode候補を生成しないこと(表を読み取り専用に「見せる」だけでなく実際の導出結果にも効いていることの確認)、`condition_unresolved`(ambiguous・unavailableそれぞれ)・`comparison_mode_unavailable`のいずれにも両側のtop_confidence/marginが正しく保持されること。2件の防御(表の凍結・監査フィールドの実配線)をそれぞれ個別に無効化すると、対応するテストだけが失敗することを確認した上で復元した(表の凍結を無効化した再現テストでは、実際に除外済みペアのcomparison mode候補が生成されることを確認している)。
>
> **訂正（B-2.4a設計・実装、`31a4002`承認後、2026-07-21）**：3.4節 段階4の最初の部分として、単位互換性の判定と変換計画の生成だけを行う`generateUnitConversionPlans({binding, relations, ...})`を実装した。段階3-3(`generateComparisonModeCandidates()`)をbindingから内部で計算し、`ready!==true`または`result_complete!==true`ならfail closedする(前段までと同じ連鎖)。各comparison mode候補のquantity_idからbinding内のanalysisを再引きし(`analysisByQuantityId()`、quantity情報を外部引数として受け取れるAPIにはしない)、片側でも見つからなければ部分的に続行せず呼び出し全体をfail closedする(`unit_plan_quantity_missing`)。数量値・区間境界(`lower`/`upper`/`alternatives`)へは一切変換を適用しない。既存の`coverageGap()`(quantity_extraction_prototype.js)はcanonical単位が異なるだけで比較不能にした上で数値比較・充足判定まで一気に進む設計であり、単位互換性判定だけを切り出したこの段階とは責務が異なるため呼び出さない。
>
> 単位互換性の分類は次の純粋関数`classifyUnitConversion(requirementUnit, actualUnit)`に切り出した（`generateUnitConversionPlans()`から独立してテストできるようにするため。理由は次段落参照）。
> 1. **metadata不備**（`dimension`/`canonical`が空、`unit`オブジェクト自体が無い、または`dimension:'unknown'`——`quantity_extraction_prototype.js`の`unitInfo()`が単位記号を認識できなかった場合のフォールバック値）：`unit_metadata_unsupported`としてnot_analyzedへ送る（`ready:true`のまま、他候補は続行）。
> 2. **dimensionが一致しない**：`unit_dimension_inconsistent`として**呼び出し全体をfail closed**する。段階1のdimension/concept絞り込みにより、同じ次元同士でなければcomparison候補自体が生成されないため、通常はここへ到達しないはずであり、到達した場合は上流結果とquantity実体が矛盾しているという構造的異常を意味する（`unit_plan_quantity_missing`と同じ「防御的、通常到達不能」の位置づけ）。
> 3. **canonicalが同一**：`conversion_required:false`の`identity`計画（`factor:1, offset:0`）。
> 4. **canonicalが異なるがdimensionは同一で、固定の線形変換規則がある**：`conversion_required:true`の`linear_scale`計画。基準単位からの倍率表`LINEAR_UNIT_SCALE_TO_BASE`（現時点ではpressureのみ、`{Pa:1, kPa:1000, MPa:1000000}`——`UNIT_DEFS`(quantity_extraction_prototype.js 112-136行目)の各`standard_ref`が実際に参照するのはJIS Z 8203ではなくJIS Z 8000規格群(全12部、量及び単位)であり、pressureはJIS Z 8000-4(力学)に分類される。pressureだけが同一dimension内に複数のcanonical単位を持つため）を使い、`factor = 実仕様側の基準倍率 / 要求側の基準倍率`を計算する。変換方向は常に**actual→requirement固定**（`source_side:'actual', target_side:'requirement'`。将来、差分値や判定結果を要求仕様の単位で表示できるようにするため）。
> 5. **canonicalが異なりdimensionは同一だが、固定の線形変換規則が無い**（スキーマ上だけ`psi`のような未対応canonicalが入力された場合など）：`unit_conversion_unsupported`としてnot_analyzedへ送る（推測で係数を生成しない）。
>
> `LINEAR_UNIT_SCALE_TO_BASE`は、B-2.3bの`COMPARISON_MODE_DERIVATION_TABLE`と同じ理由で、内側のdimension別オブジェクトと外側のオブジェクトの両方を`Object.freeze()`する（この表を呼び出し側が書き換えられると、後続の数値比較結果を任意に操作できてしまうため）。
>
> **テスト設計上の制約（CONCEPT_DICTIONARYにpressure次元の概念が無い）**：B-2.2aの`CONCEPT_DICTIONARY`は6概念とも`expected_dimension`がtemperature/power/voltage/frequency/sound_pressure_level/lengthのいずれかで、pressureを期待する概念が存在しない。`generatePropertyCandidates()`の単位次元一致根拠(+0.4)が得られないpressure次元の数量は、周辺語+タグが両方一致しても確信度が最大0.6にとどまり、`propertyConfidence`(0.7)の閾値へ届かないため、concept解決で`resolved`に至れず、comparison_mode_candidateまで到達できない。つまり、公開APIの正常経路だけではPa/kPa/MPa間の変換をend-to-endで再現できない。このため、単位変換の数値計算そのもの(Pa/kPa/MPa間の6方向)は独立して公開した`classifyUnitConversion()`を直接呼んで検証し、`generateUnitConversionPlans()`自体の配線(fail closedゲート・quantity参照・監査フィールド伝播)は到達可能なpower/kW(canonical単位が1種類のみ、identity経路)を使ったend-to-endテストで別途検証する、という2段構えのテスト設計にした。`unit_plan_quantity_missing`・`unit_dimension_inconsistent`(呼び出し全体のfail closedとしての発火)は、いずれも「通常到達不能」な防御的分岐であり、B-2.3aの`condition_resolution_missing`と同じ位置づけで、一時的なバグ注入(該当ガードを無効化・強制発火させる)によって配線が生きていることを確認した(恒久的な回帰テストとしては、到達可能な経路のみを固定した)。
>
> 新規テストファイル(`quantity_unit_conversion_plan_verification.js`、55件)を追加した。`classifyUnitConversion()`の直接検証(同一canonicalのidentity、pressure6方向の正しいfactor、変換方向が常にactual→requirement、dimension不一致、未対応canonical、metadata不備の各パターン)、固定表の実行時不変性(凍結・書き換え試行・書き換え試行後も正しい計画のまま)、`generateUnitConversionPlans()`のend-to-end検証(上流ready/result_complete gate、relations正順・逆順一致、元の参照ID・comparison mode情報の維持、bindingの元analysisが呼び出し前後で不変、範囲外フィールド不在、実fixtureでの全計画がidentityまたはpressureのlinear_scaleに限定されること)を含む。5件の防御(上流ゲート・表の凍結・metadata不備検査・dimension不一致検査・factor計算の方向)をそれぞれ個別に無効化すると対応するテストが失敗する(表の凍結無効化では実際に係数が書き換え可能になることを、factor方向の逆転では6方向すべてのテストが失敗することを確認)ことを確認した上で復元した。
>
> **訂正（`34c7e9a`レビュー、2026-07-21、重大1件・中3件）**：初回実装には次の欠陥があった。
> 1. **【重大】既知単位のallowlistが無く、canonical文字列が同一というだけでidentity計画にしていた**：JSON Schemaは`unit.canonical`/`unit.dimension`を単なる文字列としてしか検証せず、既知単位のenumやcanonical-dimension対応そのものは検証しない。修正前の実装は「非空文字列」「dimensionが`'unknown'`でない」の2条件しか確認しておらず、(a) スキーマ上だけ存在する未登録canonical同士(例:`psi`×`psi`、dimension:`pressure`)、(b) 既知canonicalが誤ったdimensionと組み合わされたデータ(例:`kW`をdimension:`voltage`として記録)が、いずれも正しい既知単位であるかのようにidentity計画になってしまうことを、実際に両ケースを再現して確認した。修正: `UNIT_DEFS`(quantity_extraction_prototype.js)が実際に定義する(dimension, canonical)の組だけをallowlist化した`KNOWN_CANONICAL_UNITS_BY_DIMENSION`を新設し、両側がこのallowlistに含まれることをidentity/linear_scale判定より前に確認するようにした。`UNIT_DEFS`本体との乖離検出(双方向の集合比較)も`quantity_annotation_ported_lib_check.js`へ追加した。
> 2. **【中】単位互換性の分類ロジック(`classifyUnitConversion()`)が、bindingを経由せず任意のunitオブジェクトを受け取れる純粋関数のまま`quantity_sidecar_binding_core.js`の公開APIとしてexportされていた**：これは「公開APIはbinding経由でのみ計算する」という信頼境界(B-2.2a round1以来一貫して守ってきた設計方針)の外側から呼べる入口を増やしてしまう、と指摘された。修正: `classifyUnitConversion()`・`KNOWN_CANONICAL_UNITS_BY_DIMENSION`・`isKnownUnit()`・`LINEAR_UNIT_SCALE_TO_BASE`を独立したライブラリファイル`unit_conversion_rules_prototype.js`(quantity_extraction_prototype.js・semantic_mapping_prototype.jsと同じ、依存ライブラリゼロの単体実行可能なプロトタイプファイル)へ切り出し、`quantity_sidecar_binding_core.js`はこれを一字一句移植して内部の非公開実装詳細としてのみ使う(公開APIとしては`classifyUnitConversion()`を再exportしない。データテーブルである`KNOWN_CANONICAL_UNITS_BY_DIMENSION`/`LINEAR_UNIT_SCALE_TO_BASE`自体は、CONCEPT_DICTIONARY・COMPARISON_MODE_DERIVATION_TABLEと同じく実行時不変性を検証する目的でexportを維持した。pressureの数値計算はunit_conversion_rules_prototype.jsを直接requireして検証し、`generateUnitConversionPlans()`自体の配線はpower/kW経由のend-to-endテストで検証する2段構えのテスト設計は維持している)。
> 3. **【中】`unit_plan_quantity_missing`・`unit_dimension_inconsistent`をfail closedへ変換する配線に恒久的な回帰テストが無く、一時的なバグ注入による検証のみだった**：一時的なソース改変試験は有用だが回帰テストの代替にはならない、と指摘された。この2つの防御は、`analysisByQuantityId()`とcomparison mode候補を生成する上流チェーン(段階1〜3-3)が**同一の`binding.{side}.bindings[].annotation.analyses`という単一のデータソースを、異なる添字方法(trace_id単位／quantity_id単位)で読んでいるだけ**という構造上、いかなるbinding構築(`bindInputPair()`経由・手動構築のいずれも)によっても到達不能であることを確認した(B-2.3aの`condition_resolution_missing`・B-2.3bで確立した「構造的に到達不能な防御分岐は一時的なバグ注入で検証する」という前例と同じ位置づけ)。「到達不能性を証明して分岐を削除する」という代替案も検討したが、これらは将来のリファクタリングがこの不変条件を偶発的に破った場合の最後の防衛線であり、B-2.3a以来この種の防御を保持し続けてきた本プロジェクトの一貫した方針(前回・前々回のレビューでも同種の分岐が承認されている)から見て、分岐自体を削除するのは後退と判断した。今回はこの2つに加え、`generateUnitConversionPlans()`の配線を`classifyUnitConversion()`の戻り値を強制的に`'inconsistent'`にする形の注入でも改めて検証し(移植元と移植先の内容が`quantity_annotation_ported_lib_check.js`の乖離検出でバイト単位一致することも確認済みのため、移植元での挙動確認は移植先の非公開コピーの挙動確認と同値になる)、乖離検出自体が実際に差分を検知することも確認した。
> 4. **【中】単位未対応で除外した候補の`not_analyzed`監査記録から、comparison mode・condition解決の情報が失われていた**：成功した計画は元のcomparison mode候補を丸ごと保持する(`{...candidate, unit_conversion_plan}`)のに対し、`unit_metadata_unsupported`/`unit_conversion_unsupported`の監査記録はquantity/trace/matcher参照ID・concept_id/dimension・単位metadataだけで、`comparison_mode_candidate`・`comparison_mode_confidence`・`derived_from`・両側のcondition status/value/top_confidence/margin/opposing_evidenceが失われていた、と指摘された。修正: 監査記録も`{...candidate}`(段階3-3のcomparison mode候補全体)をベースに単位metadata情報を追加する形へ変更した(候補・evidence配列自体はここでは複製していないため、コストは小さい)。
>
> 回帰テストを55件から84件へ拡張した。追加した主なケース：未登録canonical同士(`psi`×`psi`)・既知canonicalの誤dimension組み合わせ(`kW`×`voltage`・`V`×`power`)・空白のみのcanonical/dimensionがいずれもidentityにならないこと、`KNOWN_CANONICAL_UNITS_BY_DIMENSION`に実在する全既知単位が単独では引き続きidentityになること(allowlistが正しい単位自体を締め出していないことの確認)、既知単位表・線形変換表の両方の実行時不変性(凍結・書き換え試行・書き換え試行後の正しさ)、不正sidecar(未登録canonical・誤dimension)を使った`generateUnitConversionPlans()`自体のend-to-endテスト2件、単位未対応`not_analyzed`にcomparison mode/condition監査情報が引き継がれること。4件の防御(既知単位検証・既知単位表の凍結・監査フィールドの実配線、および`unit_conversion_unsupported`分岐自体)をそれぞれ個別に無効化する、またはunit_conversion_rules_prototype.js側で強制発火させると、対応するテストが失敗する(または実際に誤った計画が生成される)ことを確認した上で復元した。
>
> **訂正（`db770de`レビュー、2026-07-21、重大1件（2巡目）・中1件（受理済み・対応不要と確認）・中1件（記述の明確化のみ、コード変更なし））**：上記round1修正でも、`isKnownUnit()`とallowlist本体のown property検証に、なお1件の穴が残っていた。
> 1. **【重大、2巡目】`isKnownUnit()`の`KNOWN_CANONICAL_UNITS_BY_DIMENSION[key]`真偽値判定と、`classifyUnitConversion()`内の線形変換表`LINEAR_UNIT_SCALE_TO_BASE`に対する`key in scaleTable`判定が、いずれも通常のJavaScriptオブジェクトリテラルが継承する`Object.prototype`のプロパティ('toString'・'constructor'・'__proto__'・'hasOwnProperty'等)にもtrueを返してしまうことが指摘された**：`Object.freeze()`はプロパティの追加・変更・削除を防ぐが、オブジェクトを`Object.prototype`から切り離したり`Object.prototype`自体を凍結したりはしないため、allowlistを凍結していても迂回経路は塞がれない。実際に再現して確認した：修正前は`canonical:'toString', dimension:'power'`同士を渡すと`toString in KNOWN_CANONICAL_UNITS_BY_DIMENSION.power`が(継承プロパティのため)trueになりidentity計画を誤って生成し、pressureで異なる継承キー同士(`canonical:'toString'`×`canonical:'constructor'`)を渡すと`scaleTable['toString']`/`scaleTable['constructor']`がいずれも関数オブジェクトになり、その除算(`factor`)が`NaN`のlinear_scale計画を生成してしまっていた。修正：`Object.prototype.hasOwnProperty.call(object, key)`によるown property専用の`hasOwn(object, key)`ヘルパーを新設し、`isKnownUnit()`のdimension・canonical双方の判定と、`classifyUnitConversion()`の線形変換表の`requirementUnit.canonical`/`actualUnit.canonical`双方の判定を、すべて`hasOwn()`経由へ置き換えた。加えて、`hasOwn()`化で数値以外の混入は塞がれたはずだが、最後の防御として`factor`計算直後に`Number.isFinite(factor)`を確認し、有限数でなければ新設の理由コード`unit_conversion_invalid_factor`で`not_analyzed`へ送るガードを追加した(現在の登録データ(`Pa:1, kPa:1000, MPa:1000000`)では`factor`は常に正の有限数になるため、`hasOwn()`化後のこのガード自体は構造的に到達不能である。線形変換表の`hasOwn()`置換も、`isKnownUnit()`が`canonical`を既に有限個のallowlist済み文字列——継承プロパティ名のいずれとも一致しない——へ制限した後にしか到達しないため、同様に構造的に到達不能である。いずれも、B-2.4a round1で確立した「到達不能な防御的分岐は削除せず保持し、一時的なバグ注入でのみ検証する」という方針をそのまま踏襲し、削除しなかった。バグ注入では、`isKnownUnit()`の`hasOwn()`を無効化すると新設のend-to-endテストが実際に失敗することを確認し、線形変換表側の`hasOwn()`および`Number.isFinite(factor)`ガードは、それぞれ無効化してもセルフチェック7件が全件成功したままであることを確認して、上記の到達不能性の判断を裏付けた)。
> 2. **【中、受理済み】`unit_plan_quantity_missing`・`unit_dimension_inconsistent`をfail closedへ変換する2つの防御的分岐について、恒久回帰テストではなく一時的なバグ注入のみによる検証にとどめたことの是非が再度問われたが、round1で示した「同一のbinding.{side}.bindings[].annotation.analysesを異なる添字方法で読んでいるだけで構造的に到達不能」という証明を踏まえ、分岐を削除せず防御的assertionとして保持する現行方針のまま、対応不要（ブロッカーとしない）と受理された**：コード・設計文書とも変更なし。
> 3. **【中、記述の明確化】`KNOWN_CANONICAL_UNITS_BY_DIMENSION`/`LINEAR_UNIT_SCALE_TO_BASE`の2つのデータテーブルが依然として`quantity_sidecar_binding_core.js`の公開APIからexportされている点について、round1での「公開APIとしては再exportしない」という説明との整合性が問われた**：確認の結果、round1の設計文書自体は「データテーブル自体は実行時不変性を検証する目的でexportを維持した」と当初から正確に記述しており(本節の直前の段落を参照)、コード・設計文書のいずれにも変更は不要だった。round1の対話上の要約説明が「両テーブルとも再exportしない」であるかのように誤解を招く言い回しだったことが原因であり、次回のレビュー回答で明確化した。
>
> 直接検証の`classifyUnitConversion()`セルフチェックを5件から7件へ拡張した(`toString`×`toString`(power)・異なる継承キー`toString`×`constructor`(pressure)の2件)。`quantity_unit_conversion_plan_verification.js`の回帰テストを84件から91件へ拡張した：直接検証側に`['toString', 'constructor', '__proto__', 'hasOwnProperty']`の4継承キーをpower次元の両側canonicalとして渡す4件、pressure次元での異なる継承キー同士(`toString`×`constructor`)1件を追加し、さらに公開パイプライン`generateUnitConversionPlans()`経由のend-to-endテストとして、`canonical:'toString', dimension:'power'`を含む不正sidecarからidentity計画が生成されないことを確認する2件(前提確認1件・本検証1件)を新設した(round1までの不正sidecarend-to-endテストは`XYZ`(未登録架空canonical)・誤dimensionの`kW`のみを検証しており、継承プロパティ名をcanonicalとして渡すケースは未検証だった)。
>
> **訂正（B-2.4b設計・実装、`1ad75f9`承認後、2026-07-21）**：3.4節 段階4の後半部分として、`generateUnitConversionPlans()`の各計画を実仕様側の数量値の複製へ適用し、要求側の単位で表した正規化ビューを生成するだけの`generateNormalizedQuantityViews({binding, relations, ...})`を実装した。段階4前半(`generateUnitConversionPlans()`)をbindingから内部で計算し、`ready!==true`または`result_complete!==true`ならfail closedする(前段までと同じ連鎖、理由コード`unit_conversion_plans_not_ready_or_incomplete`)。各計画のquantity_idからbinding内のanalysisを再度索引化して取得し(`analysisByQuantityId()`を`generateUnitConversionPlans()`と同様に再利用。中間結果として渡された`unit_conversion_plans`だけでは元の数量値そのものを保持していないため)、片側でも見つからなければ部分的に続行せず呼び出し全体をfail closedする(`normalized_view_quantity_missing`、`unit_plan_quantity_missing`と同じ「同一のbindingを同期的に2回読むだけなので構造的に到達不能」という位置づけの防御)。
>
> 数量値(`quantity_extraction_prototype.js`が生成するkind:`'interval'`|`'alternatives'`のいずれか)への計画適用は、独立した純粋関数`applyLinearConversion(quantityValue, plan)`に切り出した(`classifyUnitConversion()`と同じ理由で`unit_conversion_rules_prototype.js`へ追加し、`quantity_sidecar_binding_core.js`は一字一句移植した非公開実装としてのみ使う。公開APIとしては再exportしない)。`factor`/`offset`を使い`value*factor+offset`で各数値を変換し、`kind:'interval'`は`lower`/`upper`それぞれ(nullの場合は変換せずnullのまま)、`kind:'alternatives'`は`options`配列の各要素を変換する。identity計画(`factor:1, offset:0`)であっても同じ経路を通り、常に新しいオブジェクトを返す(引数の`quantityValue`自体は一切変更しない。「複製」であることを呼び出し側が信頼できるようにするための契約)。`kind`が上記2値のいずれでもない場合は`null`を返す(quantity-annotationのJSON Schemaがkindをこの2値の判別可能な共用体としてのみ許可し、`bindSide()`がスキーマ検証失敗時に文書全体をbindしないfail closed契約のため、bindingを経由する限り構造的に到達不能なはずの防御的分岐。`generateNormalizedQuantityViews()`側は`null`が返った場合、呼び出し全体を止めず該当候補だけを推測せず`not_analyzed`(理由コード`quantity_value_kind_unsupported`)へ送る——単位metadata不備と同じ「個々の候補だけを除外する」扱い)。
>
> 出力の各要素(`normalized_quantity_views[]`)は、元のcomparison mode候補・単位変換計画の全フィールドを`{...entry}`でそのまま維持した上で、`requirement_quantity_value`(要求側の元の数量値、既に要求単位)・`actual_quantity_value_original`(実仕様側の元の数量値、実仕様側の単位のまま)・`actual_quantity_value_normalized`(`applyLinearConversion()`の結果、要求単位で表した新しい数量値)の3フィールドを追加する。数値比較・区間包含判定・gap計算・auto applicability・充足判定はこの段階でも一切行わない(範囲外のまま)。
>
> B-2.2aのCONCEPT_DICTIONARYにpressure次元の概念が無い制約は本段階にも及ぶため、B-2.4aと同じ2段構えのテスト設計にした：`applyLinearConversion()`自体の数値計算(pressureのPa/kPa/MPa間6方向、区間・alternatives両kind、片側null区間、複製であることの確認)は`unit_conversion_rules_prototype.js`を直接requireして検証し、`generateNormalizedQuantityViews()`自体の配線(fail closedゲート・quantity再参照・監査フィールド伝播・入力順非依存)は到達可能なpower/kW(identity経路)を使ったend-to-endテストで別途検証する。新規テストファイル(`quantity_normalized_quantity_view_verification.js`、35件)を追加した。4件の防御(上流fail closedゲート・`applyLinearConversion()`の複製契約・`normalized_view_quantity_missing`・`quantity_value_kind_unsupported`への振り分け)をそれぞれ個別に無効化すると、対応するテストが失敗する(または実際に元オブジェクトと同一参照になる、実際にfail closedせず処理が続く)ことを確認した上で復元した。`normalized_view_quantity_missing`は`unit_plan_quantity_missing`と同じ理由で恒久的な自然発火テストは無く、一時的なバグ注入によってのみ配線を検証した(削除はせず防御的assertionとして保持する、B-2.3a以来一貫した方針)。
>
> **訂正（`1fbfe90`レビュー、2026-07-21、重大3件・中1件）**：初回実装には次の欠陥があった。
> 1. **【重大1】`applyLinearConversion()`が`value*plan.factor+plan.offset`を型・有限性を確認せず全数値へ適用しており、`alternatives.options`(JSON Schema上`{type:'array'}`のみでitemsが未定義、要素の型自体が未検証)にnull/文字列/object/真偽値/NaN/Infinityが混入していても、JavaScriptの暗黙型変換によって別の数値へ解釈されてしまうか、`NaN`/`Infinity`のまま「正規化済み」として出力されることを実際に確認した(intervalの`lower`/`upper`の`value`もJSON Schema上`type:'number'`としてしか検証されず、独自validatorの`typeMatches()`は`Number.isFinite()`を検査しないため、NaN/Infinityも通過する)。修正: `isFiniteNumber(value)`(`typeof value==='number' && Number.isFinite(value)`)による検証を、変換前(入力自体の型・有限性)と変換後(演算結果がオーバーフローしてInfinityになる場合)の両方に追加した。新設の理由コード`quantity_value_invalid`(入力が不正)・`quantity_conversion_non_finite`(演算結果が非有限)を使い分ける。
> 2. **【重大2】要求側(requirement)の数量値を一切検証せず、そのまま正規化ビューへ格納していた**：この段階の出力は後続の数値比較の入力になる前提であり、変換対象のactual側だけでなく、変換自体は行わないrequirement側も同じ基準(型・有限性・件数上限)で検証しておく必要がある、と指摘された。修正: `validateQuantityValueStructure(quantityValue)`を新設し、requirement側にも変換前に適用するようにした。異常があれば`side:'requirement'`を明示した`not_analyzed`エントリへ送り、正規化ビューを生成しない(actual側の異常は`side:'actual'`)。
> 3. **【重大3】`alternatives.options`はJSON Schema上サイズ上限(maxItems)が無く、件数検査より前に`.map()`で全件複製していたため、極端に大きなoptions配列を入力すると、変換済み配列を新たに全件生成してしまう(B-2.2b/B-2.3aで対策した組み合わせ爆発と同種の問題)**、と指摘された。修正: `interval_semantics_candidates`の上限(`MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY`、64)と同じ値の`MAX_ALTERNATIVE_VALUES_PER_QUANTITY`(64)を新設し、件数検査を`.map()`/`.every()`等いかなる全件走査よりも前に行う(新設の理由コード`quantity_value_limit_exceeded`)。件数超過確定後は`.map()`/`.every()`/イテレータへ一切アクセスしないことを、Proxyでこれらへのアクセスを検知するテストで直接証明した。
> 4. **【中1】`applyLinearConversion()`は独立ライブラリからexportされる純粋関数であり、coreの正常経路(`classifyUnitConversion()`が返す常に有限・正のfactor)では安全だが、`plan`自体は呼び出し側から任意に構築できるため、`factor`/`offset`の有限性・`factor`の正数性を検証していなかった**、と指摘された(負のfactorはlower/upperの入れ替えが必要になるが未対応のため)。修正: 変換前に`isFiniteNumber(plan.factor) && isFiniteNumber(plan.offset) && plan.factor > 0`を確認し、満たさなければ新設の理由コード`quantity_conversion_plan_invalid`で拒否する。
>
> `applyLinearConversion()`の戻り値契約を、`null`(未知kind)または変換済みオブジェクトを直接返す形から、`{outcome:'converted', value}`／`{outcome:'unsupported', reason_code, ...}`という判別可能な共用体へ変更した(単なる`null`では未知kind・非数値・オーバーフローを区別できないという指摘を踏まえた)。`validateQuantityValueStructure()`は数量値の構造検証だけを行う(変換は行わない)独立関数として切り出し、requirement側の検証にも共用する。この2つの重大3・中1の防御(alternatives件数上限・plan自体の検証)は、`isKnownUnit()`がcanonicalを既に有限個のallowlist済み文字列へ制限した後にしか到達しない`hasOwn()`と同様、正常経路(`classifyUnitConversion()`が返す計画・`quantity_extraction_prototype.js`が生成する数量値)だけを辿る限りは到達しないが、独立してexportされる純粋関数・JSON Schemaが保証しない構造という2つの理由から、防御的に保持する。
>
> 直接検証の`applyLinearConversion()`セルフチェックを12件から27件へ拡張し、レビューが要求した13件の必須テスト(alternativesの正常値・空配列・null/文字列/object/NaN/Infinity要素、interval境界のNaN/Infinity、演算結果オーバーフロー、plan自体のfactor/offset異常、options件数の上限ちょうど/超過、Proxyによる全件走査未到達の証明)をすべて含めた。`quantity_normalized_quantity_view_verification.js`の回帰テストを35件から59件へ拡張し、要求側異常値・実仕様側異常値それぞれのend-to-end拒否(理由コード・`side`フィールドの確認を含む)、正常なalternatives(2要素)を使った公開パイプラインのend-to-end、異常候補の`not_analyzed`にcomparison mode/condition監査情報が引き継がれること、実fixture・power/kWサンプルの全正規化ビューで3種の数量値すべてが有限数であることを追加した。4件の防御(入力の型・有限性検証、alternatives件数上限、plan自体の検証、requirement側の検証)をそれぞれ個別に無効化すると、対応するテストが失敗する(またはProxyが例外を送出して全件走査への到達を検知する、異常な要求側数量値が検証を経ずに出力へ混入する)ことを確認した上で復元した。
>
> **訂正（`c00cc3a`レビュー、2026-07-21、重大2件・中1件）**：上記round1修正でも、「後続の数値比較に耐える数量構造」という契約に対し、値を1件も持たない数量を正常扱いする穴と、任意入力に対する例外安全性の不足が残っていた。
> 1. **【重大1、2巡目】0要素の`alternatives`が正常な変換対象として扱われていた**：`validateQuantityValueStructure()`の件数上限検査は`options.length > MAX_ALTERNATIVE_VALUES_PER_QUANTITY`のみを見ており、0件は上限を超えないため`outcome:'ok'`になる。0要素配列に対する`.every(isFiniteNumber)`も(要素が無いため)`true`を返す。しかし`alternatives`は選択可能な数量値の集合であり、0件では後続の数値比較に使える値が1つも無い(正常な抽出器が生成する並列値は常に2要素)。修正: 件数上限検査と同じ「要素走査より前」の位置に`options.length === 0`の検査を追加し、新設の理由コード`quantity_value_empty`で拒否する。
> 2. **【重大2、2巡目】lower/upper両方がnullのintervalが正常な変換対象として扱われていた**：`validateQuantityValueStructure()`のinterval検証は`quantityValue.lower && ...`/`quantityValue.upper && ...`という「存在する場合だけ検証する」形になっており、両方nullの場合はどちらの条件も素通りして`outcome:'ok'`になっていた。片側だけがnull(片側無限)であることは正当な区間表現だが、両側nullは数値情報を1つも持たない空集合と等価であり、alternativesの空配列と同じ問題を持つ。修正: lower/upperがともにnullの場合を`quantity_value_empty`として明示的に拒否する分岐を追加した(片側のみnullの正常ケースは引き続き成功することも回帰テストで確認)。
> 3. **【中1、2巡目】`validateQuantityValueStructure()`・`applyLinearConversion()`が、null/undefined/非オブジェクトの入力に対して例外を投げていた**：`validateQuantityValueStructure(quantityValue)`は最初に`quantityValue.kind`へアクセスするため`quantityValue`がnullなら`TypeError`になり、`applyLinearConversion(quantityValue, plan)`も`plan.factor`へのアクセスで`plan`がnullなら`TypeError`になることを実際に確認した。coreの正常経路ではJSON Schema検証と上流の生成ロジックにより保護されているが、これら2関数は独立ライブラリからexportされる純粋関数であり、任意入力を受け取りうる契約として例外ではなく判別可能な`unsupported`を返すべき、と指摘された。修正: `validateQuantityValueStructure()`の先頭で`quantityValue`がnull/undefined/非オブジェクト(配列を含む)でないことを確認し(理由コード`quantity_value_invalid`)、`applyLinearConversion()`の先頭で`plan`についても同様に確認する(理由コード`quantity_conversion_plan_invalid`)ようにした。加えて、`alternatives.options`が配列であること・interval の`lower`/`upper`が(nullでない場合)オブジェクトであることも同じ理由コード(`quantity_value_invalid`)で確認するようにした。
>
> 直接検証の`applyLinearConversion()`セルフチェックを27件から36件へ拡張し、0要素alternatives・両側null interval・片側nullの回帰防止・null/配列/文字列のquantityValue・nullのplan・非配列options・非オブジェクトlowerの各ケースを追加した。`quantity_normalized_quantity_view_verification.js`の回帰テストを59件から76件へ拡張し、空のalternatives・両側null intervalそれぞれをrequirement側・actual側の両方で公開パイプライン経由に拒否するend-to-endテスト(監査情報の引き継ぎ確認を含む)を追加した。3件の防御(alternatives空配列検査・interval両側null検査・quantityValue自体のnull/非オブジェクト検査)をそれぞれ個別に無効化すると、対応するテストが失敗する(またはnull入力で実際に例外が送出される)ことを確認した上で復元した。
>
> **訂正（`be47b9d`レビュー、2026-07-21、重大1件・中3件）**：`[10,5]`や`[5,5)`のような数学的に空の区間(`lower>upper`、または`lower===upper`かつ片側でも排他的境界)が、既存`isEmptyInterval()`(quantity_extraction_prototype.js 458-463行目)と異なる基準で「有効」扱いされていた。加えて、境界`inclusive`の型未検証(欠落・非boolean値がそのまま複製される)、`alternatives.selection_semantics`の未検証(欠落・非文字列でも通る)、`options.every()`/`.map()`直接呼び出し(プログラム的に生成された配列でメソッド自体を上書きされるとTypeError、実際に再現して確認)を修正した。`isEmptyInterval()`と同じ判定を`validateQuantityValueStructure()`へ追加(理由コード`quantity_value_empty`共用)、境界検証を`isValidBound()`(`value`/`inclusive`のown property・型を確認)に置き換え、`selection_semantics`を非空文字列として検証、alternatives処理を添字ループへ変更した。直接テストを36件から48件、`quantity_normalized_quantity_view_verification.js`を76件から80件へ拡張し、requirement/actual両側での矛盾区間end-to-end拒否を追加。4件の防御を個別に無効化し、テスト失敗またはoverride配列での実際の例外送出を確認の上で復元した。
>
> **B-2.5設計・実装（`89055c6`承認後、2026-07-21）**：3.4節 段階4の最後の部分として、正規化ビュー(B-2.4b)の各要素について、`comparison_mode_candidate`(段階3-3で確定済み)を前提とした幾何学的関係の成立・不成立だけを計算する`generateNumericComparisonResults({binding, relations, ...})`を実装した。confidenceに基づく自動適用可否・最終的な充足判定はこの段階では行わず、`satisfied`という名前のフィールドは一切出力しない(`geometric_relation_holds`とする——レビュー指摘。quantity_extraction_prototype.jsの`coverageGap()`/`pointInRegionResult()`はmode自動選択・comparable判定・幾何比較・gap計算・`satisfied`・`provisional`・assumptionsを1つの関数に混在させており、そのまま移植すると責務が混在するため)。
>
> 幾何学的な純粋ヘルパー(`isGenuinePoint()`・`coversLower()`・`coversUpper()`、無限境界・inclusive境界を含む)だけをquantity_extraction_prototype.js(467-492行目)から一字一句移植し、新設の`comparePointInRegion()`・`compareIntervalCoverage()`(`numeric_comparison_rules_prototype.js`)がこれを使う。`coverageGap()`・`pointInRegionResult()`自体は移植しない。`comparePointInRegion()`はactualが真の点(`isGenuinePoint()`)であることを要求し、`compareIntervalCoverage(outer, inner)`はrequirement/actualの意味を一切知らない汎用の区間包含判定として設計し、どちらがouter/innerかは呼び出し側(`generateNumericComparisonResults()`、mode別にactual_covers_requirement→outer=actual/inner=requirement、requirement_covers_actual→outer=requirement/inner=actual)で決定する。`signed_boundary_deltas`(`lower_actual_minus_requirement`/`upper_requirement_minus_actual`)は3モード共通の固定式で呼び出し側が直接requirement/actualの実値から計算し、幾何プリミティブ自体はrequirement/actualの意味を持たない。
>
> `kind:'alternatives'`は選択意味論(`selection_semantics`)の解釈が未設計のため、`coverageGap()`と同じく比較不能として個別候補を`not_analyzed`(理由コード`quantity_comparison_kind_unsupported`、`requirement_quantity_kind`/`actual_quantity_kind`を伴う)へ送る。`comparison_mode_candidate`が既知の3値以外の場合(上流契約違反、構造的異常)、または正規化ビューのinterval数量値がB-2.4bの検証済みという前提を満たさない場合(防御的、構造的に到達不能)は、個々の候補ではなく呼び出し全体をfail closedする(`numeric_comparison_mode_unsupported`/`numeric_comparison_input_invariant_violation`)。`point_in_region`でactualが真の点でない場合は個別候補を`not_analyzed`(`point_in_region_actual_not_point`)へ送る。
>
> 3つのcomparison modeはcondition値の組み合わせだけで決まり単位dimensionに依存しないため、B-2.4a/bと異なりpower/kW(identity変換)経由の公開パイプラインend-to-endで3モードすべてを再現できる。新規テストファイル(`numeric_comparison_rules_prototype.js`、17件の直接テスト、`quantity_numeric_comparison_result_verification.js`、36件のend-to-endテスト)を追加した。4件の防御(`isGenuinePoint`検査・kind検査・mode検証・invariant検証)をそれぞれ個別に無効化し、対応するテストが失敗する(またはmode検証・invariant検証は実際にfail closedすることを直接確認)ことを確認した上で復元した。乖離検出は二段階(quantity_extraction_prototype.js→numeric_comparison_rules_prototype.js、numeric_comparison_rules_prototype.js→core)で行う。
>
> **訂正（`d86cdba`レビュー、2026-07-22、重大2件・中1件）**：(1)`signed_boundary_deltas`は各境界値が個別に有限であることしか保証しておらず、大きさの異なる区間同士の減算結果(`1e308 - (-1e308) === Infinity`)まで有限とは限らなかった。修正: delta計算後に`Number.isFinite()`を確認し、非有限なら`null`へ置き換えず(`null`は「境界が存在しない」という別の意味を持つため)候補ごと`not_analyzed`(理由コード`numeric_comparison_delta_non_finite`、`lower_delta_non_finite`/`upper_delta_non_finite`を伴う)へ送るよう変更した。(2)invariant検査が`kind!=='interval'`を無条件でスキップしており、`'alternatives'`だけでなく未知・欠落したkindも同じ経路で静かに見逃していた(bindSide()のSchema検証により通常到達不能だが、将来のコード変更に対する防御として機能していなかった)。修正: 手書きの境界検査をやめ、既存の完全な構造検査`validateQuantityValueStructure()`(`'interval'`/`'alternatives'`/それ以外を判別可能に検証)を再利用し、以降の段階3の判定も`kind!=='interval'`から`kind==='alternatives'`への明示判定へ狭めた。(3)`comparePointInRegion()`/`compareIntervalCoverage()`がnull/非オブジェクト入力で`TypeError`を投げていた(3プリミティブは対象外)。修正: `isPlainObject()`ガードを追加し`{outcome:'unsupported', reason_code:'geometric_comparison_input_invalid'}`を返すようにした。直接テストを21件・end-to-endテストを39件へ拡張し、3件の防御をそれぞれ個別に無効化してテスト失敗または誤ったfail closed見逃しを確認した上で復元した。
>
> **B-2.6a設計・実装（`40ff0fc`承認後、2026-07-22）**：3.4節 段階4の最後の部分として、B-2.5が算出済みの`geometric_relation_holds`を一切変更せず、その候補を自動判定へ使ってよいか(`auto_applicable`)だけを決定する`generateAutoApplicabilityResults({binding, relations, ...})`を実装した。`comparison_mode_confidence`・requirement/actual側condition margin・opposing evidence・property confidenceの5基準は、B-2.2b(`resolvePropertyStatus()`)・B-2.3a(`resolveConditionStatus()`)・B-2.3b(`generateComparisonModeCandidates()`)が既にresolved判定のゲートとして適用済みであり、`numeric_comparison_results`へ到達した候補はこの5基準を構造的に満たしている(レビュー指摘。原型`evaluateAutoApplicable()`の6基準のうち5基準が前段へ移動済みという認識)。そのためこの5基準は通常の判定条件ではなく上流契約のinvariantとして再検証し、違反時は個々の候補を`auto_applicable:false`にするのではなく理由コード`auto_applicability_upstream_gate_invariant_violation`(`failed_invariants`配列を伴う)で呼び出し全体をfail closedする。値域(confidence/marginは[0,1])・派生式一致(`comparison_mode_confidence === Math.min(...)`)・property resolutionの`concept_id`整合もこのinvariant検査に含める。requirement/actual側の`ruleset_version`(`auto_applicable_thresholds`含む)が完全一致しない場合も`auto_applicability_ruleset_inconsistent`でfail closedする(現在`SUPPORTED_RULESETS`は1タプルのみだが、将来複数タプルが追加された際に異なるタプル同士が片側の閾値だけで判定される事故を防ぐ防御)。正常経路で`auto_applicable`をfalseにし得る実効条件は、どの段階も未検査だった`analysis.quantity.extraction.warnings`件数だけである。`warnings`が配列でない場合は「警告0件」と解釈せず`auto_applicability_extraction_input_invariant_violation`でfail closedする。新しい閾値は導入せず既存の`auto_applicable_thresholds`をそのまま再利用する。出力は新しい`auto_applicability_results`配列(各要素は`numeric_comparison_results`の要素に`auto_applicability:{auto_applicable, basis:{...}}`を付加したもの)と、閾値を1回だけ保持する`auto_applicability_policy`を持ち、`satisfied`等の最終判定フィールドは一切出力しない(B-2.6bへ委譲)。新規テストファイル`quantity_auto_applicability_result_verification.js`(27件)を追加し、実際に到達可能な数件(ruleset不一致・`warnings`非配列/欠落、後述のtop_confidence型検査を含む)は恒久テストとして検証し、他の基準由来のinvariant違反(値域外・派生式不一致・opposing evidence非boolean・property resolution欠落/concept不一致を含む)はbindInputPair()のschema検証とresolvedゲートにより実パイプラインでは構造的に到達不能なため、バグ注入(値を直接書き換えて検出を確認し、検査を無効化すると素通りすることも確認した上で復元)でのみ検証した。
>
> **訂正（`724e27f`レビュー、2026-07-22、重大1件・中1件）**：(1)`comparison_mode_confidence`の派生式一致検査は、`entry.comparison_mode_confidence`自体の値域だけを検査し、`requirement_condition_top_confidence`/`actual_condition_top_confidence`という2つの入力自体は個別に検証していなかった。`Math.min()`は文字列を暗黙的に数値変換するため(`Math.min('0.9','0.9') === 0.9`)、両側が文字列`"0.9"`でも`comparison_mode_confidence`(数値0.9)と一致してしまい検査をすり抜ける。この経路は、`interval_semantics_candidates[0].confidence`をschema検証を経由しつつ直接差し替えた`ready:true`のbindingで実際に下流へ到達できることを確認した(`resolveConditionStatus()`は下限(`>=`)しか検査しないため、文字列・上限超過・`Infinity`は`resolved`まで通過する。`NaN`・負値は下限判定自体が偽になり通過しない)。修正: 派生式を計算する前に、`requirement_condition_top_confidence`/`actual_condition_top_confidence`をそれぞれ`requirement_condition_top_confidence_not_finite_number`/`_out_of_range`(actual側も同様)として個別に検証するようにした。文字列・`Infinity`・値域外(1超過)は恒久テストとして追加し(hand-patchedしたbindingで実際に到達させて確認)、`NaN`・負値は上流で構造的に到達不能なためバグ注入でのみ確認した。(2)実fixtureテストが空配列に対しても`.every()`で真になり、0件の検証を1件以上の検証であるかのように見せていた。修正: 実キャプチャ済みfixture(PDF/Excelサンプル)はdimension不一致等により0件になるという既知の制約を明記した上で、`not_analyzed`の内訳(22件、reason_code別件数)を固定するテストへ置き換え、別途`pairBinding()`経由の実パイプラインで非空(`length > 0`)であることと具体的なbasis値(検査2で既に確認済み)を明示的に参照するテストを追加した。
>
> **訂正（`2f08b98`レビュー、2026-07-22、重大1件）**：ruleset一致検査(`sameRuleset()`)は両側の値を`===`で突き合わせるだけで型・値域を検証しないため、両側を同じ不正値(文字列閾値・負の閾値・未知ruleset version)へ揃えると一致検査を通過し、後続の閾値比較(`<`/`>=`)が暗黙の数値変換で成立してしまう(condition top confidenceで修正した文字列問題と同種の欠陥)。修正: 一致検査の前に、`validateRulesetCompatibility()`でrequirement/actual側それぞれを`SUPPORTED_RULESETS`との完全一致として個別検証し(理由コード`auto_applicability_ruleset_unsupported`)、両側とも対応済みの場合のみ`sameRuleset()`で一致を確認する。`SUPPORTED_RULESETS`が現在1タプルのみのため、両側が個別に対応済みなら必然的に一致するので、`auto_applicability_ruleset_inconsistent`自体は通常到達不能になった(将来複数タプル追加時の防御として維持、バグ注入でのみ検証)。両側とも同じ文字列/負値/未知versionのテストを追加し(32件)、検証を無効化すると全て素通りすることも確認した上で復元した。
>
> **B-2.6b設計・実装（`c393691`承認後、2026-07-22）**：3.4節 段階4の最後の部分として、B-2.6aが分析した各候補(`auto_applicability_results`)を`'satisfied'`/`'not_satisfied'`/`'needs_confirmation'`の3状態へ排他的に分類する`generateAutomaticJudgementResults({binding, relations, ...})`を実装した。判定式は`!auto_applicable → needs_confirmation(satisfied:null)`／`auto_applicable && holds → satisfied(true)`／`auto_applicable && !holds → not_satisfied(false)`のみで、新たな判定ロジックは追加しない。`not_analyzed`は候補単位とは限らない別の監査ストリーム(`dimension_mismatch`等はバケット単位に圧縮され`excluded_pair_count`で複数候補を表す)であるため、「表示されうる候補は4状態のうち1つ」という当初案の契約は採用せず、B-2.6aが分析した候補だけを3状態へ分類し、`not_analyzed`はB-2.5/B-2.6aから一切変更せず引き継ぐ(レビュー指摘)。この判定は人間による確定ではなくパイプラインによる自動判定であることを明示するため、出力配列名を`automatic_judgement_results`とし、各要素の`automatic_judgement`に`judgement_source:'automatic_pipeline'`・`human_confirmed:false`を持たせる(将来人間確認機能を追加する場合も、この自動判定結果を書き換えず別フィールド/別段階で追加できる構造にする、レビュー指摘)。`auto_applicable`/`geometric_relation_holds`が構造上期待されるboolean値でない場合(同一binding/relationsを同期的に再計算するだけの構造上、通常到達不能)は、`final_judgement_input_invariant_violation`(`failed_invariants`配列を伴う)で呼び出し全体をfail closedする。新規テストファイル`quantity_automatic_judgement_result_verification.js`(21件)を追加し、3状態それぞれの生成・混在時の排他分類・`state`/`satisfied`の対応不変条件・`not_analyzed`の完全一致(圧縮された`excluded_pair_count`を含む)・実fixtureの既知内訳を恒久テストで検証した。invariant違反は実パイプラインでは構造的に到達不能なため、バグ注入(検出確認後に検査無効化で素通りも確認、その後復元)でのみ検証した。
>
> **B-3a/B-3b設計・実装（`c393691`承認後、2026-07-22。B-3aはレビュー3巡）**：`trace_comparison_schema_v1.md`の旧設計(`automation`/`comparison`(null許容)/`lowGap`/`highGap`/単一`review.confirmed`系)はB-2.5/B-2.6の確定契約(`numeric_comparison`常時保持・`auto_applicability`・`automatic_judgement`・`needs_confirmation`)と非互換のため、新schemaは`trace-comparison/1.0-rc2`と改称した(旧rc1 fixtureは別資産として維持)。`generateTraceComparisonRecordSet({binding, relations, generatedAt, generator, displayContext, ...})`を実装し、B-2.6bを内部で再計算した上で1要求数量×1実仕様数量の正式レコードへ写像する(幾何比較・auto applicability・自動判定の再計算はしない)。要点: (1) `mapping`はrequirement/actual両側の`generatePropertyResolutions()`候補全件・`top_confidence`(`candidates[0].confidence`)・`margin`(既存privateの`marginOf()`をそのまま呼ぶ、複製しない)を保持し、単一`concept_id`への縮約で候補・根拠を失わない。(2) B-2.3の区間意味(`acceptable_region`等)は物理的運転条件の同等性とは別概念のため`condition_semantics`/`condition_equivalence`を使わず`comparison_input.interval_semantics_resolution`/`review.interval_semantics`と命名する。(3) `review.satisfaction`の初期状態は`automatic_judgement.state`に関わらず全件`'not_eligible'`固定(`needs_confirmation`も`'not_applicable'`にしない。前提4項目が人間確認されるまで充足確認自体を無効化する旧schemaの依存関係を維持)。(4) `comparison_id`は`trace_id`/`matcher_id`が任意の外部文字列で区切り文字衝突を排除できないため、UTF-8バイト長netstring(`{len}:{value},`)方式(`cmp-v1:...`)で衝突不能に構成する(`quantity_pair_id`は`quantity_id`が固定16進形式のため単純`::`連結のまま)。(5) 戻り値を`{ready, result_complete, diagnostics, record_set}`のruntime envelopeと、`record_set`(成功時のみ非null、`trace-comparison/1.0-rc2`完成artifact)に分離し、成功時diagnosticsは両方へ伝播する。最終結果は`snapshotValue()`(`structuredClone()`+再帰freeze)で包み、入力(`binding`/`relations`)への参照を残さない。(6) `relationship`は既存`relationRefs()`と対になる新設`relationshipRefs(row)`で同一行から原子的に取得し、`source`(`'matching_engine'`|`'manual'`)を必須化、`matching_engine`側は`match_method`/`match_confidence`/`review_category`も検証する。relation_keyの重複は内容が同一なら`trace_comparison_relationship_duplicate`、異なれば`trace_comparison_relationship_conflict`(1keyにつきどちらか一方のみ)。(7) `bindSide()`の成功結果へ`source_trace_file`を加算的に保持する変更をB-1へ追加した(Phase B-1の既存判定は変更せず、schema検証済みの値をそのまま下流へ渡すだけ)。analysis/property resolution索引はいずれも後勝ち上書きを禁止し重複時fail closedする(`trace_comparison_analysis_context_duplicate`/`trace_comparison_mapping_resolution_duplicate`)。新規テストファイル`quantity_trace_comparison_record_set_verification.js`(91件)を追加し、UTF-8絵文字trace_idでのID非衝突・netstring復元・display_context非依存・安定ソート順・frozen契約・relation重複/競合の排他性等を恒久テストで検証し、`automatic_judgement`の構造不整合(実パイプラインでは到達不能)はバグ注入(検出確認→検査無効化で素通り確認→復元)で検証した。B-3c(JSON Schema作成)・B-3d(ブラウザUI統合)・B-4(レビュー状態遷移)・B-5(永続化)は未着手。
>
> **訂正（`6962c54`レビュー、2026-07-22、重大3件）**：(1) `analysisContextByQuantityId()`はrecord単位`content_hash`を64桁SHA-256形式として検証していたが、正式レコードの`requirement_analysis`/`actual_analysis`には転記しておらず、完成artifactからはどのcontent_hashに基づくanalysisか追跡できなかった。修正: `{...analysis, content_hash}`として明示的に付加する。(2) `relationshipRefs()`が`match_confidence`をnumber型でなければ無条件に`null`へ変換しており、不正入力(文字列等)がエラーにならず黙示的に補正されていた。`match_method`/`review_category`/`linked_at`の型・`matching_engine`以外(`manual`)の値域も未検証だった。修正: 型変換をやめてnull/undefinedだけをnullへそろえ、新設`validateRelationshipMetadata()`で両source共通(null許容の型・値域)+`matching_engine`必須項目を検証する(新理由コード`trace_comparison_relationship_metadata_invalid`)。(3) `relationContextByKey()`が4参照IDの不正なrelation行を診断なしで読み飛ばしており、対応する`automatic_judgement_results`候補が1件も無い場合(dimension_mismatch等でnot_analyzedへ回った場合)、不正なrelation行が検出されずready:trueで通過していた。修正: 索引構築時点ですべてのrelation行を検証し、不正なら`trace_comparison_input_invariant_violation`(`failed_invariants:['relation_reference_id_invalid']`)で全体fail closedする(候補の有無に関わらない)。この検証がrelationContextByKey()に一本化されたことで、候補ループ内の重複していたrelationship検証コードは削除した。直接テストを75件から91件へ拡張し、3件の防御をそれぞれ個別に無効化して失敗を確認した上で復元した。
>
> **B-3c設計・実装（B-3b `2f7b808`承認後、2026-07-22。B-3cはレビュー3巡）**：着手条件としてB-3bへ2件の必須先行修正を求められ、同一コミットで実施した。(1) `comparisons`の安定ソートが6フィールドをNUL文字(U+0000)で単純連結した1本のキー文字列を比較しており、`trace_id`/`matcher_id`は任意の外部文字列で区切り文字混入を排除できないため、異なる6要素タプルが同じ連結文字列に衝突しうる欠陥があった(安定ソートでは衝突時に元の`relations`入力順が残るため「入力順非依存」契約が崩れる)。修正: 区切り文字を使わずフィールドを1つずつ比較する`compareText()`/`compareComparisonRecords()`を新設し、後者を公開APIへ追加してB-3cのsemantic validatorが同じ比較契約を再利用できるようにした。バグ注入(NUL区切りでは新設テスト`18b`と衝突しないため、実際に衝突するspace区切りへ差し替えて検証)で欠陥検出→復元を確認した。(2) `generator`/`displayContext`の受理条件が緩く(`typeof==='object'`のみ)、配列も通過し余分なキーも拒否しなかったため、追加予定のrc2 Schema(`additionalProperties:false`)より緩い形をB-3bが誤って正当なものとして受理しうる不整合があった。修正: `Array.isArray()`除外とキー完全一致検査を追加。両修正とも恒久テストを追加しバグ注入で検証済み。続けてB-3c本体として次を実装した。要点: (1) `trace_comparison_schema_v2.json`は`record_set`のみを対象にし(runtime envelopeは対象外)、`$defs.analysis`(content_hash追加)/`quantityRecord`/`intervalBound`/`evidenceItem`/`ruleset_version`を`quantity_annotation_schema_v1.json`から複製した(cross-file `$ref`は`json_schema_minivalidator.js`が同一ドキュメント内`#/...`しか解決できないため不採用。乖離は`trace_comparison_schema_drift_check.js`が構造的に検査する)。(2) `json_schema_minivalidator.js`は`required`/`properties`/`additionalProperties`を値が実際にJSオブジェクトのときしか検査しないため、すべての閉じたオブジェクト$defへ明示的に`"type":"object"`を付けた(`diagnostics`/`not_analyzed`の要素だけは16種超の理由コード形状差異に対応するため意図的に`required`のみで`additionalProperties`を閉じていない)。(3) `automatic_judgement`(state/satisfied/judgement_source/human_confirmedの3状態排他的`oneOf`、各分岐`const`+`additionalProperties:false`)・`unit_conversion_plan`(identity/linear_scaleの2分岐`oneOf`、producerの実出力形と一致)・`relationship`(sourceで判別する2分岐`oneOf`)・`review`(B-3生成時点の初期状態のみを`const`で固定。B-4以降の状態拡張はrc3等の新schema versionで行い、rc2を暗黙に広げない)は、レビューが提示したSchema片をそのまま採用した。(4) `comparison_input`の3つのquantity value(`requirement_quantity_value`等)はinterval|alternativesの共用体ではなく`intervalOnlyQuantityValue`(interval限定)にした(B-2.5が`alternatives`を常にnot_analyzedへ送るため、`comparisons[]`へ到達する値は構造的にinterval形のみ)。(5) `trace_comparison_record_set_validator.js`の`validateTraceComparisonRecordSet(recordSet)`は例外を投げない総関数で、`{valid, schema_errors, semantic_errors}`を返す。段階1(Schema構造検証)が失敗した場合、段階2(semantic検証)は実行しない。semantic検証は、Schemaでは表現できない複数フィールド・複数オブジェクトをまたぐ相関(`auto_applicable`×`geometric_relation_holds`→`state`/`satisfied`、`comparison_mode`×`relation_type`×`outer_side`/`inner_side`)、`auto_applicability.basis`の導出式(`extraction_warnings_count`合算・`Math.min()`系confidence・`*_meets_threshold`閾値比較)、`mapping`の`candidates`非空・confidence降順・`marginOf()`契約との一致(`marginOf()`自体は非公開のため別実装せず、数式契約(候補1件→自身のconfidence、2件以上→1位-2位差)を直接検証する)、`comparison_id`のUTF-8バイト長netstring往復復号(非10進・符号付き・空・先頭ゼロの長さ、バイト長超過、区切り文字欠落、要素数不一致、余剰バイト、不正UTF-8をすべて個別に拒否)、`comparison_id`/`quantity_pair_id`の文書内一意性、`comparisons`の安定順序(`compareComparisonRecords()`を再利用、別実装を複製しない)、`generated_at`/`linked_at`の実在暦日時往復一致、そしてJSON再パース由来でもメモリ上のオブジェクトでも同じく効く`Number.isFinite()`の全数値再帰走査(Schemaの`type:'number'`検査はNaN/Infinityを素通りさせるため)を検査する。(6) `trace_comparison_schema_check.js`(手作りfixtureによるSchema構造単体テスト、31件)・`trace_comparison_schema_drift_check.js`(rc1↔rc2 `$defs`構造同一性+`json_schema_minivalidator.js`対応キーワード許可リスト検査、10件)・`trace_comparison_record_set_validator_verification.js`(実generator出力での二層検証・semantic各項目の個別破壊テスト・netstring復号の全不正形式・実在暦日時検査、41件)を新設した。Schema層(automatic_judgementのoneOf相関、generatorのadditionalProperties)とsemantic層(安定順序検査、非有限数検査、auto_applicable相関検査)双方の主要な防御について、無効化→テスト失敗確認→復元のバグ注入サイクルを実施した。B-3d(ブラウザUI統合)・B-4(レビュー状態遷移)・B-5(永続化)は未着手。

> **訂正（`734d6f4`レビュー、2026-07-22、重大3件・中1件）**：(1) `auto_applicability.basis`はbasis内部の計算(合計・閾値比較)だけを検証しており、その計算の入力そのものが生analysis(`requirement_analysis`/`actual_analysis.quantity.extraction.warnings`)と一致するかを検証していなかった。また、`comparisons[]`へ到達した候補はB-2.6a上流ゲート(5基準)を通過済みのはずという不変条件(`*_meets_threshold`は常にtrue)を検証していなかった。修正: `warnings.length`直接比較と、comparisons[]到達済み候補では常にtrueなはずの`*_meets_threshold`/`opposing_evidence_absent`不変条件検査を追加した。(2) `checkAllNumbersFinite()`が循環検出なしで再帰しており、自己参照するdiagnostic(`d.self=d`)を含むartifactがRangeError(スタックオーバーフロー)を投げ、「例外を投げない総関数」契約に違反していた。`decodeUtf8NetstringElements()`も`String.fromCharCode(...bytes.slice(...))`のスプレッド引数展開で極端に長い数字列に対し例外を投げ得た。修正: WeakSet相当の祖先集合による循環検出・深さ/ノード数上限(`MAX_WALK_DEPTH`=64、`MAX_WALK_NODES`=200000)・netstring長さの桁数上限(`MAX_NETSTRING_LENGTH_DIGITS`=15)・文字ループでのスプレッド回避を追加し、公開入口`validateTraceComparisonRecordSet()`全体をtry/catchで保護した(多層防御)。(3) `requirement_analysis.quantity_id`がref側と一致するかの結合整合性、`comparison_input`の数量値が対応するanalysisの生値と一致するか、`geometric_relation_holds`が`lower_check`/`upper_check.holds`の論理結果と一致するかを検証していなかった。修正: `quantity_id`一致検査・`canonicalJson()`による数量値構造的一致検査・`geometric_relation_holds`相関検査を追加した。(4)(中) `comparison_id`のSchema patternが`"^cmp-v1:.+$"`だったが、JS正規表現の`.`は改行(U+000A/U+000D/U+2028/U+2029)に一致しないため、`trace_id`/`matcher_id`に改行を含む正当なB-3b生成物が誤って拒否されうる欠陥があった。修正: patternを`"^cmp-v1:"`(prefix検査のみ、詳細検証はnetstring復号を担うsemantic層に委譲)へ変更した。テストを41件から53件へ拡張し、4件の防御をそれぞれ個別に無効化してテスト失敗を確認した上で復元した。
>
> **訂正（`734d6f4`レビュー再指摘、2026-07-22、重大3件）**：前回修正はコード上ほぼ反映されたが、正式artifact validatorとして「`valid:true`にしてはいけないJavaScriptオブジェクトを受理する」という、より根本的な欠陥3件が残っていた。(1) `json_schema_minivalidator.js`の`required`/`properties`検査が`key in value`(プロトタイプ継承チェーンも辿る)を使っており、`Object.create(validRecordSet)`のようなown propertyを持たずプロトタイプ経由でのみ必須フィールドを「持つ」オブジェクトが`valid:true`になり得た。`Object.keys()`ベースの`additionalProperties`検査はown enumerable propertyしか見ないため素通りし、`JSON.stringify(inheritedOnly)`は`"{}"`になるという、検証合格したオブジェクトと実際に保存されるJSONの内容が一致しない致命的な乖離があった。修正: `required`/`properties`検査を`Object.prototype.hasOwnProperty.call()`ベースへ変更した(共有validatorのため`quantity-annotation`側含む全回帰を実施)。(2) 深さ・ノード数の上限自体は前回追加したが、Schema検証→semantic検証の**後**にしか効いておらず、巨大な`diagnostics`/`comparisons`配列がSchema層のO(N)走査を素通りしてから初めてinvalidになっていた(上限が判定結果を変えるだけで、計算量そのものを制限できていなかった)。修正: `preflightJsonGraph()`を新設し、Schema検証より**前**に実行するよう実行順を`preflight→Schema→semantic`へ変更した。preflightは「null/boolean/string/有限number/array/プロトタイプがObject.prototypeまたはnullのobject」だけを許可し、Date/Map/Set/RegExp/typed array/custom class instance・symbolキー・accessorプロパティ(getter/setter)・非enumerableプロパティ・循環・JSON非互換primitiveをすべて拒否する。明示的な配列長上限`MAX_ARRAY_ITEMS`(20000)も追加した。(3)(中) `actual_ref.source_row`はproducer(`relationshipRefs()`)が`Number.isSafeInteger(context.source_row) && context.source_row > 0`を要求するのに対し、Schemaは`type:"integer",minimum:1`のみで、mini-validatorの`typeOf()`は`Number.isInteger()`ベースのため`1e20`のような安全整数範囲外の値も`'integer'`型として通過し得た。修正: semantic層に`Number.isSafeInteger() && > 0`検査を独立に追加した。テストを53件から72件へ拡張し(`Object.create(validRecordSet)`・ネストしたref・Date/Map/Set/RegExp/typed array混入・非enumerable/accessor/symbolキー・`MAX_ARRAY_ITEMS`超過配列・`source_row`の`MAX_SAFE_INTEGER+1`/`1e20`を含む)、3件の防御を個別に無効化(mini-validator単独・preflight単独・両方同時無効化の3パターン)してテスト失敗を確認した上で復元した。両方同時に無効化した場合、実際に`Object.create(validRecordSet)`が`{"valid":true,"schema_errors":[],"semantic_errors":[]}`を返すことを確認しており、指摘された欠陥が実在することを独立に再現した。Playwright依存の`quantity_annotation_{pdf,excel,excel_xlsx}_verification.js`は、own property修正がJSON.parse()由来のプレーンオブジェクト(プロトタイプ継承や非own propertyを持たない)に対して`key in value`と`hasOwnProperty()`が同じ結果を返すことを確認した上で、挙動に影響しないため今回は再実行していない(ブラウザ生成物はすべてJSON.parse()経由のため、プロトタイプチェーンに依存する経路は存在しない)。

理由コード：`no_annotation`（3.2節、quantity-annotation側に該当`trace_id`が見つからない）／`source_mismatch`／`stale_annotation`（3.3節）／`dimension_mismatch`（段階1）／`property_unresolved`（段階2、B-2.2b追加。該当数量自体のconcept解決が`resolved`に至っていない）／`concept_mismatch`（段階2、B-2.2b追加。`resolved`同士だが対応するconceptが相手側にない）／`condition_mismatch`（段階3、当初「comparisonMode導出の実装時に導入予定」としていたが、B-2.3b実装時に`condition_unresolved`／`condition_opposing_evidence`／`comparison_mode_unavailable`(いずれも下記)へ置き換わり、実際には使用していない。上記の訂正を参照）／`no_comparison_mode`（段階4、未実装）／`candidate_limit_exceeded`（段階2以降共通、`(bucket, concept_id)`単位の候補上限超過で実際に切り詰めが起きた場合。severity:warning、B-2.2bで実装済み）／`candidate_limit_would_exceed`（段階2、B-2.2b round3修正で追加。全体上限超過によりPass 2自体を実行しなかった経路で、走査済みグループのうち`potentialPairCount > candidateLimit`だったもの。`materialized_pair_count:0`を明示し、実際に切り詰めた`candidate_limit_exceeded`とは区別する）／`total_candidate_limit_exceeded`（段階2、B-2.2b round1修正で追加、round2・round3・round4で判定材料を訂正。`limit_kinds`(`"materialized"`＝実体化見込み件数の合計が`totalCandidateLimit`超過／`"potential"`＝潜在ペア数の合計が`totalPotentialPairLimit`超過。round4で単数`limit_kind`から複数形へ改称し、同時超過時は両方を記録する)のいずれかでcomparison_candidates全体をfail closedする。`observed_potential_pair_count_at_stop`/`observed_materialized_upper_bound_at_stop`(round4で`total_*`から改称。バケット走査を打ち切った時点までの部分集計であることをフィールド名で明示)・`processed_bucket_count`/`total_bucket_count`/`unscanned_bucket_count`(round4追加)を伴う。severity:error）／`comparison_candidates_not_ready_or_incomplete`（段階3、B-2.3a追加。段階2の結果が`ready!==true`または`result_complete!==true`の場合にfail closedする。severity:error）／`condition_resolutions_not_ready`（段階3、B-2.3a追加。段階3-1(`generateConditionResolutions()`)が`ready:false`の場合にfail closedする。severity:error）／`condition_resolution_missing`（段階3、B-2.3a追加、防御的。比較候補のquantity_idに対応する条件解決結果が構造上見つからない場合にfail closedする。severity:error）／`condition_candidate_limit_exceeded`（段階3-1、`f77dfca`レビュー修正で追加。1数量あたりのinterval_semantics_candidates件数が`MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY`(64)を超えた場合、side・trace_id・quantity_id・observed_count・limitを伴って呼び出し全体をfail closedする。severity:error）／`condition_candidate_duplicate_value`（段階3-1、`f77dfca`レビュー修正で追加。同一数量のinterval_semantics_candidates内でvalueが重複した場合、side・trace_id・quantity_id・valueを伴って呼び出し全体をfail closedする。severity:error）／`condition_unresolved`（段階3-3、B-2.3b追加。比較候補の両側condition statusのうち少なくとも一方が`resolved`でない(`ambiguous`/`unavailable`)場合、両側のcondition status/valueを保持してcomparison mode候補を生成しない）／`condition_opposing_evidence`（段階3-3、B-2.3b追加。両側`resolved`でも、どちらかに否定根拠(`has_opposing_evidence:true`)がある場合、自動導出せず保留する）／`comparison_mode_unavailable`（段階3-3、B-2.3b追加。両側`resolved`かつ否定根拠なしでも、`COMPARISON_MODE_DERIVATION_TABLE`に`(requirement_condition_value, actual_condition_value)`の組み合わせが存在しない場合、推測でmodeを生成しない。`required_capability_domain × achieved_point`もこの経路に含まれる）／`unit_metadata_unsupported`（段階4、B-2.4a追加、`34c7e9a`レビュー修正で判定条件を訂正。unit.canonical/unit.dimensionが空・`unit`オブジェクト自体が無い・`dimension:'unknown'`の場合に加え、`KNOWN_CANONICAL_UNITS_BY_DIMENSION`に実在しない(dimension, canonical)の組(未登録canonical、または既知canonicalが誤ったdimensionと組み合わされている場合を含む)も対象。推測で変換計画を生成しない）／`unit_conversion_unsupported`（段階4、B-2.4a追加。両側とも`KNOWN_CANONICAL_UNITS_BY_DIMENSION`に実在する既知単位で、dimensionも一致するがcanonicalが異なり、`LINEAR_UNIT_SCALE_TO_BASE`に対応する固定変換規則が無い場合、推測で係数を生成しない。現在の登録単位ではpressureの3種すべてに変換規則があるため、この経路は将来新しいdimensionへ複数canonicalが追加され変換規則の追加を忘れた場合にのみ到達する）／`unit_conversion_invalid_factor`（段階4、`db770de`レビュー修正で追加、防御的。`hasOwn()`によるown property検証を経た後の`factor`計算結果が有限数でない場合にnot_analyzedへ送る。現在の登録データでは`hasOwn()`検証を通過した時点で`factor`は常に正の有限数になるため、構造的に到達不能な最終防御である）／`unit_plan_quantity_missing`（段階4、B-2.4a追加、防御的。comparison mode候補のquantity_idに対応するanalysisがbinding内に見つからない場合にfail closedする。severity:error）／`unit_dimension_inconsistent`（段階4、B-2.4a追加、防御的。comparison mode候補の両側でunit.dimensionが一致しない場合、上流結果とquantity実体の矛盾とみなしfail closedする。severity:error）／`unit_conversion_plans_not_ready_or_incomplete`（段階4後半、B-2.4b追加。段階4前半(`generateUnitConversionPlans()`)の結果が`ready!==true`または`result_complete!==true`の場合にfail closedする。severity:error）／`normalized_view_quantity_missing`（段階4後半、B-2.4b追加、防御的。単位変換計画のquantity_idに対応するanalysisがbinding内に見つからない場合にfail closedする。`unit_plan_quantity_missing`と同じ「同一bindingを同期的に2回読むだけ」という構造上、通常到達不能。severity:error）／`quantity_value_kind_unsupported`（段階4後半、B-2.4b追加、防御的。数量値の`kind`が`'interval'`/`'alternatives'`のいずれでもなく`applyLinearConversion()`が変換できなかった場合にnot_analyzedへ送る。quantity-annotationのJSON Schemaがkindをこの2値のみに制限し、bindSide()がスキーマ検証失敗時に文書全体をbindしないfail closed契約のため、通常到達不能）／`quantity_value_invalid`（段階4後半、`1fbfe90`レビュー修正で追加。数量値(interval境界の`value`またはalternativesの各option)が非数値または非有限数(NaN/Infinity含む)の場合にnot_analyzedへ送る。`side`フィールドでrequirement/actualどちらの数量値かを明示する）／`quantity_conversion_non_finite`（段階4後半、`1fbfe90`レビュー修正で追加。入力は有限だが`value*factor+offset`の演算結果がオーバーフローしてInfinityになった場合にnot_analyzedへ送る）／`quantity_value_limit_exceeded`（段階4後半、`1fbfe90`レビュー修正で追加。alternatives.optionsの件数が`MAX_ALTERNATIVE_VALUES_PER_QUANTITY`(64)を超えた場合にnot_analyzedへ送る。`observed_count`/`limit`を伴う。件数検査は複製・全件走査より前に行う）／`quantity_conversion_plan_invalid`（段階4後半、`1fbfe90`レビュー修正で追加、防御的。`applyLinearConversion()`に渡された`plan.factor`/`plan.offset`が非有限数、または`factor`が0以下の場合にnot_analyzedへ送る。coreの正常経路では`classifyUnitConversion()`が常に有限・正のfactorしか返さないため通常到達不能だが、独立してexportされる純粋関数であるため防御的に保持する）／`quantity_value_empty`（段階4後半、`c00cc3a`レビュー修正で追加。0要素の`alternatives.options`、またはlower/upper両方がnullの`interval`のように、後続の数値比較に使える値を1つも持たない数量値をnot_analyzedへ送る。件数検査(alternatives)・null検査(interval)とも要素走査より前に行う）／`quantity_conversion_precision_loss`（段階4後半、`185afb1`レビュー修正で追加、`3eecd40`レビュー修正で拡張。変換前は非空(lower<upper)だった区間が、極端なfactor/offsetによる浮動小数点の丸めで変換後に同値・逆転へ潰れた場合(inclusiveの組み合わせを問わず、幅を保っていたかを別途記録して判定)、または`alternatives`で元は異なっていた値が変換後に同じ値へ潰れた場合(元から同値だった重複自体は許容)にnot_analyzedへ送る。真の点区間・元から重複したalternativesは誤って拒否されない）／`quantity_comparison_kind_unsupported`（段階4後半、B-2.5追加。`requirement_quantity_value`/`actual_quantity_value_normalized`のいずれかが`kind:'alternatives'`の場合にnot_analyzedへ送る。`requirement_quantity_kind`/`actual_quantity_kind`を伴う。選択意味論が未設計のため比較しない）／`point_in_region_actual_not_point`（段階4後半、B-2.5追加。`comparison_mode_candidate`が`point_in_region`だがactual側が真の点(`isGenuinePoint()`)でない場合にnot_analyzedへ送る）／`numeric_comparison_mode_unsupported`（段階4後半、B-2.5追加、防御的。`comparison_mode_candidate`が既知の3値(point_in_region/actual_covers_requirement/requirement_covers_actual)以外の場合にfail closedする。COMPARISON_MODE_DERIVATION_TABLEがこの3値しか生成しないため通常到達不能。severity:error）／`numeric_comparison_input_invariant_violation`（段階4後半、B-2.5追加、`d86cdba`レビュー修正で判定方法を訂正。正規化ビューのrequirement/actual数量値へ`validateQuantityValueStructure()`を適用し、outcome!=='ok'(kind不明・欠落を含む)ならfail closedする。同一bindingを同期的に再計算するだけの構造上、通常到達不能。severity:error）／`numeric_comparison_delta_non_finite`（段階4後半、B-2.5、`d86cdba`レビュー修正で追加。`signed_boundary_deltas`の各delta(`lower_actual_minus_requirement`/`upper_requirement_minus_actual`)が非null同士の減算で非有限になった場合にnot_analyzedへ送る。`lower_delta_non_finite`/`upper_delta_non_finite`を伴う）／`numeric_comparison_results_not_ready_or_incomplete`（段階4後半、B-2.6a追加。段階4後半前段(`generateNumericComparisonResults()`)の結果が`ready!==true`または`result_complete!==true`の場合にfail closedする。severity:error）／`auto_applicability_ruleset_unsupported`（段階4後半、B-2.6a追加、`2f08b98`レビュー修正で追加。requirement側またはactual側の`ruleset_version`が`SUPPORTED_RULESETS`の既知完全タプルと一致しない場合に呼び出し全体をfail closedする(`validateRulesetCompatibility()`を再利用。文字列閾値・負の閾値・未知versionを検出する)。severity:error）／`auto_applicability_ruleset_inconsistent`（段階4後半、B-2.6a追加、防御的。requirement側とactual側の`ruleset_version`(`auto_applicable_thresholds`含む)が完全一致しない場合に呼び出し全体をfail closedする。`auto_applicability_ruleset_unsupported`の検査を通過した時点で両側とも`SUPPORTED_RULESETS`の既知タプルであり、現在1タプルのみのため通常到達不能(将来複数タプルが追加された際の防御)。severity:error）／`auto_applicability_upstream_gate_invariant_violation`（段階4後半、B-2.6a追加、防御的。`comparison_mode_confidence`・requirement/actual側condition margin・opposing evidence・property confidenceは、B-2.2b/B-2.3a/B-2.3bのresolvedゲートにより`numeric_comparison_results`到達時点で構造的に基準充足済みのはずという上流契約のinvariantであり、値域[0,1]・派生式一致・property resolutionの`concept_id`整合も含めて検証する。違反した基準を`failed_invariants`配列(複数可)で明示し、呼び出し全体をfail closedする。通常到達不能。severity:error）／`auto_applicability_extraction_input_invariant_violation`（段階4後半、B-2.6a追加、防御的。候補のquantity_idに対応する`analysis`が見つからない、または`analysis.quantity.extraction.warnings`が配列でない場合にfail closedする(「警告0件」と解釈しない)。前者は同一bindingを同期的に再計算するだけの構造上通常到達不能だが、後者はどの上流段階も検査していない値であり、実際に到達しうる)／`automatic_judgement_source_not_ready_or_incomplete`（段階4後半、B-2.6b追加。段階4後半前段(`generateAutoApplicabilityResults()`)の結果が`ready!==true`または`result_complete!==true`の場合にfail closedする。severity:error）／`final_judgement_input_invariant_violation`（段階4後半、B-2.6b追加、防御的。各候補の`auto_applicability.auto_applicable`/`numeric_comparison.geometric_relation_holds`が構造上期待されるboolean値でない場合にfail closedする(`failed_invariants`配列を伴う)。同一binding/relationsを同期的に再計算するだけの構造上、通常到達不能。severity:error）。件数だけのサマリが必要な場合は、この個別リストから都度集計すればよく、個別リストと別に件数フィールドを二重に持たせない。

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
6.（**Phase B-1完了**）旧／非対応`ruleset_version`のquantity-annotationファイルを現行ルールで読み込むと`ruleset_mismatch`でファイル全体を停止すること。`quantity_extraction`・`semantics_rules`・3閾値を1つずつ変更し、全ケースで候補／充足判定0件になることを確認する
7.（**PDF側・Excel側完了**）`_trace_records`の再生成後（同一入力での再実行）も`quantity_id`/`content_hash`/`dataset_signature`が変化しないこと（2.0節の内容ベースID規則の安定性そのものの検証。両ツールで確認。`comparison_id`は比較エンジン未実装のため未検証）

**照合行・元レコード解決関連**：
8.（**Phase B-1完了**）`A_ID`/`B_ID`が`trace_id`と一致しないケース（3.2節、実データで既に確認済みの`B_ID != trace_id`）でも`requirement_trace_id`/`actual_trace_id`が正しく解決されること
9. A/B両側で`trace_id`が重複するケースで、3.2節の表のとおり`ambiguous_trace_id`として扱われ、`comparison`が生成されないこと
10.（**Phase B-1完了**）元レコードが欠落しているケース（`quantity-annotation`側に該当`trace_id`がない）で`not_analyzed`（理由: `no_annotation`）に記録され、側全体のエラーにならないこと
11. 同一A-Bペアが複数の照合行に現れるケース（重複マッチ）で3.2節の表のとおり処理されること
12.（**Phase B-2表示更新まで完了**）手動追加・削除・付け替え（`traceMatrixRows`が通常照合以外の経路で更新された場合）でも4参照IDを保持し、数量ステータス表示と診断APIが一致すること
13. トレースマトリクスの表示順変更やフィルタ後も、同じ元レコードへ解決すること

**取り違え・陳腐化関連**：
14.（**Phase B-1完了**）`quantity-annotation`の原文ハッシュ不一致が`stale_annotation`として検出され、通常の比較（`not_analyzed`の`no_annotation`）と混同されないこと

**候補生成・絞り込み関連**：
15.（**Phase B-2完了**）単位次元が不一致のペアが3.4節の段階1で除外され、`not_analyzed`（理由: `dimension_mismatch`）へ記録されること。ただし個別ペアではなく、次元バケット単位（`(要求trace_id, 実仕様trace_id, 要求dimension, 実仕様dimension)`ごとに1件、`requirement_quantity_ids`/`actual_quantity_ids`配列＋`excluded_pair_count`を保持）へ圧縮した形で記録される（3.4節の訂正参照。`quantity_dimension_candidate_verification.js`で確認）。
16. A未対応／B未参照のケースで、そもそも`trace-comparison/1.0-rc1`レコードが生成されないこと（`generateDimensionCandidates()`自体は、片側の`trace_id`が`null`の照合行を候補生成の対象外にすることまでは実装・確認済みだが、`trace-comparison/1.0-rc1`レコード自体の生成は未着手）
17.（**Phase B-2完了**）温度・能力・圧力等、複数次元の数量が同じ行に混在するケースで、無関係な次元同士がペアにならないこと（`quantity_dimension_candidate_verification.js`の「混在ケース」「複数バケット」テストで、一致する次元だけが候補になり、不一致の次元の組み合わせごとに別々の圧縮バケットになることを確認）
18. 標準値と対応後値の一対多比較（3.4節5番、未確定の規則）が要件として洗い出されていること
19.（**Phase B-2段階1・段階2完了**）数量が多いレコード同士でも同一次元・異次元のどちらも`N×M`件のオブジェクトへ展開しないこと。段階1は200×200同一次元を1候補バケット、潜在ペア数`candidate_count:40000`として保持する回帰を追加済み。段階2（B-2.2b）は、候補生成をPass 1（潜在ペア数の合計のみ、候補オブジェクトは生成しない）とPass 2（実際の候補生成）に分離し、実体化見込み件数の合計が`totalCandidateLimit`（既定2,000、検証上限10,000）または潜在ペア数の合計が`totalPotentialPairLimit`（既定200万、検証上限10億）のいずれかを超える場合はPass 2を実行せずfail closedする（`95af0db`レビューで、この2つの上限を分離しないと`candidateLimit=10,000`・多数グループのような設定で数百万件を正規に実体化できてしまうと指摘された）。上限超過が確定した時点でバケット走査そのものを即座に打ち切ることも、5バケットの合成データ（打ち切り確定後のバケット固有の監査記録が一切現れないこと）でタイミング計測に頼らず決定的に確認済み。Pass 2自体も、候補を`candidateLimit`件に切り詰める前に対象ID列全体を複製・ソートすることをやめた（stage 1が既にquantity_id昇順でソート済みのため不要だった。片側20,000件でも正しくcandidateLimit件ちょうどに切り詰められることを正確性の面から確認済み、`0957659`レビュー）。バケットの走査順序自体もrequirement_trace_id等の安定キーで並べ替え、relations引数の入力順に依存しない結果になることを、正順・逆順双方の回帰テストで確認済み。1バケット内で同一conceptに要求側10件・実仕様側10件（100ペア）が集中する合成データで`candidateLimit`（既定50、テストでは5を明示指定）超過分が個別ペアへ展開されず`candidate_limit_exceeded`1件（`excluded_pair_count`付き）に圧縮されること、多数の小さなグループ・多数の大きなグループそれぞれが対応する上限で正しく検知されること、両上限の同時超過で`limit_kinds`に両方記録されることを`quantity_comparison_candidate_verification.js`で確認済み（3.4節6番「最大候補数の打ち切りと診断情報への記録」への回答）。タイミング計測は非ブロッキングのログ出力にとどめている。per-group切り詰めが発生した場合は`result_complete:false`を返すことも同ファイルで確認済み

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

> **訂正・実装状態（Phase B-2.2a、`9c06125`→本改訂、2026-07-20）**：上記2状態（`resolved`／`ambiguous`）の設計は、比較エンジン側（`quantity_sidecar_binding_core.js`の`generatePropertyResolutions()`）へ実装するにあたり、`resolved`／`unavailable`／`ambiguous`の3状態へ訂正した。「候補が0件」（そもそも対応概念が見つからない）と「候補はあるが確信度・差が不十分」を区別する。また、`marginOf()`は候補1件のときその候補自身のconfidenceを返す実装であるため、`margin`閾値だけで判定すると周辺語一致1件だけの弱い単独候補が安易に`resolved`になってしまう。これを避けるため、`resolved`の条件を「最上位候補のconfidenceが`propertyConfidence`(0.7)以上、**かつ**`marginOf()`が`margin`(0.2)以上」の両方を満たす場合に限定した（新しい閾値は発明せず、既存の2閾値をそれぞれ別の役割で使う）。詳細・実データでの根拠は`trace_comparison_schema_v1.md` 7節の訂正を参照。
>
> **実装範囲**：`semantic_mapping_prototype.js`の`marginOf()`・`CONCEPT_DICTIONARY`・`generatePropertyCandidates()`を`quantity_sidecar_binding_core.js`へ一字一句移植し（乖離検出は`quantity_annotation_ported_lib_check.js`へ追加）、`generatePropertyResolutions({ binding })`として、Phase B-1で結合済み(`status:'bound'`)の数量ごとに1回だけproperty候補を評価する。`relations`は受け取らず、bound済みanalysesを直接走査するため、同じ数量が複数の照合行から参照されても再計算・重複が構造的に起こらない。PDF側は`source_raw_text`（段落全体）、Excel側は同じ行の他列（管理列・対象数量自身の列を除く）の値を連結したものを`nearbyText`とする（`generateIntervalSemanticsCandidates()`用のnearbyTextとは別定義。2.3節の訂正で確立した「対象セル自身のみ」という制約は、あちらの用途＝数量そのものの形・語彙判定に限定した話であり、こちらの用途＝概念の対応付けには元々このような周辺文脈が必要、という7節冒頭の想定どおり）。Phase B-1の`ready:false`・`path_mapping_unsupported`（`status:'unparsed'`）はそのまま伝播し、この段階で再生成・重複記録しない（`bindingAnalysesByTraceId()`が`status:'bound'`のみを対象にするため、構造的に除外される）。concept間の結合・除外バケット化・数値比較・comparisonMode導出・充足判定はまだ実装していない（3.4節 段階2b、B-2.2aのレビュー承認後に着手する）。
>
> **訂正（`92bfa9a`レビュー、2026-07-20、重大3件・中1件）**：初回実装には次の欠陥があった。
> 1. **【重大】`generatePropertyResolutions()`がbindingとは別に`requirementTrace`/`actualTrace`を受け取っており、Phase B-1の厳密結合を迂回できた**：渡されたtraceの`dataset_signature`・`content_hash`を再検証せず`trace_id`だけで文脈を取得していたため、bind後に別のtraceを渡す・A/Bのtraceを取り違える・同じ`trace_id`で本文やタグだけ変更したtraceを渡す・trace引数を省略する、のいずれでも`ready:true`のまま空文脈または誤った文脈で候補生成が続いてしまう欠陥だった。修正: `bindSide()`が`bindings[]`の各エントリ(`status:'missing'/'unparsed'/'stale_annotation'/'bound'`いずれも)へ、content_hash検証済みの元trace recordそのものを`record`として埋め込むよう変更し、`generatePropertyResolutions({ binding })`はtrace引数を完全に廃止した（渡しても無視される）。これにより、別trace・取り違え・改変・省略のいずれも構造的に起こり得なくなった。
> 2. **【重大】B-2.2a単独で呼び出すとsidecar内`quantity_id`重複を検出しない**：段階1(`generateDimensionCandidates()`)は`duplicateQuantityIds()`で重複IDをfail closedするが、`generatePropertyResolutions()`はこの検査を独自に持っておらず、「段階1が先に呼ばれるから安全」という暗黙の前提に依存していた。`generatePropertyResolutions()`は独立して呼び出せる公開関数であるため、この前提は成立しないと指摘された。修正: 同じ`duplicateQuantityIds()`をB-2.2a内でも独立して実行し、重複時は`duplicate_quantity_id`エラーでfail closedする。
> 3. **【重大】`ready:false`時にPhase B-1の元診断(`path_mapping_unsupported`等、`side`・`trace_id`付き)が新設の`binding_not_ready`マーカーに置き換わり消えていた**：また成功時も`diagnostics`は常に空配列だった。加えて、この欠陥を検証するはずだった当初のテストは、実際の`bindSide()`が`path_mapping_unsupported`をerror severityとして扱い`ready:false`になる現実の経路を検証しておらず、`ready:true`を人為的に上書きした偽の入力で「resolutionsに現れないこと」だけを確認していた（元診断が保持されるかどうかは未検証だった）。修正: `blockedPropertyResult()`が`binding.diagnostics`・`binding.not_analyzed`を新設の診断に追加する形で必ず引き継ぐようにし、テストも実際の`bindInputPair()`の出力（`ready:false`になる）を使う形に差し替えた。
> 4. **【中】Excel側nearbyTextが「他列」ではなく「対象数量自身の列を含む管理列以外の全列」になっていた**：ドキュメント・コメントは「対象数量の列を除いた他列」と説明していたが、実装は`analysis.source_field`を除外しておらず、同じ行に複数の数量がある場合すべてが同一の(自分自身を含む)全文脈を共有していた。これは2.3節で一度解消したはずの「意図しない語の混入」と同種の欠陥であり、対象列自身に濃厚なキーワードが含まれる場合、それだけで実際に確信度を押し上げてしまうことを実データ相当の合成ケースで確認した。修正: `nearbyTextForRecord(record, sourceField)`が`analysis.source_field`と一致する列を除外するよう変更した。
>
> 回帰テストは`quantity_property_candidate_verification.js`（40件。上記4件それぞれの直接的な回帰確認（trace引数を誤って渡しても無視されること、quantity_id重複でのfail closed、実際の`bindInputPair()`によるpath_mapping_unsupported伝播、対象列自身の文言が漏れ込まないこと・同一行複数数量での取り違え防止）を追加し、明確な解決・候補ゼロ・僅差候補・弱い単独候補・binding不整合時の停止・入力順非依存・実fixtureでのend-to-end確認は元のまま維持）。4件の防御を意図的に無効化すると、対応する7件のアサーションが実際に失敗することを確認した上で復元した。
>
> **訂正（`e9edc97`レビュー、2026-07-20、追加で重大3件）**：上記の修正だけではなお不十分だった。
> 1. **【重大】`record`／`annotation`を参照のまま埋め込んでおり、bind後に元オブジェクトを変更すると連動して変わってしまう**：前回の修正は「別のtrace引数を渡せる」という迂回経路は閉じたが、`bindings[]`へ埋め込む`record`・`annotation`(sidecarレコード)自体が元の`trace`/`annotation`オブジェクトへの直接参照のままだった。呼び出し側がbind後に元のtrace・annotationオブジェクトを(別の目的で使い回す等により)変更すると、その変更がbinding経由でそのまま見えてしまう。修正: `snapshotValue()`(`structuredClone()`で複製し再帰的に`Object.freeze()`する)を追加し、`bindSide()`の全ステータス(`missing`/`unparsed`/`stale_annotation`/`bound`)で`record`を、`bound`ステータスで`annotation`をそれぞれスナップショット化してから埋め込むよう変更した。`generatePropertyResolutions()`側にも、bound状態のtrace_idに対応するrecordがbinding内に見つからない場合(手動構築した不正なbinding等)はfail closedする防御を追加した。
> 2. **【重大】`ready:true`(正常終了)時も`diagnostics`が常に空配列で、`missing_annotation`等のwarningや`not_analyzed`が消えていた**：`ready:false`時の引き継ぎは前回修正したが、`ready:true`のまま一部レコードにwarning・`not_analyzed`が付くケース(例: 一部レコードだけ`missing_annotation`)を想定していなかった。修正: 成功時も`binding.diagnostics`・`binding.not_analyzed`をそのまま引き継ぐようにした。
> 3. **【重大】Excel側nearbyTextの除外対象が「対象数量自身の列」に留まっており、「同じ行の別の数量の列」は除外されないままだった**：前回の修正・回帰テストは「対象数量自身の列を除外する」ところまでで止まっており、追加した回帰テスト自身が「別の数量の列に含まれるキーワードを拾って解決できる」ことを**成功条件**として明記していた。これは、ある数量の概念解決に別の数量自身の値が周辺語として混入することを許容しており、Phase Aのinterval_semantics nearbyText漏れ込みと同種の欠陥を形を変えて再現させていた。修正: `nearbyTextForRecord(record, quantitySourceFields)`が、対象数量自身の列だけでなく、その行に存在する**全analysisのsource_field集合**を除外するよう変更した。数量を持たない純粋な手がかり列(例:「設計項目」)は除外対象に含まれないため、過剰除外にはならないことも回帰テストで確認した。
>
> 回帰テストは`quantity_property_candidate_verification.js`をさらに拡張した（52件）。追加した主なケース: bind後に元traceの本文・タグを書き換えても結果が不変であること、bindingへ埋め込まれたrecordが直接の書き換えに対してもfreeze済みで反映されないこと、bind後にsidecar(annotation)側のanalysesを書き換えても結果が不変であること、warning付き`ready:true`でも診断・`not_analyzed`が伝播すること、bound状態なのにrecordが欠落したbindingがfail closedすること、同一行に異なるconceptの数量が複数あっても互いを取り違えないこと、純粋な手がかり列は過剰除外されないこと。3件の防御を意図的に無効化すると、対応する8件のアサーションが実際に失敗することを確認した上で復元した。
>
> **訂正（`e6744f7`レビュー、2026-07-21、「不変スナップショット化」自体に残っていた重大2件）**：前回（`e9edc97`）の修正で導入した`snapshotValue()`は、record/annotationという末端の値を確かに複製・freezeするようになったが、その適用タイミングと範囲に、なお2つの重大な穴が残っていた。
> 1. **【重大、TOCTOU】スナップショット取得が非同期検証の後になっていた**：`bindSide()`は`computeDatasetSignature(records)`・`computeRecordContentHash(record)`という`await`を挟む非同期処理を、まだ元の（呼び出し側が保持する）`trace`/`annotation`オブジェクトに対して直接実行し、`snapshotValue()`は各`bindings.push()`の直前（＝非同期処理が完了した後）になって初めて呼ばれていた。`await`で一度制御を手放している間に、呼び出し側が元の`trace`/`annotation`オブジェクトを書き換えれば、「検証（hash計算）に使われた内容」と「bindingへ実際に埋め込まれる内容」が食い違いうる、という時間差（time-of-check-to-time-of-use）が残っていた。修正: `trace`/`annotation`を、`bindSide()`内の最初の`await`より前に同期的に`snapshotValue()`し（`snapTrace`/`snapAnnotation`）、以後のschema検証・`dataset_signature`計算・`content_hash`計算・binding生成はすべてこの同一のスナップショットに対してのみ行う。`bindInputPair()`も、`requirement`側を`await`し終えてから`actual`側の`bindSide()`を開始する逐次実行をやめ、両方の`bindSide()`呼び出しを（個別に`await`せず）同時に開始してから`Promise.all()`でまとめて待つ形に変更した。`bindSide()`のスナップショット取得が最初の`await`より前の同期区間で完了するため、`bindInputPair()`呼び出し直後の時点で両side分ともスナップショットが確定するようになる。
> 2. **【重大、不完全なfreeze】`ruleset_version`と、record/annotationを包むラッパー構造自体が可変のままだった**：`ruleset_version:annotation.ruleset_version`は元`annotation`への生参照のままで、`snapshotValue()`の対象外だった（呼び出し側が`propertyConfidence`等の閾値をbind後に書き換えれば、`generatePropertyResolutions()`の判定基準自体が変わってしまう）。加えて、各`bindings[]`要素（`{trace_id, status, annotation, record}`）自体・`bindings`配列自体・`bindSide()`/`bindInputPair()`の戻り値オブジェクト自体は、末端の`record`/`annotation`だけがfreezeされているだけで、包む側は一切freezeされていなかった（`binding.ready`・`binding.requirement.bindings[0].status`・`binding.requirement.bindings[0].record`（ポインタ自体の差し替え）がすべて外部から書き換え可能だった）。修正: `record`/`annotation`個別の`snapshotValue()`呼び出しは（既にスナップショット済みツリーの部分木のため）不要になり削除し、代わりに`bindSide()`・`blocked()`・`bindInputPair()`それぞれの戻り値オブジェクト全体を`deepFreeze()`する形に変更した。これにより`ruleset_version`（スナップショット由来のため既にfreeze済み）を含め、`bindings`配列・各`bindings[]`要素・戻り値オブジェクト自体のすべてが再帰的に不変となる。
>
> 回帰テストは`quantity_property_candidate_verification.js`をさらに拡張した（62件）。追加した主なケース: `bindInputPair()`呼び出し直後（結果を`await`する前）に、`content_hash`の計算対象に含まれないフィールド（`source_record_display_unresolved`）へ`path_mapping_unsupported`を同期的に注入しても、要求側・実仕様側いずれもbinding結果へ反映されないこと（TOCTOU修正の直接確認）、`binding.ready`・`bindings[]`要素の`status`/`trace_id`/`record`/`annotation`への直接書き換え・`bindings`配列への直接`push()`がいずれも反映されないこと、bind後に`ruleset_version.auto_applicable_thresholds`（`propertyConfidence`/`margin`）を直接書き換えても、弱い単独候補が`resolved`へ昇格しないこと。2件の防御（TOCTOU対策・戻り値全体のfreeze）をそれぞれ個別に無効化すると、対応する2件・6件のアサーションが実際に失敗することを確認した上で復元した（戻り値全体のfreezeを外した場合、`ruleset_version`のfreezeは`snapshotValue()`側の保護が別途生きているため影響を受けず、期待どおり該当テストは失敗しなかった）。なお、`generateDimensionCandidates()`・`generatePropertyResolutions()`側でbinding自体の構造的整合性（`side`ラベル・`bindings[]`各要素の`trace_id`一貫性・`ruleset_version`の許可リスト再検証）を追加検証する案もレビューで提案されたが、これは「可能なら」という位置づけの追加提案であり、B-2.2aの必須修正（上記2件）には含まれないため、今回は見送った。

## 8. 未解決事項

- **本体3ツールへの実装は一部着手**：PDF側の数量注釈シャドー出力（2.2節）はフェーズAで実装・実ブラウザ検証済み（`spec_to_json_conversion_tool_v1.18.html`の`buildQuantityAnnotationSidecar()`/`v12ExportQuantityAnnotationSide()`、新設ボタン`#btn-quantity-annotation-export`/`-b`）。Excel側の数量注釈シャドー出力（2.3節）も**単一シート利用について**フェーズAで実装・実ブラウザ検証済み（`excel_to_json_conversion_tool_v2.0.8.html`の`buildQuantityAnnotationSidecarExcel()`/`exportQuantityAnnotationExcel()`、新設ボタン`#buildQuantityAnnotationBtn`）。全シート数量注釈は未実装であり、現在は部分出力を防ぐガードで停止する。`json_ab_trace_matching_tool_v12.1.15.html`側はPhase B-1として、4 ID保持（3.2節）とSchema・署名・ハッシュ・一意IDによる厳密結合（3.3節）まで実装済み。Phase B-2として、3.4節の段階1（canonical dimension索引、同一次元候補バケット、異次元の圧縮監査バケット）を`generateDimensionCandidates()`として、段階2の最初の単位（B-2.2a、数量ごとのproperty候補生成・resolved/unavailable/ambiguous正規化）を`generatePropertyResolutions()`として、段階2の残り（B-2.2b、concept一致によるバケット結合・除外の圧縮監査・候補上限）を`generateComparisonCandidates()`として実装済み。段階3の条件候補の整合（3.4節3番）を、数量ごとのinterval_semantics_candidates解決（B-2.3a段階3-1、`generateConditionResolutions()`）と両側条件解決結果の付加（B-2.3a段階3-2、`generateConditionAnnotatedComparisonCandidates()`）として実装済み。段階3のcomparisonMode導出（4番）も、固定表からの導出のみに限定した形（B-2.3b段階3-3、`generateComparisonModeCandidates()`）で実装済み。段階4の最初の部分として、単位互換性の判定と変換計画の生成（数量値・区間境界へは未適用）を`generateUnitConversionPlans()`（B-2.4a）として実装済み。一対多規則（5番）・逐次絞り込み後の最大候補数打ち切り（6番、B-2.2bでは`concept_id`単位の候補上限として実装済みだが、3.4節5番の「一対多」規則自体は未確定のまま）・変換計画の実適用（数量値・区間境界への係数適用）・数値比較・区間包含判定・auto applicability判定・充足判定・`trace-comparison/1.0-rc1`生成は未着手のまま。B-2.2a・B-2.2b・B-2.3a・B-2.3b・B-2.4aいずれもブラウザUI統合は未着手（コア契約の確定を優先し、意図的に見送った）。
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

**この改訂までに完了した項目**（上記条件との対応）：条件5（§11の機械検証・deep-equal自動化）は完了。条件6は`content_hash`/`quantity_id`/`dataset_signature`・ハッシュ入力構築契約・3経路同値性について、PDF側・Excel側とも完了（比較エンジン側のみ未完了、上表）。PDF側とExcel単一シート側の`quantity-annotation/1.0-rc1`生成（2.2節・2.3節）はフェーズAで実装・実ブラウザ検証済み（`quantity_annotation_pdf_verification.js`37件、`quantity_annotation_excel_verification.js`46件（意味候補への列見出し・他セルの漏れ込み防止、数量ゼロ件の列をcolumn_role_candidatesから除外、行除外・表示文字列解決不能時の診断、の回帰テストを追加）、`quantity_annotation_excel_xlsx_verification.js`47件（実`.xlsx`経由。既定設定での単位付き数値セル抽出・書式変更による陳腐化検出・依存バージョン一致確認、セル編集・行の並べ替え・列名変更後も表示文字列が行の実体へ追従することに加え、全シート時の部分出力防止ガード、プロファイル列マッピングの逆引き、未対応のパスマッピング診断を追加検証）、`quantity_annotation_ported_lib_check.js`10件（両ツールの移植ライブラリを検証）、`quantity_annotation_schema_check.js`9件、いずれも成功。同一スナップショット保証は、PDF側は`v12BuildTrace()`呼び出し回数のモンキーパッチ計測、Excel側は1クリックで両ファイルをダウンロードする実装＋`generated_at`一致検証で、それぞれ直接検証した。意図的な退行注入で実際に検出できることも両ツールで確認した）。`quantity-annotation/1.0-rc1`のJSON Schema（`quantity_annotation_schema_v1.json`）も作成し、`quantity`/`evidence`/`intervalBound`の内部構造(区間の`value`/`inclusive`必須化、単位・抽出信頼度の必須フィールド)まで検証する形に強化した上で実生成物を検証済み（6節25番の一部。Excel固有の`column_role_candidates`も含めてSchema化した）。`quantity.kind`は当初レビューで`const:"interval"`への変更を提案されたが、`quantity_extraction_prototype.js`（297行目）が「12/15 kW」のような並列値に対し`kind:'alternatives'`（`lower`/`upper`を持たない別形状）を実際に生成することを確認したため採用せず、`oneOf`による判別可能な共用体（`json_schema_minivalidator.js`に追加）で両形状を区別しつつ`kind:"unknown"`等は拒否する形にした。トップレベルに`id_hash_algorithm: "SHA-256/128"`フィールドを追加し、文書・実出力・Schemaの3者を一致させた。`source_span.end>=start`・`source_text`が元trace(`source_raw_text`)の`source_span`位置と一致すること、というJSON Schemaでは表現できない不変条件も、実データに対する検査として追加した。条件1〜4・7は引き続き未達（比較エンジン側の回帰テストは設計のみで未実装、`evaluateAutoApplicable()`シグネチャ変更は未着手、`trace-comparison`側の本体コード実装は未着手）。

**フェーズA完了状態について**：PDF側およびExcel側の**単一シート利用**については、表示文字列を解析時点に捕捉した`currentCellMeta[行].__number_format`とライブな現在値からstable-identityに再構成し、セル編集・行の並べ替え・列名変更・行除外・単純なプロファイル列マッピングのいずれでも取り違えないことを回帰テストで確認したため、フェーズA完了と評価する。全シート数量注釈はフェーズAの対象外・未実装であり、現在は選択中シートだけを黙って部分出力しないよう、ダウンロード前のガードと明確な案内を実装済みである。将来全シート対応を行う場合は、シートごとに独立したtrace＋sidecarペアと`dataset_signature`を生成し、異なるシートを1つのtraceへ連結しない。

## 10. 次工程の推奨順序

1.（**単一シート利用について完了**）2節の数量注釈シャドー出力（PDF/Excel側、既存コードへの影響ゼロ）を実装・検証する。全シート数量注釈は対象外・未実装であり、部分出力防止ガードを実装済み。6節の回帰テストのうち1〜3・5・7・20・21番はこの段階で検証済み（4・6番は比較エンジン側実装後に検証、25番は`quantity-annotation`側のみ完了）。
2. 対象帳票（本体で実際に使われているPDF/Excelサンプル、可能なら匿名化済みのもの）を用いて、概念辞書・列役割候補生成の規則を実データから検証・確定する（1番の規則自体は合成データで実装済み、実データ検証は未実施のまま）。
3. 7節の`evaluateAutoApplicable()`シグネチャ変更をプロトタイプ側（`semantic_mapping_prototype.js`）に先行実装し、86件のテストスイートを更新する（本体へ移植する前にプロトタイプ側で安全性を確認する、という既存の開発順序を踏襲）。
4. 3節の比較レコード組み立てを実装し、6節の回帰テストのうち8〜19番、および4・6番を検証する。**Phase B-1（3.2・3.3節、4 ID保持・厳密結合）・Phase B-2（3.4節段階1、同一次元候補バケット／異次元監査バケット。段階2、B-2.2a数量ごとのproperty候補生成・resolved/unavailable/ambiguous正規化、B-2.2bconcept一致によるバケット結合・除外の圧縮監査・候補上限。段階3、B-2.3a数量ごとのinterval_semantics_candidates解決・両側条件解決結果の付加、B-2.3b固定表からのcomparisonMode候補導出。段階4の一部、B-2.4a単位互換性判定・変換計画生成）は完了、6節15・17・19番は検証済み**。一対多規則（5番、未確定のまま）・変換計画の実適用・数値比較・区間包含判定・auto applicability判定・充足判定・`trace-comparison/1.0-rc1`レコード自体の生成は未着手。
5. `trace_comparison_schema_v1.md` §10のレビュー状態遷移を実装し、6節22〜24番を検証する。
6. レビュー状態の永続化先を決定する（8節）。
7. `trace-comparison/1.0-rc1`側のJSON Schema定義とブラウザ統合テスト（6節26番）を追加する。
