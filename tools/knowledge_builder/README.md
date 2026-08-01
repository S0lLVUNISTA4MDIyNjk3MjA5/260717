# Knowledge Data Builder — α0.1.2（早期評価用）

**状態**: 早期評価用の動作物。正式な設計判断・成果物提出には使用しないでください。
**準拠Contract**: `design/knowledge_data_contract_0.1.md`（Knowledge Data Contract 0.1。α0.1.2でも変更していません）

このディレクトリは Knowledge Data Builder の最初の評価可能な動作物（α0.1）を、2回の人手評価結果を
受けて改定したものです（α0.1.1 → α0.1.2）。既存α版ファイル・配布ZIP（`tools/alpha_release/`、
`tools/release/`配下）は**一切変更していません**。この配下は新規系統です。

## α0.1.2での変更点（視認性・確認効率の改善）

α0.1.1の人手評価で、次の3画面の視認性・作業効率に課題が確認され、α0.1.2で対応しました。
新しい意味解析機能の追加ではなく、既存のNode・Relation Candidate・Edgeを**人が理解しやすく、
少ない操作で確認できるようにすること**が目的です。Knowledge Data Contract 0.1は変更していません。

### 1. Knowledge Graph
- 初期表示を「採用済みの文書間関連のみ表示」に変更(以前は未処理候補も既定で表示していた)。
  未処理候補・文書内階層は明示的にチェックを入れた場合のみ表示される
- Nodeをクリックすると接続先Node・Edgeを強調表示し、選択中Nodeの情報(短縮ID・全文)を
  画面下に表示する
- 「選択Nodeの周辺だけを表示」モードを追加
- 採用済み／未処理候補／文書内階層をそれぞれ個別に表示切替できるようにした
- 文書A／文書B、Node種別、タグによるGraph絞り込みを追加
- Nodeラベルに短縮ID(`A-001`等)を併記し、長いラベルは省略・ホバーで全文表示
- document(大きい四角)／section(小さい四角)／内容Node(丸)を形状で区別し、色は文書A(青)/
  文書B(緑)で統一。structural表示ONの場合は章→節→項目の階層をインデントで表現する
  (階層の折りたたみ／展開は今回未実装。形状・サイズ・インデントによる区別を優先した)
- 色・線種・Node種別を説明する常設の凡例を追加

### 2. 文書間の関連確認画面（Relations / Edges）
- Relation CandidateをSource Node単位でグループ化し、**既定で折りたたみ**表示にした
  （234件規模でも単純な長い表として出さない）。グループ見出しをクリックすると展開できる
- グループ見出しに、そのSource Nodeの全件数・未処理数・採用数・却下数を表示
- Source／Target Nodeに短縮IDを併記し、一致したタグを強調表示
- confidenceの数値に加えて高／中／低の補助表示を追加(合否判定ではなく参考情報)
- staleのみ表示、タグ一致あり／文章類似のみの絞り込み、confidence範囲による絞り込みを追加
- 並べ替え(信頼度順／Source短縮ID順／未処理優先)を追加
- Source Node単位で候補をまとめて却下する操作を追加
- 「未処理候補を初期表示」の方針は維持。自動採用機能は追加していない

### 3. 文書内容を確認・修正する画面（旧称: ノード確認・修正画面）
- 該当件数を選んで絞り込めるクイックフィルタを追加: タグ未設定・未登録タグあり・
  低confidence・本文が空/短い・修正済み・Relation Candidateなし・stale Relationあり。
  複数選択すると、すべての条件に当てはまる項目だけを表示する（画面上部の主要件数表示を兼ねる）
- 短縮ID列を追加
- 「簡易表示／詳細表示」の切替を追加。簡易表示(既定)では状態・文書・種別・短縮ID・
  タイトル・本文・タグのみを表示し、詳細表示にすると信頼度・出典・revision・stale関連件数
  も表示される

### 4. 画面名・説明文の分かりやすさ改善（2回目の人手評価を受けて）
- 「2. ノードを確認・修正」→「**2. 文書内容を確認・修正**」に改称（英語概念名`Knowledge Nodes`は補助表記）
- 実際に行う作業を直接示す説明文へ変更し、「1. 対象を絞る → 2. 内容を確認する →
  3. 必要な項目だけ修正する」という短い作業手順の案内を追加
- 「知識の単位」「問題の可能性があるNode」「チップ」「全件を修正する必要はありません」
  （否定形で始まり次の行動が伝わりにくい）といった表現を画面から削除。Knowledge Nodeの
  用語説明は主説明に混ぜず、「一覧の各行をKnowledge Nodeと呼びます。」という一文の補足のみとした
- Relation画面の説明文もRelation/Edge/Source/Target/Candidate等の用語を一度に説明せず、
  「文書Aの各項目に対して、文書Bの関連候補を表示します。候補を開き、両方の本文と根拠を
  確認して、『採用』または『却下』を選んでください。」に簡略化。confidence/evidenceの説明は
  画面上部から表の近くへ移動した
- Knowledge Graphは2回目の人手評価で「直感的に操作でき、使いやすい」と評価されたため、
  今回変更していない

### 共通UX
- 文書Aは青系・文書Bは緑系・未処理候補は橙系・採用済みは緑の実線・staleは赤系警告で統一
- 選択中のNode／Relationの行を明確に強調表示
- 短縮IDの表記規則(`A-001`/`B-001`等)を3画面で統一
- 各画面に「フィルタ適用中」バッジと「フィルタ解除」ボタンを追加
- 表示中件数／全件数の常時表示を維持・強化

## このα0.1.2の範囲

含むもの（α0.1.1から機能面の変更なし。表示・操作性のみ改善）:

1. 既存Trace JSON投入(PDF/Excel構造化JSON) — 既存PDF/Excelツールが出力した trace JSON
   （`_trace_records[]`を持つ既存形式）を読み込む。**PDF/Excelの解析自体は追加していません**。
2. Node生成 — Trace JSON Adapter が document/section/内容Node（requirement/design_item）を生成
3. Node確認・修正 — node_type / 本文(text) / タグの編集。検索・絞り込み・クイックフィルタ・
   複数選択・タグ一括追加/削除・簡易/詳細表示切替
4. 文書間の関連の自動候補生成 — 既存タグの一致・文字列類似度に基づく semantic candidate edge の生成
5. Edge採用/却下 — candidateをactive/rejectedへ。複数選択・一括採用/一括却下・グループ単位一括却下
6. Relation一覧 — Source Node単位グループ表示(折りたたみ可)・状態/stale/evidence/confidence
   フィルタ・並べ替え
7. Knowledge Graph — 採用済み/未処理候補/文書内階層の個別表示切替、Node選択強調、周辺表示
   モード、文書/種別/タグ絞り込み、常設凡例
8. Knowledge JSON保存 — Knowledge Data Contract 0.1形式でのJSON出力
9. 作業量サマリ — 全Node数・操作対象にしたNode数・個別修正したNode数・関連候補総数・
   人が個別判断した候補数・一括採用/却下件数・最終採用済みEdge数を表示

意図的に含まないもの(次段階以降の課題。α0.1.2でも先回りして追加していません):

- AIによる本格的なSemantic Tagging、完全なQuantity統合、Property Resolution
- `satisfied_by`等の強いRelationの自動判定。タグ一致・文字列類似度だけでは「関係がありそう」
  までしか判定できず「要求を満足している」とまでは判定できないため
- AI Agentによる自律操作、Graph DB／Vector DB、PDF/Excel直接取込の統合
- 1000件級の性能最適化、Contractの全面改定
- Knowledge Graphの階層折りたたみ／展開(形状・サイズ・インデントで代替)
- Human/AIレビュー確定(`review.human`/`review.ai`)のUI(内部engineには実装済み。
  `core/knowledge_store.js`の`reviewHuman`/`reviewAI`参照)

### 短縮ID(画面表示専用)について

Node一覧・Relation一覧・Knowledge Graphで使う`A-001`/`B-001`等の短縮IDは、**画面表示専用の
別名**です。取込のたびに文書A/Bそれぞれの中で1から採番し直され、Knowledge Data Contract 0.1
のschemaには含まれません(保存するKnowledge JSONにも出力されません)。元Nodeの一意な特定は
引き続き`node_id`（Contract §8のID規則）で行います。短縮IDと`node_id`の対応は、各画面で
短縮IDにカーソルを合わせる(title属性)か、Knowledge Graph上でNodeを選択すると確認できます。

### Structural Node(document/section)とlegacy Trace互換性

`document`/`section`のStructural Nodeは既存TraceRecordSetに対応するレコードを持たない
(既存Exportは内容行のみを`_trace_records[]`として持ち、章/節そのものは別レコードにならない)。
これらのNodeは**`export_binding: null`**として生成され、既存Sidecar/照合ツールとのbinding
互換性を一切主張しない。`export_binding`が非nullの値を持つのは、既存TraceRecordの
`trace_id`/`content_hash`をそのまま引き継ぐ内容Node（requirement/design_item等）のみ。

## 使い方

1. `ui/knowledge_builder_tool_v0.1.2-alpha.html` をブラウザで直接開く(サーバ不要)
2. 「1. データを読み込む」の「文書A(requirement側)」「文書B(design側)」に、既存PDF/Excel
   ツールが出力したtrace JSONファイルを指定する。動作確認用の小規模サンプルとして
   `samples/hvac_trace_sample_small/JSON_A_customer_requirements_trace.json` /
   `JSON_B_design_review_trace.json`(リポジトリ直下)がそのまま使える。件数が増えたときの
   絞り込み・グループ表示・Graphの効果を評価する場合は下記の中規模サンプルを使うこと
3. 「読み込んでノードを生成」→「2. 文書内容を確認・修正」に一覧が表示される。上部の
   クイックフィルタで確認したい条件を選ぶと、すべての条件に当てはまる項目だけへ絞り込める
4. 「3. 文書間の関連を確認」で「関連候補を自動生成」→ Source Node単位でグループ化され、
   既定では折りたたまれている。見出しをクリックして展開し、候補を確認する
5. 「4. ナレッジグラフを確認」では、初期状態で採用済みの文書間関連だけが表示される。
   Nodeをクリックすると接続先が強調表示される
6. 「5. ナレッジデータを保存」でKnowledge Data Contract 0.1形式のJSONをダウンロードする。
   同じ画面に作業量サマリを表示する

## 中規模評価サンプル（件数が増えたときの評価用）

`samples/knowledge_builder_alpha01/medium/` に、Node/Relation Candidateが増えたときの
絞り込み・グループ表示・Graphの効果を評価するための中規模サンプル（文書A 80件・文書B 100件・
関連候補約230件規模）を同梱しています。使い方・意図的に含めたケース（同義語・略語・
タグ不足・1要求→複数設計項目等）・評価用ground truth(`expected_relations.json`)の使い方は
`samples/knowledge_builder_alpha01/medium/README.md` を参照してください。

## 評価していただきたい観点（α0.1.2）

1. 目的のNodeを短時間で絞り込めるか
2. 同名Nodeを短縮IDで識別できるか
3. Source NodeごとにRelation Candidateを比較できるか
4. confidenceとevidenceを見て候補を判断できるか
5. Graphで採用済み関係を追跡できるか
6. 選択Node周辺だけを確認できるか
7. 文書内階層と文書間関連を区別できるか
8. 多数の未処理候補によってGraphが初期状態から混雑しないか

自動Semantic Tagging(Knowledge Builder自身によるタグ自動生成)、`satisfied_by`等の強い
Relationの自動判定は今回のα0.1.2にも含まれないため評価対象外です。次Checkpoint以降で
別途評価します。

## 内部構成

```
core/
  id_hash_utils.js            ID・hash算出(§6.5/§6.6/§8)。既存quantity_sidecar_binding_core.js
                               のnormalize/hashParts/canonicalJson/computeRecordContentHashを再利用
  trace_json_adapter.js        既存trace JSON → KnowledgeNode/構造Edge(§10.1 Adapter)
  relation_candidate_engine.js タグ一致・文字列類似度によるsemantic candidate生成(§4.5)
  knowledge_store.js           Node/Edge編集・lifecycle・review・operation historyのreducer(§6.4)
                               (α0.1.2では変更なし。表示改善はUI側のみ)
verification/
  knowledge_builder_core_verification.js         Node.js検証(losslessness・dual-hash・stale判定等)
  knowledge_builder_ui_smoke_test.js              Playwright検証(小規模サンプルでのUI一連操作)
  knowledge_builder_medium_sample_smoke_test.js   Playwright検証(中規模サンプルでの規模・一括操作)
  (いずれもNODE_PATH="$(npm root -g)"が必要なものはPlaywright使用箇所のみ)
ui/
  knowledge_builder_tool_v0.1.2-alpha.html  評価用ブラウザツール本体
design/
  knowledge_data_contract_0.1.md          Knowledge Data Contract 0.1(設計文書。α0.1.2では未変更)
```

## 検証の実行方法

```
node tools/knowledge_builder/verification/knowledge_builder_core_verification.js
NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_ui_smoke_test.js
NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_medium_sample_smoke_test.js
```

いずれもリポジトリ直下の既存サンプル(`samples/hvac_trace_sample_small/`)または
`samples/knowledge_builder_alpha01/medium/`を読み込むだけで、既存ファイルへの書き込みは
行いません。
