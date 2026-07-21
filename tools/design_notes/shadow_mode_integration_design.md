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

理由コード：`no_annotation`（3.2節、quantity-annotation側に該当`trace_id`が見つからない）／`source_mismatch`／`stale_annotation`（3.3節）／`dimension_mismatch`（段階1）／`property_unresolved`（段階2、B-2.2b追加。該当数量自体のconcept解決が`resolved`に至っていない）／`concept_mismatch`（段階2、B-2.2b追加。`resolved`同士だが対応するconceptが相手側にない）／`condition_mismatch`（段階3、未実装）／`no_comparison_mode`（段階4、未実装）／`candidate_limit_exceeded`（段階2以降共通、`(bucket, concept_id)`単位の候補上限超過。severity:warning、B-2.2bで実装済み）／`total_candidate_limit_exceeded`（段階2、B-2.2b round1修正で追加。comparison候補の合計件数が`totalCandidateLimit`を超えた場合にcomparison_candidates全体をfail closedする。severity:error）。件数だけのサマリが必要な場合は、この個別リストから都度集計すればよく、個別リストと別に件数フィールドを二重に持たせない。

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
19.（**Phase B-2段階1・段階2完了**）数量が多いレコード同士でも同一次元・異次元のどちらも`N×M`件のオブジェクトへ展開しないこと。段階1は200×200同一次元を1候補バケット、潜在ペア数`candidate_count:40000`として保持する回帰を追加済み。段階2（B-2.2b）は、1バケット内で同一conceptに要求側10件・実仕様側10件（100ペア）が集中する合成データで`candidateLimit`（既定50、テストでは5を明示指定）超過分が個別ペアへ展開されず`candidate_limit_exceeded`1件（`excluded_pair_count`付き）に圧縮されることに加え、要求側・実仕様側とも2,000件（潜在ペア400万件）の合成データで`generateComparisonCandidates()`自体がタイミング計測上も短時間（数十ms程度）で完了すること（`da4f3ee`レビューで指摘された「candidateLimit適用前に全直積を中間生成していた」欠陥に対する性能的な直接証拠）を`quantity_comparison_candidate_verification.js`で確認済み（3.4節6番「最大候補数の打ち切りと診断情報への記録」への回答）。全体の合計にも別途`totalCandidateLimit`（既定500）を設け、単一グループ・複数バケットのいずれの経路で超過してもcomparison_candidates全体をfail closedすることも同ファイルで確認済み

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

- **本体3ツールへの実装は一部着手**：PDF側の数量注釈シャドー出力（2.2節）はフェーズAで実装・実ブラウザ検証済み（`spec_to_json_conversion_tool_v1.18.html`の`buildQuantityAnnotationSidecar()`/`v12ExportQuantityAnnotationSide()`、新設ボタン`#btn-quantity-annotation-export`/`-b`）。Excel側の数量注釈シャドー出力（2.3節）も**単一シート利用について**フェーズAで実装・実ブラウザ検証済み（`excel_to_json_conversion_tool_v2.0.8.html`の`buildQuantityAnnotationSidecarExcel()`/`exportQuantityAnnotationExcel()`、新設ボタン`#buildQuantityAnnotationBtn`）。全シート数量注釈は未実装であり、現在は部分出力を防ぐガードで停止する。`json_ab_trace_matching_tool_v12.1.15.html`側はPhase B-1として、4 ID保持（3.2節）とSchema・署名・ハッシュ・一意IDによる厳密結合（3.3節）まで実装済み。Phase B-2として、3.4節の段階1（canonical dimension索引、同一次元候補バケット、異次元の圧縮監査バケット）を`generateDimensionCandidates()`として、段階2の最初の単位（B-2.2a、数量ごとのproperty候補生成・resolved/unavailable/ambiguous正規化）を`generatePropertyResolutions()`として、段階2の残り（B-2.2b、concept一致によるバケット結合・除外の圧縮監査・候補上限）を`generateComparisonCandidates()`として実装済み。条件候補の整合（3.4節3番）・comparisonMode導出（4番）・一対多規則（5番）・逐次絞り込み後の最大候補数打ち切り（6番、B-2.2bでは`concept_id`単位の候補上限として実装済みだが、3.4節5番の「一対多」規則自体は未確定のまま）・数値比較・`trace-comparison/1.0-rc1`生成は未着手のまま。B-2.2a・B-2.2bいずれもブラウザUI統合は未着手（コア契約の確定を優先し、意図的に見送った）。
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
4. 3節の比較レコード組み立てを実装し、6節の回帰テストのうち8〜19番、および4・6番を検証する。**Phase B-1（3.2・3.3節、4 ID保持・厳密結合）・Phase B-2（3.4節段階1、同一次元候補バケット／異次元監査バケット。段階2、B-2.2a数量ごとのproperty候補生成・resolved/unavailable/ambiguous正規化、B-2.2bconcept一致によるバケット結合・除外の圧縮監査・候補上限）は完了、6節15・17・19番は検証済み**。条件候補の整合（3.4節3番）・comparisonMode導出（4番）・一対多規則（5番、未確定のまま）・`trace-comparison/1.0-rc1`レコード自体の生成は未着手。
5. `trace_comparison_schema_v1.md` §10のレビュー状態遷移を実装し、6節22〜24番を検証する。
6. レビュー状態の永続化先を決定する（8節）。
7. `trace-comparison/1.0-rc1`側のJSON Schema定義とブラウザ統合テスト（6節26番）を追加する。
