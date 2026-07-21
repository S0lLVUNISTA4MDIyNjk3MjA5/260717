# `trace-comparison/1.0-rc1` 正式スキーマ設計

## 0. 位置づけ

`baseline_v1_handoff.md`で完了と判断された基準版v1（プロトタイプ側5スイート・実データ検証・実ブラウザ検証）、および同資料§7.4で確定した3点（配列選択の修正・ペアIDのデータ契約・PDF側`source_raw_text`生存確認）を踏まえ、`trace-comparison/1.0`の正式スキーマを設計する。

**本節で決定すること**：JSONスキーマの形そのもの。
**本節で決定しないこと**：本体への具体的な組み込み手順（shadow-mode挿入点）。これは`shadow_mode_integration_design.md`で扱う。

> **改訂履歴**
> - `22c5e24`→`938ccf7`：順序依存の`quantity_pair_id`・単一`review.confirmed`による確認範囲の混同・候補配列から単一`mapping`への縮約過程の欠落・再現性情報（source hash・ruleset・閾値）の欠落、の4点へ対応。
> - `938ccf7`→`54ad4df`：レビュアー交代後の指摘で、次が未解決と判定された。(1) `simpleHash()`（32-bit FNV-1a）を陳腐化・取り違え検出に使うのは実装上不十分（実際にハッシュ衝突を再現して確認済み）、(2) `quantity_id`が`occurrence_index`（抽出順序に間接依存）に頼ったままで真の順序非依存になっていない、(3) `review.confirmed_targets`の対象が`mapping`/`comparison_mode`/`satisfied`の3つのみで、数量抽出・単位・条件整合が確認対象に含まれず、依存関係も未定義、(4) §11の「完全な具体例」が、実際には無関係な2つのレコード（`design-use-temperature`と冷房能力の数量）を組み合わせて作られており、参照整合性が取れていなかった。`54ad4df`は(1)(2)(4)を解消し、(3)に対応した。
> - `54ad4df`→`662d78b`：さらなる再指摘で、(a) 検証スクリプトが出力する`review`が旧構造のままで文書側だけ手修正されていた、(b) `content_hash`/`quantity_id`が両方とも16桁（64-bit）に切り詰められており`hash_algorithm: "SHA-256"`の表記と矛盾していた、(c) `content_hash`の対象が本文・セル値のみでタグ・列見出しを含んでいなかった、(d) `relationship`の値が実際にはfixtureから読み込まれず定数として埋め込まれていた、という4点、続いて(e) `content_hash`が意味候補生成に実際使う「同じ行の他フィールド（設計項目列）」を含んでいなかった、(f) ハッシュ入力構築が`v12HashParts()`と同一契約になっていなかった、(g) `dataset_signature`の「仕様確定」と「実装済み」が区別されていなかった、という3点が指摘された。`662d78b`はこれらすべてに対応した。
> - `662d78b`→`929a365`：`662d78b`での修正作業中、`v12HashParts()`が区切り文字にNUL文字を使うところを、ファイル内の生NUL文字表示を整えようとした際に誤ってスペース区切りへ変更してしまっていたことが指摘された（同じ入力でもNode検証とブラウザ実装で異なるハッシュになる高重大度の不整合）。NUL文字区切りへ訂正し、`hashParts()`の固定ベクトルテスト（既知の入力に対する期待値を固定し、`["ab","c"]`と`["a","bc"]`が異なることを確認する等）を追加した。
> - `929a365`→`e18f36d`：3経路（Node `crypto.createHash`／ブラウザ`crypto.subtle.digest`／純JSフォールバック`v12Sha256Fallback()`）のハッシュ同値テストを実施した。日本語・全角ASCII・CRLF・連続空白・絵文字・境界の曖昧性を試す組み合わせを含む11ベクトルすべてで3経路が一致することをPlaywrightで確認した（`shadow_mode_integration_design.md` §6回帰テスト27番）。この検証の過程で、検証スクリプトの`hashParts()`が実際の`v12HashParts()`と異なり`namespace`まで正規化していたことを発見し、訂正した（実際の契約は`namespace`を正規化しない）。
> - `e18f36d`→本改訂：結果fixtureのみコミットし検証スクリプト自体はscratchに残していたため「一回限りの実証」に過ぎず、本体側の実装が将来壊れても自動検出できない、との指摘を受けた。`tools/design_notes/hash_3paths_verification.js`（Playwright必要、完全版）と`hash_3paths_node_check.js`（依存パッケージなし、`source_blob_sha`によるHTML変更検知＋Node側ハッシュの回帰確認）をリポジトリへ保存し、再実行可能にした。`-rc1`から正式版への昇格条件は`shadow_mode_integration_design.md` §9に記録した。
> - 本改訂→Phase B-2実装（`00acf39`レビュー、2026-07-20）：3.4節「全組み合わせ生成の絞り込み」の段階1（canonical dimension一致）を`quantity_sidecar_binding_core.js`の`generateDimensionCandidates()`として実装した。当初の設計（本節が例示する`not_analyzed`個別ペアリスト）は、次元不一致のような「大きな塊で起こる除外」にまで個別ペア粒度を適用すると組み合わせ爆発を起こす欠陥があり（20要求×20実仕様の異次元合成データで実際に400件生成されることを確認）、次元段階だけはバケット単位の圧縮監査記録へ訂正した。詳細・訂正の経緯は`shadow_mode_integration_design.md` 3.4節を参照。段階2以降（設計特性候補の一致・条件候補の整合・comparisonMode導出）は当初の個別ペア粒度のまま未実装。
> - `77f440f`レビュー（2026-07-20）：異次元の監査記録だけでなく、同一次元候補も数量ID全直積へ展開しない契約へ訂正した。段階1の出力は`candidate_buckets[]`（両数量ID集合、dimension、潜在ペア数、4参照ID）とし、段階2以降が逐次走査して個別ペアを絞り込む。照合行複合キーの区切り文字衝突、複数関係時の`dimension_unavailable`重複、手動関係変更後のUI表示陳腐化も同時に修正した。
> - `9c06125`→本改訂（Phase B-2.2a実装、2026-07-20）：3.4節 段階2の最初の単位として、数量ごとのproperty候補生成・解決状態の正規化を`generatePropertyResolutions()`として実装した。`semantic_mapping_prototype.js`の`marginOf()`・`CONCEPT_DICTIONARY`・`generatePropertyCandidates()`を一字一句移植し、独自の別ロジックは作らなかった。7節の`mapping.status`を`resolved`／`unavailable`／`ambiguous`の3状態へ訂正した経緯は7節を参照。この段階ではconcept間の結合・除外バケット化・数値比較・comparisonMode導出・充足判定は実装していない（段階2b、未着手）。
> - `92bfa9a`レビュー（2026-07-20）：初回のB-2.2a実装に重大3件・中1件の欠陥が見つかった。(1) `generatePropertyResolutions()`がbindingとは別にtrace引数を受け取り、渡されたtraceを再検証せずPhase B-1の厳密結合を迂回できた、(2) B-2.2a単独ではsidecar内`quantity_id`重複を検出しなかった、(3) `ready:false`時にPhase B-1の元診断(`path_mapping_unsupported`等)が新設のマーカーに置き換わり消えていた、(4) Excel側`nearbyText`が対象数量自身の列を除外できておらず「他列」という契約と実装が一致していなかった。修正の詳細は`shadow_mode_integration_design.md` 7節の訂正を参照。
> - `e9edc97`レビュー（2026-07-20）：上記の修正だけでは不十分で、さらに重大3件が見つかった。(1) `record`/`annotation`を参照のまま埋め込んでおり、bind後に元オブジェクトを変更すると連動して変わってしまう、(2) `ready:true`時も`diagnostics`が常に空配列でwarning・`not_analyzed`が消えていた、(3) Excel側`nearbyText`の除外対象が対象数量自身の列に留まっており、同じ行の別の数量の列は除外されないまま（追加した回帰テスト自身がこれを「成功条件」にしてしまっていた）。修正: `snapshotValue()`(structuredClone+再帰的freeze)による不変スナップショット化、`ready:true`時のdiagnostics/not_analyzed伝播、行単位の全数量所在列除外、をそれぞれ実装した。詳細は`shadow_mode_integration_design.md` 7節の訂正を参照。
> - `e6744f7`レビュー（2026-07-21）：「不変スナップショット化」自体になお重大2件が残っていた。(1) TOCTOU：スナップショット取得が`computeDatasetSignature()`/`computeRecordContentHash()`という非同期検証の後（`bindings.push()`直前）になっており、`await`で制御を手放している間に呼び出し側が元の`trace`/`annotation`を書き換えると、検証済み内容とbindingへ埋め込まれる内容が食い違いうる時間差が残っていた、(2) `ruleset_version`が元`annotation`への生参照のまま・各`bindings[]`要素やbindings配列・戻り値オブジェクト自体は末端のrecord/annotationだけがfreezeされ包む側は可変のままだった。修正: `trace`/`annotation`を`bindSide()`内の最初の`await`より前に同期的にスナップショット化し以後はそれだけを使う、`bindInputPair()`の要求側/実仕様側`bindSide()`呼び出しを逐次awaitから`Promise.all()`による同時開始へ変更、`bindSide()`/`blocked()`/`bindInputPair()`の戻り値オブジェクト全体を`deepFreeze()`する、の3点。詳細は`shadow_mode_integration_design.md` 7節の訂正を参照。
> - `4c9e81e`承認後（Phase B-2.2b実装、2026-07-21）：3.4節 段階2（設計特性候補の一致）を`generateComparisonCandidates()`として実装した。段階1の`candidate_buckets[]`と段階2a（`generatePropertyResolutions()`、再計算せずMap参照のみ）の結果を突き合わせ、concept_idが一致する`resolved`同士の数量ペアだけをcomparison候補にする。単一バケット内でも数量ID数は無制限（200×200の合成データが既存の次元候補回帰テストで実在確認済み）であるため、段階1と同様にconcept_idごとのグルーピングと`candidateLimit`（既定50）で組み合わせ爆発を避ける契約へ設計した（3.4節240行目の「段階2以降は母数が絞り込まれているため爆発しない」という前提の訂正）。`dimensionResult`/`propertyResult`は呼び出し側の別引数として受け取らず、`{binding, relations, candidateLimit}`だけから関数内部で1回ずつ計算する（B-2.2a round1で見つかった「別途渡された検証済みデータがbindingと食い違いうる」欠陥クラスの再発防止）。詳細は`shadow_mode_integration_design.md` 3.4節の訂正を参照。
> - `da4f3ee`レビュー（2026-07-21）：B-2.2b初回実装は方針こそ正しかったが、実装が方針どおりになっていない重大2件・中1件が見つかった。(1) `candidateLimit`適用前に`reqIds×actIds`の全直積を配列へ中間生成してからslice()しており、3.4節が防いだはずの組み合わせ爆発が1グループ単位で再発していた、(2) `candidateLimit`は「1つの(bucket,concept_id)組あたり」の上限にすぎず全体には上限がなかった、(3) `binding.ready===false`時に`blockedComparisonResult()`が`binding`自体を受け取らず、Phase B-1のside・trace_id付き診断が消えていた（B-2.2aで一度修正した欠陥の再発）。修正: 全直積を作らず二重ループ内で上限到達時に打ち切る、全体の合計にも`totalCandidateLimit`（既定500）を新設し超過時はcomparison_candidates全体をfail closedする、`blockedComparisonResult()`がbindingを受け取りbinding.diagnostics/not_analyzedを常に引き継ぐ、candidateLimit/totalCandidateLimitを1〜10,000の安全な整数として検証する、の4点。詳細は`shadow_mode_integration_design.md` 3.4節の訂正を参照。

## 1. 設計原則

1. **並行レイヤー方式（sidecar）を採用し、既存スキーマは変更しない**。`chapter-section-trace-v1`・`excel-row-trace-v1`のフィールド構成には一切手を加えない。根拠は`baseline_v1_handoff.md` §7.1〜§7.3で実証済み（未知フィールドの生存・元データの生存を静的解析＋実ブラウザ実行の両方で確認済み）。
2. **「設計特性一致・数量意味・比較方向・充足判定・人間確認」を1つのフィールドに混在させない**（プロジェクト全体を通じて維持してきた原則）。この原則を、スキーマのトップレベルを独立したセクション（`mapping`・`requirement_analysis`/`actual_analysis`・`automation`・`comparison`・`review`）に分けることで構造的に強制する（3節）。
3. **候補は生成してよいが確定はしない**。`automation`セクションの`comparison_mode_candidate.confirmed`は常に`false`のまま自動生成される。人間が確認した場合のみ、`review`セクション側で`confirmed: true`にする（両者は独立フィールドであり、`automation`側の値を書き換えない）。
4. **B側の表示ID（`matcher_id`）を永続キーにしない**（`baseline_v1_handoff.md` §7.4・§4不変条件6）。
5. **候補配列をB側レコード直下に生の配列として埋め込まない**（`baseline_v1_handoff.md` §4不変条件7・§7.3）。この原則から、格納方式を2節で決定する。
6. **識別子はすべて内容から導出し、抽出順序・処理順序に依存させない**（`-rc1`で追加。2.0節参照）。

## 2. 格納方式の決定：独立ファイルとしてのsidecar

`trace-comparison/1.0-rc1`のレコード群は、**B側（あるいはA側）の照合用JSONに埋め込む配列フィールドとしてではなく、独立した1つのJSONファイル（あるいはトップレベルオブジェクト）として格納する**。

理由：
- `json_ab_trace_matching_tool_v12.1.15.html`の`findRecordArrays()`は、`_trace_records`を最優先で採用するよう修正済み（`baseline_v1_handoff.md` §7.4・コミット`1044efb`）だが、これは「今回確認した特定の混入パターン」への対処であり、一般にB側レコード直下へ大きな配列を追加すること自体を安全と保証するものではない（多重防御の観点から、独立ファイルにする方が確実）。
- 独立ファイルであれば、`trace-comparison/1.0-rc1`は照合エンジンの読み込みパス（`prepareInputData()`→`extractRecordList()`）を一切通らない。既存の照合結果に影響を与えず、後付け・削除・再生成が自由にできる。
- `requirement_ref.trace_id`／`actual_ref.trace_id`でA側・B側の元レコードを直接参照するため（4節）、独立ファイルであっても対応関係は失われない。

### 2.0 再現性情報（必須修正：source hash・ruleset・閾値の欠落への対応）

トップレベルに、この`trace-comparison/1.0-rc1`ファイルがどの入力・どのルールセットから生成されたかを記録する`provenance`を持たせる。`quantity-annotation/1.0-rc1`（`shadow_mode_integration_design.md` §2.1）の`dataset_signature`・`generator`・`ruleset_version`をそのまま引き継ぐ。

> **ハッシュアルゴリズムの訂正**：当初`json_ab_trace_matching_tool_v12.1.15.html`の`simpleHash()`（32-bit FNV-1a、10451行目）を`dataset_signature`/`content_hash`/`quantity_id`へ流用する設計にしていたが、レビューで「32-bit空間では取り違え・陳腐化検出用の完全性ハッシュとしては不十分」との指摘を受けた。実際に`simpleHash()`をそのまま使い、類似構造のランダム入力を生成する検証で、9万件程度で衝突が発生することを確認した（誕生日のパラドックスにより32-bitハッシュでは`2^16`＝約6.5万件が理論的な目安であり、想定される実データ規模で現実に起こり得る）。この結果を受け、`content_hash`/`quantity_id`/`dataset_signature`にはSHA-256を採用する。ブラウザ側は`spec_to_json_conversion_tool_v1.18.html`に既存の`v12Sha256()`（`crypto.subtle.digest('SHA-256', ...)`、`crypto.subtle`が使えない環境向けの純JS版`v12Sha256Fallback()`も既に実装済み、5732〜5738行目）をそのまま3ツール共通のユーティリティとして再利用する。Node側の検証（`trace_comparison_example_verification.js`）では組み込みの`crypto.createHash('sha256')`を使用した。`simpleHash()`自体は、既存の`datasetSignature`（UI表示用の軽量フィンガープリント、完全性保証を要求しない用途）としては元の用途のまま使い続けてよく、変更は不要である。

```json
{
  "schema_version": "trace-comparison/1.0-rc1",
  "generated_at": "2026-07-19T06:30:00Z",
  "generator": { "tool": "quantity_extraction_prototype.js + semantic_mapping_prototype.js", "version": "v2.14 / v2.19" },
  "source": {
    "requirement_file": "customer_hvac_requirements_trace.json",
    "actual_file": "JSON_B_design_review_trace.json"
  },
  "provenance": {
    "hash_algorithm": "SHA-256",
    "normalization": "NFC正規化後、全角ASCII→半角変換(quantity_extraction_prototype.jsのnormalizeText1to1と同一処理)を適用したテキストをハッシュ対象とする",
    "requirement_dataset_signature": "QA-SHA256:9f1c2ab0e3d7...(64hex)",
    "actual_dataset_signature": "QA-SHA256:2e7bb114ac09...(64hex)",
    "matching_dataset_signature": "DS:4b6ad0e9:A4:B5",
    "ruleset_version": {
      "quantity_extraction": "v2.14",
      "semantics_rules": "v2.19",
      "auto_applicable_thresholds": { "modeConfidence": 0.4, "margin": 0.2, "propertyConfidence": 0.7 }
    }
  },
  "not_analyzed": [ /* shadow_mode_integration_design.md §3.4。段階(次元一致/意味一致/条件整合等)によって粒度が異なる: 次元不一致(段階1、実装済み)は次元バケット単位の圧縮監査記録、それ以外(段階2以降、未実装)は除外された数量IDペア単位の個別リスト */ ],
  "comparisons": [ /* 3節のレコード形。1要求数量×1実仕様数量 = 1レコード */ ]
}
```

- `hash_algorithm`：`content_hash`/`dataset_signature`（完全性検出用、64桁＝256-bitのまま切り詰めない）で使ったアルゴリズム名。
- `id_hash_algorithm`：`quantity_id`（検索・参照用途、衝突耐性より簡潔さを優先し128-bitへ切り詰める）で使ったアルゴリズム名。`"SHA-256/128"`のように、元アルゴリズムと切り詰め後のビット数を明示する表記にする（完全な256-bit値と切り詰め値を`hash_algorithm`の文字列だけで区別できない、という指摘への対応）。
- `normalization`：ハッシュ対象のテキストへどの正規化を適用したか。正規化方式が変わると同じ実質内容でもハッシュ値が変わってしまうため、方式自体を記録しておく。
- `requirement_dataset_signature`/`actual_dataset_signature`：要求側・実仕様側それぞれの`quantity-annotation/1.0-rc1`ファイルの`dataset_signature`をそのまま転記する。取り違え検出の根拠として、生成時点の値を固定で残す（後から照合エンジン側で再計算した値と比較することで、5節で述べる整合性チェックの記録にもなる）。
- `matching_dataset_signature`：`json_ab_trace_matching_tool_v12.1.15.html`の`currentDatasetSignature()`（10458行目、`simpleHash()`ベース）が返す値をそのまま転記する。これは「今ロードしているA/Bデータの組み合わせを表示上区別する」用途の既存機能を流用しているだけであり、取り違え検出そのものは`requirement_dataset_signature`/`actual_dataset_signature`（SHA-256）側で行う。
- `ruleset_version`：`AUTO_APPLICABLE_THRESHOLDS`のような閾値を含む。閾値が変わると同じ入力でも`automation.auto_applicable`の結果が変わり得るため、どの閾値で生成された結果かを追跡できるようにする。
- **ハッシュ対象の範囲**：`content_hash`は本文だけでなく、`shadow_mode_integration_design.md` §2.0で定義するとおり、タグ・列見出し・行識別情報も含めて計算する（本文だけでは、タグや列見出しを変更しても古い意味候補が有効に見えてしまうというレビュー指摘への対応）。

## 3. レコード形（フィールド定義）

1レコードは、ある要求側数量とある実仕様側数量の1ペアに対応する。

```
comparison_id           string        必須。 requirement_ref.trace_id + "::" + actual_ref.trace_id + "::" + quantity_pair_id
requirement_ref          object        必須。4節参照
actual_ref                object        必須。4節参照
quantity_pair_id         string        必須。2.1節参照（内容から導出、順序に依存しない）
relationship              object        必須。5節参照（このA-Bペアがどう結び付けられたか。数量の意味・比較結果は含まない）
requirement_analysis      object        必須。6節参照（要求側の数量抽出＋意味候補。confirmedしない）
actual_analysis            object        必須。6節参照（実仕様側の数量抽出＋意味候補。confirmedしない）
mapping                    object        必須。7節参照（設計特性対応。候補配列＋縮約結果。confirmedしない）
automation                 object        必須。8節参照（comparisonMode候補導出＋auto_applicable安全ゲート。confirmedしない）
comparison                  object|null   9節参照（automation.auto_applicable.applicable===trueの場合のみ非null）
review                       object        必須。10節参照（人間確認状態。confirmed:trueを持てるのはここだけだが、確認範囲を明示する）
```

### 2.1 `quantity_pair_id`の導出規則（必須修正：順序依存の解消）

初版では`"q1"`, `"q2"`のような連番を例示していたが、これは抽出順序が変わると同じ内容のペアでも別IDになってしまう欠陥があった。次に`[trace_id, source_field, occurrence_index, normalized_text]`の内容ハッシュへ変更したが、`occurrence_index`自体が`extractQuantities()`の出力順序から付与される値であるため、真の意味で順序非依存になっていない、との再指摘を受けた。

`quantity_extraction_prototype.js` v2.14で、`extractFromSentence()`が内部で計算していた原文中の絶対文字位置（`absStart`/`absEnd`）を`source_span: { start, end }`として正式に戻り値へ含めるよう修正した（`quantity_extraction_prototype.md` 5.17節）。これにより、`occurrence_index`という間接的な位置特定を使わず、`source_span`を直接使って`quantity_id`を導出できる：

```
quantity_id = sha256([trace_id, source_field, source_span.start, source_span.end, normalized_text].join(""))の先頭32桁(128-bit、id_hash_algorithm:"SHA-256/128")
quantity_pair_id = requirement_analysis.quantity_id + "::" + actual_analysis.quantity_id
comparison_id     = requirement_ref.trace_id + "::" + actual_ref.trace_id + "::" + quantity_pair_id
```

`source_span`は原文中の出現ごとに一意な絶対位置であるため（同一表記が複数回出現しても異なる`source_span`を持つ）、`quantity_id`は`_trace_records`や数量の再抽出順序が変わっても、同じ内容・同じ位置の数量には同じ値になる。`quantity_extraction_prototype.js`側で、同一表記が2回出現する文（「入口温度は50 ℃、出口温度は50 ℃とする。」）で2件の数量がそれぞれ異なる`source_span`を持つことを回帰テストで確認済み。

**原文が変わった場合にIDを維持しようとしない**：`source_span`は原文の文字位置に依存するため、原文自体が編集されると（挿入・削除で後続の位置がずれる等）同じ数量でも`quantity_id`が変わり得る。これは意図的な設計である——無理にIDを安定させようとするより、`content_hash`の不一致（`shadow_mode_integration_design.md` §3.3）で陳腐化を検出し、比較を止める方が安全側に倒れる。原文変更後の数量が「同じ数量の続き」なのか「別の数量」なのかは、レビューを新規候補として提示し、人間が判断する（自動では引き継がない、`shadow_mode_integration_design.md` §2.0）。

### 4. `requirement_ref` / `actual_ref`（`baseline_v1_handoff.md` §7.4で確定済みの契約をそのまま採用）

```json
{
  "requirement_ref": {
    "trace_id": "req-cooling-capacity",
    "matcher_id": "req-cooling-capacity"
  },
  "actual_ref": {
    "trace_id": "design-cooling-capacity",
    "matcher_id": "6",
    "source_row": 6
  }
}
```

> **訂正**：以前の版では`actual_ref.trace_id`の例に`"design-use-temperature"`を使っていたが、これは`samples/hvac_trace_sample_small/JSON_B_design_review_trace.json`上「使用温度範囲」（0〜50 °C）のレコードであり、冷房能力（12.5 kW）の値は持たない。`requirement_ref`（冷房能力の要求）と組み合わせると参照先が矛盾する不整合な例だった（レビュー指摘、実データで確認して修正）。正しくは`"design-cooling-capacity"`（実際に「周囲温度50 °Cで12.5 kW」を持つレコード）を使う。`matcher_id`/`source_row`も、実際にPlaywrightで照合した結果（`runtime_fixtures/verification_log.json`の`traceMatrixRows`）から転記した実値（`"6"`）に修正した。

- `trace_id`：主キー。元のPDF/Excel照合用JSON（`chapter-section-trace-v1`/`excel-row-trace-v1`）の`trace_id`をそのまま使う。
- `matcher_id`：照合エンジンが表示する`A_ID`/`B_ID`。表示対応にのみ用いる、永続参照には使わない。
- `source_row`（`actual_ref`のみ、あれば）：Excel側`source_row`。人間がレビュー時に元のExcel行を探す助けとして残す（任意）。
- **照合行から元レコードを引く具体的な契約**（`traceMatrixRows`側にどの4フィールドを保持させるか等）は`shadow_mode_integration_design.md` §3.2に記録した。`trace_id`重複・元レコード欠落・A未対応/B未参照・重複マッチの4ケースの挙動も同節を参照。**この契約自体は設計のみで、`json_ab_trace_matching_tool_v12.1.15.html`側にはまだ実装されていない**（未実装であることを明示する）。

### 5. `relationship`（A-Bペアの結び付き。数量の意味・比較結果は含まない）

このA側レコードとB側レコードがなぜペアとして扱われているかの由来を記録する。**既存の照合エンジンの「分類」（対応あり/要確認/etc.、`traceMatrixRows`の`分類`列）と同じ語彙を再利用する**が、これは「テキスト・タグの類似度に基づく対応判定」であり、数量比較の充足可否とは無関係（`baseline_v1_handoff.md` §7.2.3で確認済み）。この区別を保つため、`relationship`と`comparison`は別フィールドのままにする。

```json
{
  "relationship": {
    "source": "matching_engine",
    "match_method": "tag",
    "match_confidence": 0.88,
    "review_category": "要確認",
    "linked_at": "2026-07-19T06:00:00Z"
  }
}
```

- `source`：`"matching_engine"`（既存照合結果から自動導出）／`"manual"`（人間が個別に対応付けた場合）／`"ambiguous_trace_id"`（`trace_id`重複を検出、`shadow_mode_integration_design.md` §3.2）。
- `match_method`/`match_confidence`：`source==="matching_engine"`の場合、`calcPairMatch()`が返した値をそのまま転記する（`exact`/`code`/`model`/`synonym`/`fuzzy`/`vector`/`tfidf`/`tokenJaccard`）。テキスト類似度スコアであり、数量が満たされているかとは無関係であることに注意（誤解を招くフィールド名を避けるため、あえて`confidence`ではなく`match_confidence`という名前にしている）。
- `review_category`：既存UIの「分類」列の値（`未レビュー`/`対応あり`/`部分対応`/`要確認`/`誤対応`/`未対応`/`対象外`）をそのまま参照用に持つ（このsidecarが上書きすることはない。読み取り専用の参照）。

上記の`match_method: "tag"`/`match_confidence: 0.88`/`review_category: "要確認"`は、実際に`samples/hvac_trace_sample_small/`をPlaywrightで照合した結果（`runtime_fixtures/verification_log.json`の`traceMatrixRows`、`A_ID: "req-cooling-capacity"`と`B_ID: "6"`のペア）から転記した実値。`linked_at`のみ、その記録にタイムスタンプが含まれていなかったため例示用の仮値。

### 6. `requirement_analysis` / `actual_analysis`（数量抽出＋意味候補。confirmedフィールドを持たない）

`quantity-annotation/1.0-rc1`（`shadow_mode_integration_design.md` §2.1）の`analyses[]`の1件をそのまま転記する。

```json
{
  "requirement_analysis": {
    "quantity_id": "q-be1c0825cbf56b0f",
    "source_field": "source_raw_text",
    "occurrence_index": 0,
    "source_span": { "start": 18, "end": 23 },
    "content_hash": "92e148aaaf322f2d",
    "quantity": {
      "source_text": "12 kW",
      "source_span": { "start": 18, "end": 23 },
      "normalized_text": "12 kW",
      "quantity": { "kind": "interval", "lower": { "value": 12, "inclusive": true }, "upper": null },
      "unit": { "source": "kW", "canonical": "kW", "dimension": "power",
                 "standard_ref": { "standard": "JIS Z 8000-4", "category": "mechanics" } },
      "condition_candidates": [
        { "source_text": "50 °C", "source_span": { "start": 4, "end": 9 },
          "quantity": { "kind": "interval",
            "lower": { "value": 50, "inclusive": true }, "upper": { "value": 50, "inclusive": true } },
          "unit": { "source": "°C", "canonical": "degC", "dimension": "temperature",
                     "standard_ref": { "standard": "JIS Z 8000-5", "category": "thermodynamics" } },
          "confidence": 0.7 }
      ],
      "extraction": { "confidence": 0.95, "warnings": [] }
    },
    "semantics_candidates": [
      { "value": "acceptable_region", "confidence": 0.6,
        "evidence": [ { "type": "keyword", "weight": 0.45 }, { "type": "quantity_shape", "weight": 0.15 } ] },
      { "value": "unknown", "confidence": 0.15,
        "evidence": [ { "type": "baseline", "weight": 0.15 } ] }
    ]
  }
}
```

**`source_span`は`quantity_extraction_prototype.js` v2.14以降、実際に`null`ではなく実値が返る**（2.1節参照。以前の版では未実装のため`null`を例示していたが、原文中の絶対文字位置を返す実装が既に入っている）。`actual_analysis`も同型（実仕様側）。**このセクションは`quantity-annotation/1.0-rc1`の生出力であり、`confirmed`フィールドを持たない**（候補は候補のまま、確定は`review`セクションでのみ行う、という1節原則2の直接的な実装）。`content_hash`は`shadow_mode_integration_design.md` §3.3の取り違え・陳腐化検出にそのまま使う（比較レコード組み立て時点の再計算値と突き合わせる）。上記の値はすべて`trace_comparison_example_verification.js`が実データ（`req-cooling-capacity`）から実際に計算した値をそのまま転記している（11節参照）。

### 7. `mapping`（設計特性対応。候補配列から単一結論への縮約過程を明示する）

初版は単一の`concept_id`を直接持つ設計だったが、`generatePropertyCandidates()`（`semantic_mapping_prototype.js` 484行目）は候補の配列を返すため、複数候補がある場合にどれを採用するかの規則が必要だった。`evaluateAutoApplicable()`が`requirementCandidates`/`actualCandidates`に既に適用している「上位候補と次点候補の差（`marginOf()`）が閾値以上かどうか」という判定パターンを、`property_candidates`にもそのまま適用する（`shadow_mode_integration_design.md` §7）。

```json
{
  "mapping": {
    "status": "resolved",
    "concept_id": "performance.cooling_capacity",
    "confidence": 0.99,
    "margin": 0.39,
    "candidates": [
      { "concept_id": "performance.cooling_capacity", "confidence": 0.99, "evidence": ["単位次元一致: power", "周辺語: 冷房能力", "タグ: 冷房能力"] },
      { "concept_id": "environment.ambient_operating_temperature", "confidence": 0.6, "evidence": ["周辺語: 周囲温度", "タグ: 使用温度"] }
    ],
    "source": "generatePropertyCandidates",
    "confirmed": false
  }
}
```

- `status`：`"resolved"`（最上位候補の確信度が閾値`AUTO_APPLICABLE_THRESHOLDS.propertyConfidence`以上、**かつ**上位候補と次点候補の差(`marginOf()`)が閾値`AUTO_APPLICABLE_THRESHOLDS.margin`以上）／`"unavailable"`（候補が1件もない）／`"ambiguous"`（候補は1件以上あるが`resolved`の条件を満たさない：確信度不足、または次点候補との差が僅少）。
- `status: "ambiguous"`または`"unavailable"`の場合、`concept_id`は`null`、`margin`は算出できた値のみ入れる（候補0件なら`null`）。この場合、`automation.auto_applicable`の計算へは進まず、`fail_reasons`に`"設計特性の対応が一意に決まらない"`を追加する（8節）。

> **訂正（Phase B-2.2a実装、2026-07-20）**：上記は当初`"resolved"`／`"ambiguous"`の2状態のみで、「候補が1件以下」を一律`"ambiguous"`とする曖昧な規則だった。実装（`quantity_sidecar_binding_core.js`の`generatePropertyResolutions()`）にあたり、「候補0件」（そもそも対応する概念が見つからない）と「候補はあるが確信度・差が不十分」（見つかったが確定できない）は診断として区別すべきと判断し、`"unavailable"`／`"ambiguous"`の3状態へ分けた。また、`marginOf()`は候補が1件のみのとき「その候補自身のconfidence」を返す実装（`semantic_mapping_prototype.js` 400〜404行目）であるため、`margin`閾値だけで判定すると、周辺語一致1件だけ（confidence 0.35程度）のような弱い単独候補が`margin(0.2)`をやすやすと超えて`resolved`になってしまう欠陥がある。これを避けるため、既存の2つの閾値（`margin`・`propertyConfidence`）を両方満たすことを`resolved`の条件にした——`propertyConfidence`(0.7)が絶対的な強さの下限、`margin`(0.2)が複数候補時の相対的な明確さの下限として、それぞれ別の役割を持つ。新しい閾値は発明していない。回帰テストは`quantity_property_candidate_verification.js`（28件、僅差候補・弱い単独候補いずれも`resolved`にしないことを個別に確認、実fixtureでのend-to-end確認を含む）。
- `candidates`：`generatePropertyCandidates()`の全候補を保持する（縮約前の情報を消さない。監査・再レビュー用）。上記の値は`trace_comparison_example_verification.js`が実データ（`design-cooling-capacity`）から実際に計算した結果（`CONCEPT_DICTIONARY`の実在する2エントリ）である。**次点候補が「無関係な温度の概念」ではなく実際に本レコードに含まれる「周囲温度」（条件節の値）である点が重要**：`検討結果`セルの値だけを周辺語コンテキストに使うと、この2候補の差はわずか0.05しかなく`status: "ambiguous"`になってしまうことを実データで確認した（11節）。行内の他フィールド（`設計項目`列や列見出し自体）を周辺語コンテキストに含めることで、`confidence`が0.99まで上がり`margin`が確保される。
- `source`：本体統合時は`generatePropertyCandidates()`の実出力を使う（`CONCEPT_DICTIONARY`・`groupByTopConcept()`はHVACサンプル限定のたたき台であり、本体の概念辞書は別途用意する必要がある、`baseline_v1_handoff.md` §8末尾の注記を参照）。

この`margin`ベースの縮約を使うには、`evaluateAutoApplicable()`のシグネチャを`propertyConfidence`（スカラー）から`propertyCandidates`（配列）へ変更する必要がある（プロトタイプ側の未実装事項、`shadow_mode_integration_design.md` §7・§8に記録）。

### 8. `automation`（comparisonMode候補導出＋安全ゲート。ここで初めて「比較してよいか」を判定する）

```json
{
  "automation": {
    "comparison_mode_candidate": {
      "value": "point_in_region",
      "confidence": 0.6,
      "derived_from": { "requirement_semantics": "acceptable_region", "actual_semantics": "achieved_point" },
      "confirmed": false
    },
    "auto_applicable": {
      "applicable": true,
      "reasons": [
        "comparison_mode確信度0.60が閾値0.4以上",
        "要求側候補の差0.45が閾値0.2以上",
        "実仕様側候補の差0.60が閾値0.2以上",
        "否定根拠なし", "抽出警告なし",
        "設計特性の対応確信度0.99が閾値0.7以上"
      ],
      "fail_reasons": []
    }
  }
}
```

上記`reasons`の最後の1件（`"設計特性の対応確信度0.99が閾値0.7以上"`）は、`evaluateAutoApplicable()`の**現行の**シグネチャ（`propertyConfidence`をスカラーで受け取る）による実際の出力をそのまま転記している。7節の`margin`ベースの縮約（`propertyCandidates`配列を受け取るシグネチャへの変更）は未実装のプロトタイプ側の作業であり、実装後は`"設計特性の対応が一意に決まっている(margin 0.39が閾値0.2以上)"`のような文言に変わる見込み（未確認）。

`deriveComparisonModeCandidate()`・`evaluateAutoApplicable()`の出力をそのまま転記する。`baseline_v1_handoff.md` §4の安全条件は、すべてこの`auto_applicable.applicable`の計算過程で保証される。**このセクションのどのフィールドも`confirmed: true`にはならない**（`comparison_mode_candidate.confirmed`は常に`false`で生成され、書き換えは行わない。人間確認は`review`セクションで別に記録する）。

### 9. `comparison`（数値比較結果。`automation.auto_applicable.applicable===true`の場合のみ存在）

```json
{
  "comparison": {
    "comparable": true,
    "provisional": true,
    "comparison_mode": "point_in_region",
    "assumptions": ["同じ設計特性として選択済み", "同じ運転条件", "単位換算不要"],
    "satisfied": true,
    "lowGap": 0.5,
    "highGap": null,
    "boundaryMismatch": { "lower": false, "upper": false },
    "extractionWarnings": []
  }
}
```

`coverageGap()`の出力をそのまま転記する。`automation.auto_applicable.applicable === false`の場合、このフィールドは`null`とする（理由は`automation.auto_applicable.fail_reasons`側だけを参照させる）。`provisional: true`は常にこの値のまま自動生成され、`review.confirmed`とは独立している。

### 10. `review`（人間確認状態。判断対象ごとに分解し、依存関係を持たせる）

**改訂経緯**：当初`confirmed: true/false`の単一フラグだった設計を、`confirmed_targets`（配列）で確認済み範囲を明示する設計に直した（`938ccf7`）。しかしこれにも、(a) 数量抽出・単位・条件整合が確認対象に含まれない、(b) 配列という形のため`["satisfied"]`だけを含む（設計特性や比較方向を確認せずに充足だけ確認済みにできる）という矛盾した状態を表現できてしまう、(c) `verdict: "not_applicable"`の場合`satisfied`自体が存在しないのに、全体`confirmed`の条件は3対象すべての確認を要求しており状態モデルが矛盾する、という指摘を受けた。判断対象ごとに**独立したオブジェクト**へ変更し、依存関係を明示する。

```json
{
  "review": {
    "quantity_extraction": { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
    "property_mapping": { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
    "condition_equivalence": { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
    "comparison_mode": { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
    "satisfaction": { "status": "not_eligible", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null }
  }
}
```

5つの判断対象と、それぞれの`status`が取り得る値：

| 判断対象 | 確認する内容 | `status`の取り得る値 |
|---|---|---|
| `quantity_extraction` | `requirement_analysis.quantity`/`actual_analysis.quantity`の抽出が正しいか（誤読・誤分割等がないか） | `unreviewed` / `reviewed` |
| `property_mapping` | `mapping.concept_id`（両側が同じ概念について話しているか）が正しいか | `unreviewed` / `reviewed` |
| `condition_equivalence` | 双方の`condition_candidates`が実質同じ条件を指しているか（例：要求側「周囲温度50 °C」と実仕様側「周囲温度50 °C」が同一条件と言えるか） | `unreviewed` / `reviewed` / `not_applicable`（条件候補が片方または両方にない場合） |
| `comparison_mode` | `automation.comparison_mode_candidate.value`（比較の向き・意味）が正しいか | `unreviewed` / `reviewed` |
| `satisfaction` | `comparison.satisfied`（充足しているかどうかの結論）が正しいか | `not_eligible`（前提の確認が終わっていないため確認不可） / `unreviewed`（前提確認済み、確認待ち） / `reviewed` / `not_applicable`（`comparison === null`、そもそも比較していない） |

**依存関係（必須）**：`satisfaction`は、`quantity_extraction`・`property_mapping`・`comparison_mode`の3つがすべて`status: "reviewed"`になるまで`status: "not_eligible"`のまま固定する（UIはこの間、充足の確認操作自体を無効化する）。`condition_equivalence`は`not_applicable`な場合を除き同様に前提へ含める。これにより、レビューが指摘した「設計特性と比較方向を確認せず、充足だけ確認済みにできる」という不整合状態は構造的に作れなくなる。

**`comparison === null`（`automation.auto_applicable.applicable === false`）の場合**：`satisfaction`は最初から`status: "not_applicable"`で初期化する（`not_eligible`ではない。前提が整っても確認しようがないため）。この場合、`quantity_extraction`／`property_mapping`／`comparison_mode`のうちどれが原因で`applicable: false`になったかは`automation.auto_applicable.fail_reasons`を見て判断する（レビュー対象は変わらず提示してよい。原因箇所の確認自体は無意味ではない）。

**`verdict`の語彙**：`quantity_extraction`/`property_mapping`/`comparison_mode`/`condition_equivalence`は`"accept"`（自動候補をそのまま採用）／`"correct"`（人間が修正した値を採用、`note`に修正内容を記録）のいずれか。`satisfaction`は`"accept"`（`comparison.satisfied`をそのまま採用）／`"override_satisfied"`（人間が満たすと判断）／`"override_unsatisfied"`（人間が満たさないと判断）のいずれか。既存UIの「分類」語彙（`relationship.review_category`）とは意図的に別語彙にしている（4節で述べた理由と同じ：対応可否と充足可否は別の関心事）。

**全体`confirmed`は保存フィールドではなく、常に導出する**：

```
all_confirmed =
  quantity_extraction.status === "reviewed" &&
  property_mapping.status === "reviewed" &&
  (condition_equivalence.status === "reviewed" || condition_equivalence.status === "not_applicable") &&
  comparison_mode.status === "reviewed" &&
  (satisfaction.status === "reviewed" || satisfaction.status === "not_applicable")
```

この値をレコードへ`review.confirmed`のような形で**永続化してはいけない**（5つの`status`のいずれかを後から変更した際、保存された`confirmed`が古いまま残る二重管理を防ぐため）。UI表示や絞り込みが必要な場面では、読み込み時にこの式で都度計算する。

## 11. 完全な具体例（実データから機械生成・機械検証済み）

**改訂経緯**：初版は`baseline_v1_handoff.md` §9の手打ちサンプルと実ブラウザ検証のtrace_idを組み合わせて作られており、`actual_ref.trace_id`と`actual_analysis.quantity`が実際には無関係という不整合があった。次の改訂で機械生成スクリプトへ差し替えたが、再レビューで(a) スクリプトが出力する`review`が旧構造のままで現行§10と食い違っている（文書側だけ手修正されていた）、(b) `content_hash`/`quantity_id`をどちらも同じ16桁に切り詰めており、`hash_algorithm: "SHA-256"`という表記と矛盾する、(c) `content_hash`の対象が本文のみでタグ・列見出しを含んでいなかった、(d) `relationship`の値が実際にはfixtureから読み込まれておらず定数として埋め込まれていた、という4点を指摘された。

`trace_comparison_example_verification.js`を改修し、次を反映した：`review`を現行§10の5判断構造で生成する、`content_hash`は完全性検出用として64桁（256-bit、切り詰めない）、`quantity_id`は検索用途として32桁（128-bit、`id_hash_algorithm: "SHA-256/128"`で明示）、ハッシュ正規化は`spec_to_json_conversion_tool_v1.18.html`の`v12Normalize()`（NFKC正規化＋改行統一＋行末空白除去＋空白圧縮＋trim）と同一処理に統一、`content_hash`の対象にタグ・列見出し・`source_row`を含める（タグ・列見出しを個別に変更するとハッシュが変わることをテストで確認）、`relationship`は`runtime_fixtures/verification_log.json`・`matching_result_actual.json`から`trace_id`同士を突き合わせて機械的に解決する（該当行が0件・複数件なら失敗にする）。

さらに、**本ドキュメントの§11に埋め込まれたJSONと、スクリプトの生成物が実際に一致しているかを検証するテストを追加した**（`generated_at`等の実行毎に変わる値は比較から除外）。これにより、今回のような「文書側だけ手修正されて生成物と乖離する」問題を今後は自動検出できる。32件のアサーション（deep-equal検証を含む）は`node tools/design_notes/trace_comparison_example_verification.js`で再実行できる。出力は`tools/design_notes/runtime_fixtures/trace_comparison_example_verified.json`。

要求側`req-cooling-capacity`（PDF、trace_text:「周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。」）と、実仕様側`design-cooling-capacity`（Excel、`検討結果`列:「周囲温度50 °Cで12.5 kW」）を実際に照合した結果（**この節のJSONは`trace_comparison_example_verification.js`の生成物とdeep-equalであることをテストで検証済み**）：

```json
{
  "schema_version": "trace-comparison/1.0-rc1",
  "generated_at": "2026-07-19T09:19:05.604Z",
  "note": "trace_comparison_example_verification.jsにより実データ(samples/hvac_trace_sample_small/)から機械的に生成・検証済み。relationshipもruntime_fixtures/*.jsonから機械的に解決した(手打ちの値は含まない)。",
  "source": {
    "requirement_file": "JSON_A_customer_requirements_trace.json",
    "actual_file": "JSON_B_design_review_trace.json"
  },
  "provenance": {
    "hash_algorithm": "SHA-256",
    "id_hash_algorithm": "SHA-256/128",
    "normalization": "v12Normalize相当(NFKC正規化+改行統一+行末空白除去+空白圧縮+trim)",
    "requirement_dataset_signature": null,
    "actual_dataset_signature": null,
    "matching_dataset_signature": "DS:4b6ad0e9:A4:B5"
  },
  "not_analyzed": [],
  "comparisons": [
    {
      "comparison_id": "req-cooling-capacity::design-cooling-capacity::q-d877af7681166f129dfa4f6fa4cbd5ca::q-adc7c0a5e1023bd5025e451c725eb983",
      "requirement_ref": { "trace_id": "req-cooling-capacity", "matcher_id": "req-cooling-capacity" },
      "actual_ref": { "trace_id": "design-cooling-capacity", "matcher_id": "6", "source_row": 6 },
      "quantity_pair_id": "q-d877af7681166f129dfa4f6fa4cbd5ca::q-adc7c0a5e1023bd5025e451c725eb983",
      "relationship": {
        "source": "matching_engine", "match_method": "tag", "match_confidence": 0.88,
        "review_category": "要確認", "linked_at": null
      },
      "requirement_analysis": {
        "quantity_id": "q-d877af7681166f129dfa4f6fa4cbd5ca", "source_field": "source_raw_text", "occurrence_index": 0,
        "source_span": { "start": 18, "end": 23 },
        "content_hash": "7317516c674b1f49070dc4e0d08321e95de1ed3f7e40447783fe32c318db8a24",
        "quantity": {
          "source_text": "12 kW", "source_span": { "start": 18, "end": 23 }, "normalized_text": "12 kW",
          "quantity": { "kind": "interval", "lower": { "value": 12, "inclusive": true }, "upper": null },
          "unit": { "source": "kW", "canonical": "kW", "dimension": "power",
                     "standard_ref": { "standard": "JIS Z 8000-4", "category": "mechanics" } },
          "context": { "property": null, "subject": null, "state": null, "tokens": [] },
          "extraction": { "confidence": 0.95, "warnings": [] },
          "condition_candidates": [
            { "source_text": "50 °C", "source_span": { "start": 4, "end": 9 },
              "quantity": { "kind": "interval", "lower": { "value": 50, "inclusive": true }, "upper": { "value": 50, "inclusive": true } },
              "unit": { "source": "°C", "canonical": "degC", "dimension": "temperature",
                         "standard_ref": { "standard": "JIS Z 8000-5", "category": "thermodynamics" } },
              "confidence": 0.7 }
          ]
        },
        "semantics_candidates": [
          { "value": "acceptable_region", "confidence": 0.6,
            "evidence": [
              { "type": "keyword", "value": "acceptable_region", "source_text": "周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。", "effect": "supports", "weight": 0.45 },
              { "type": "quantity_shape", "value": "acceptable_region", "source_text": "周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。", "effect": "supports", "weight": 0.15 }
            ] },
          { "value": "unknown", "confidence": 0.15,
            "evidence": [ { "type": "baseline", "value": "unknown", "source_text": "(既定の受け皿。他候補が弱い場合の下限)", "effect": "supports", "weight": 0.15 } ] }
        ]
      },
      "actual_analysis": {
        "quantity_id": "q-adc7c0a5e1023bd5025e451c725eb983", "source_field": "検討結果", "occurrence_index": 0,
        "source_span": { "start": 10, "end": 17 },
        "content_hash": "9ded8ba4feba1104c74f141478e2be01da981052351ea30cb70d574aff6fc60b",
        "quantity": {
          "source_text": "12.5 kW", "source_span": { "start": 10, "end": 17 }, "normalized_text": "12.5 kW",
          "quantity": { "kind": "interval", "lower": { "value": 12.5, "inclusive": true }, "upper": { "value": 12.5, "inclusive": true } },
          "unit": { "source": "kW", "canonical": "kW", "dimension": "power",
                     "standard_ref": { "standard": "JIS Z 8000-4", "category": "mechanics" } },
          "context": { "property": null, "subject": null, "state": null, "tokens": [] },
          "extraction": { "confidence": 0.95, "warnings": [] },
          "condition_candidates": [
            { "source_text": "50 °C", "source_span": { "start": 4, "end": 9 },
              "quantity": { "kind": "interval", "lower": { "value": 50, "inclusive": true }, "upper": { "value": 50, "inclusive": true } },
              "unit": { "source": "°C", "canonical": "degC", "dimension": "temperature",
                         "standard_ref": { "standard": "JIS Z 8000-5", "category": "thermodynamics" } },
              "confidence": 0.7 }
          ]
        },
        "semantics_candidates": [
          { "value": "achieved_point", "confidence": 0.75,
            "evidence": [
              { "type": "quantity_shape", "value": "achieved_point", "source_text": "冷房能力 / 検討結果: 周囲温度50 °Cで12.5 kW", "effect": "supports", "weight": 0.3 },
              { "type": "column_role", "value": "achieved_point", "source_text": "冷房能力 / 検討結果: 周囲温度50 °Cで12.5 kW", "effect": "supports", "weight": 0.05 },
              { "type": "keyword", "value": "achieved_point", "source_text": "冷房能力 / 検討結果: 周囲温度50 °Cで12.5 kW", "effect": "supports", "weight": 0.4 }
            ] },
          { "value": "unknown", "confidence": 0.15,
            "evidence": [ { "type": "baseline", "value": "unknown", "source_text": "(既定の受け皿。他候補が弱い場合の下限)", "effect": "supports", "weight": 0.15 } ] }
        ]
      },
      "mapping": {
        "status": "resolved", "concept_id": "performance.cooling_capacity", "confidence": 0.99, "margin": 0.39,
        "candidates": [
          { "concept_id": "performance.cooling_capacity", "label": "冷房能力", "confidence": 0.99, "evidence": ["単位次元一致: power", "周辺語: 冷房能力", "タグ: 冷房能力"] },
          { "concept_id": "environment.ambient_operating_temperature", "label": "周囲使用温度", "confidence": 0.6, "evidence": ["周辺語: 周囲温度", "タグ: 使用温度"] }
        ],
        "source": "generatePropertyCandidates", "confirmed": false
      },
      "automation": {
        "comparison_mode_candidate": {
          "value": "point_in_region", "confidence": 0.6,
          "derived_from": { "requirement_semantics": "acceptable_region", "actual_semantics": "achieved_point" },
          "confirmed": false
        },
        "auto_applicable": {
          "applicable": true,
          "reasons": [
            "comparison_mode確信度0.60が閾値0.4以上", "要求側候補の差0.45が閾値0.2以上",
            "実仕様側候補の差0.60が閾値0.2以上", "否定根拠なし", "抽出警告なし",
            "設計特性の対応確信度0.99が閾値0.7以上"
          ],
          "fail_reasons": []
        }
      },
      "comparison": {
        "comparable": true, "provisional": true, "comparison_mode": "point_in_region",
        "assumptions": ["同じ設計特性として選択済み", "同じ運転条件", "単位換算不要"],
        "satisfied": true, "lowGap": 0.5, "highGap": null,
        "boundaryMismatch": { "lower": false, "upper": false }, "extractionWarnings": []
      },
      "review": {
        "quantity_extraction": { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
        "property_mapping": { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
        "condition_equivalence": { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
        "comparison_mode": { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
        "satisfaction": { "status": "not_eligible", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null }
      }
    }
  ]
}
```

**実データで判明した重要な事実**：`検討結果`セルの値単体（「周囲温度50 °Cで12.5 kW」）だけを`mapping`・`semantics_candidates`の周辺語コンテキストに使うと、(a) `performance.cooling_capacity`と`environment.ambient_operating_temperature`のmapping候補差が0.05しかなく`status: "ambiguous"`になる、(b) `achieved_point`のkeyword根拠（「実測」等）が原文になく構造的根拠のみで`auto_applicable: false`になる、という2点を、このスクリプトの開発中に実際に確認した（詳細は`trace_comparison_example_verification.js`のコメント）。行内の他フィールド（`設計項目`列の値「冷房能力」）と列見出し自体（「検討結果」＝`ACHIEVED_POINT_KEYWORD_PATTERN`の「検討(の)?結果」に一致）を周辺語コンテキストへ含めることで、どちらも解決した。これはデータを改変したのではなく、Excel側の列見出しという既存の実データ（`source_record`のキー名）を正しく周辺語コンテキストへ含めるようにしただけであり、`shadow_mode_integration_design.md` §2.3の自動走査設計とも整合する。

`provenance.requirement_dataset_signature`/`actual_dataset_signature`（`null`）は、対応する`quantity-annotation/1.0-rc1`ファイル自体が未実装のため計算できない値であることを明示している。`matching_dataset_signature`は実際の照合結果fixture（`runtime_fixtures/review_package_actual.json`の`datasetSignature`）から転記した実値。`relationship.linked_at`は照合エンジンの実行タイムスタンプに依存する情報のため、本例では`null`とした（未実装のため）。それ以外はすべて実データから機械計算された値であり、`trace_comparison_example_verification.js`の実行で再現できる。

## 12. 4区分UI classification（人間確認の最小化）との対応

以前提案された4区分（確信度に応じたUI表示の出し分け）は、本スキーマの`automation.auto_applicable.applicable`と`mapping.status`／`mapping.confidence`の組から導出できる：

| UI区分 | 条件 |
|---|---|
| 自動非表示（確認不要） | `applicable===false` かつ（`mapping.status==="ambiguous"` または `mapping.confidence < 0.4`） |
| 参考表示のみ | `applicable===false` かつ `mapping.status==="resolved"` かつ `mapping.confidence >= 0.4`（対応はありそうだが比較モードが決まらない） |
| 確認推奨 | `applicable===true`（自動比較はしたが`review.confirmed`は常にfalseから始まる） |
| 優先確認 | `applicable===true` かつ `comparison.satisfied===false`（不適合の可能性、優先度を上げる） |

このUI区分自体はスキーマのフィールドではなく、上記フィールドからの派生値（表示層の責務）とする。スキーマに`ui_priority`のような専用フィールドを持たせないのは、1節原則2（候補は生成してよいが確定はしない）を守るため——UI優先度は表示のたびに再計算すればよく、永続化して確定させる理由がない。

## 13. 未確定・次工程

**この改訂で解決した項目**：ハッシュアルゴリズムをSHA-256へ変更（2.0節）、`source_span`をプロトタイプへ実装し順序非依存の`quantity_id`を実現（2.1節、`quantity_extraction_prototype.js` v2.14）、`review`セクションを判断対象別オブジェクト＋依存関係へ再設計（10節）、§11の具体例を実データからの機械生成・機械検証へ差し替え（11節）。Phase B-1の厳密結合と4参照ID保持、Phase B-2段階1の同一次元候補バケット／異次元監査バケットまで実装済み。

**まだ未解決の項目**：
- **shadow-mode挿入点の残作業**：`json_ab_trace_matching_tool_v12.1.15.html`への数量注釈読込み・厳密結合、4参照ID保持、次元バケット生成までは実装済み。設計特性・条件・comparison modeによる逐次絞り込み、数値比較、充足判定、`trace-comparison`正式出力は未着手。同資料§9に`-rc1`から正式版への昇格条件を記録した。
- **`evaluateAutoApplicable()`のシグネチャ変更**：7節の`mapping`縮約に必要な`propertyCandidates`配列対応（`marginOf()`パターンの適用）は、プロトタイプ側（`semantic_mapping_prototype.js`）の未実装事項。§11の例は現行シグネチャ（`propertyConfidence`スカラー）のまま生成しており、変更後の実際の出力文言は未確認。
- **Excel列の役割自動判定**：`shadow_mode_integration_design.md` §2.3参照。現行の`inferRole()`は列名の完全一致（`標準機種情報`/`検討結果`）のみに対応しており、同義の別見出しには対応しない。
- **候補・`not_analyzed`の粒度**（Phase B-2で段階1のみ解決）：同一次元候補は`candidate_buckets[]`、異次元除外は次元バケット単位の圧縮監査記録とし、段階1では数量IDペアを全件展開しない。段階2以降は候補バケットを逐次走査し、意味・条件等で個別候補を除外した場合のみ数量IDペア単位の理由を保持する。詳細は`shadow_mode_integration_design.md` §3.4参照。
- **ファイル命名・保存場所の規約**：`{requirement_file}_{actual_file}_comparison.json`のような命名規則、保存先ディレクトリは未検討。
- **スキーマのバージョニング方針**：`schema_version`のインクリメント規則（フィールド追加は何もしなくてよいか、破壊的変更のみ上げるか）は未検討。
- **`review`セクションの永続化先**：既存のレビュー状態が`localStorage`（`v11_trace_review_store`）を一次保存先としている（`baseline_v1_handoff.md` §7.2.4）のに対し、本スキーマの`review`はファイル内にフィールドとして持たせる設計にした。この不一致（一次保存先が二重に存在する）を統合時にどう扱うかは`shadow_mode_integration_design.md` §8で未解決のまま記録している。
