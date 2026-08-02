# Knowledge Data Builder — α0.1.3（早期評価用）

**状態**: 早期評価用の動作物。正式な設計判断・成果物提出には使用しないでください。
**準拠Contract**: `design/knowledge_data_contract_0.1.md`（Knowledge Data Contract 0.1。α0.1.3でも変更していません）

このディレクトリは Knowledge Data Builder の最初の評価可能な動作物（α0.1）を、3回の人手評価結果を
受けて改定したものです（α0.1.1 → α0.1.2 → α0.1.3）。既存α版ファイル・配布ZIP
（`tools/alpha_release/`、`tools/release/`配下）は**一切変更していません**。この配下は新規系統です。

## α0.1.3: 文書階層の折りたたみ・表示粒度調整・Relation連携

α0.1.2の限定人手評価で、Knowledge Graphの「文書内の階層関係も表示」は直感的で分かりやすいと
評価されましたが、document/section/内容Nodeを常にすべて展開して表示するため、**文書全体 →
章・節 → 個別項目**という異なる粒度で文書構造・文書間の関係を切り替えて把握することが
できませんでした。α0.1.3では、同じKnowledge Dataを粗い粒度で全体傾向として把握し、必要な
箇所だけ展開して個別Node/Edgeまで確認できるようにする**表示粒度調整**を追加しました。
今回の対応も**表示機能のみ**で、Knowledge Node/Edge・`edge_id`・`source_node_id`・
`target_node_id`・lifecycle・freshness・confidence・evidence・relation type・採用/却下結果・
Knowledge JSON・Knowledge Data Contract 0.1は一切変更していません。折りたたみによって元の
Node/Edgeが削除・統合・置換されることはありません。

- **表示粒度の一括切替**: Knowledge Graphに「文書単位」「章・節単位」「個別項目」の3段階の
  表示粒度を追加した。文書単位ではdocument Nodeだけ、章・節単位ではdocument/section Nodeまで、
  個別項目では従来どおり内容Nodeまで表示する。文書内階層をONにしていない間は選択肢自体を
  無効化する
- **document/sectionの個別折りたたみ**: 全体粒度の切替とは別に、子Nodeを持つdocument/section
  Node(内容Nodeには表示しない)にそれぞれ展開/折りたたみのトグルを追加した。「文書Aの
  『温度条件』だけ個別項目まで展開し、他のsectionは折りたたんだまま」といった調整ができる。
  一括粒度切替後も個別調整は維持される
- **既定粒度は章・節単位**: 「文書内の階層関係も表示」を今回のNodeセットに対して初めてONに
  した場合は、章・節単位を初期粒度にする。内容Nodeを全展開した密集状態には戻らない
  (2回目以降のON/OFFでは直前の粒度・折りたたみ状態を維持する)
- **集約Edge(UI専用の表示)**: 折りたたまれた配下Node間にsemantic Edgeが存在する場合、
  画面上では複数の個別Edgeを1本の集約線としてまとめて表示する。新しいKnowledge Edgeは
  作成しない。集約線は個別Edgeと視覚的に区別できるようにし(太い線・件数ラベル・集約アイコン)、
  採用/未処理/stale等の状態が混在する場合も色だけで単一状態と誤解されない表示にした。
  各個別Edgeの接続先は、現在表示中の最も近い可視Ancestorへ対応付けて集約する
- **集約Edgeの件数・内訳**: 集約線をクリックすると、全関連件数・採用済み件数・未処理候補件数・
  却下件数・stale件数を表示する。confidenceは単純平均せず、最小〜最大の範囲を参考情報として
  表示するのみで、この値による自動採用・集約Edge自体の一括採用/一括却下は行わない。
  「集約内容を確認」で元の個別Edge(edge_id・Source短縮ID・Target短縮ID・lifecycle・
  freshness・confidence・evidence)を一覧表示できる
- **GraphからRelation画面への範囲指定**: Graph上のsection Nodeまたは集約Edgeから
  「この範囲の関連候補を確認」を実行すると、「3. 文書間の関連を確認」へ移動し、対象範囲の
  Relation Candidateだけに絞り込む。section Nodeからは配下の内容Nodeの正式なnode_id集合、
  集約Edgeからは元の正式なedge_id集合で絞り込み、文字列一致(タイトル等)は使わない。範囲指定中は
  「Graphからの確認範囲」バナーを表示し、「Graphからの範囲指定を解除」でいつでも通常の
  Relation一覧へ戻せる。文書A/文書B表示基準を切り替えても、絞り込み対象のedge_id/node_id集合は
  変わらない(候補の再生成やsource/targetの入れ替えは行わない)
- **選択状態の整合性**: 内容Nodeを選択した状態でその親sectionを折りたたむと、非表示になった
  内容Nodeの選択を解除し、代わりに折りたたんだ親sectionを選択状態にして「配下の内容Nodeを
  集約表示中」と案内する。不可視Nodeが選択されたまま残ることはない
- **既存のGraph→Node一覧ジャンプは維持**: α0.1.2の「この項目を変換結果一覧で確認」は
  そのまま動作する。構造Node配下だけへ絞り込む追加ジャンプ(「配下の内容Nodeを一覧で確認」)は
  実装コストが大きいため今回は見送り、次Checkpointの候補として残す
- 表示粒度・折りたたみ状態・集約Edgeの選択・Graphから渡した範囲・Relation画面の範囲フィルタは
  すべてUI専用の状態で、Knowledge JSON・Operation History・Human/AI Review・provenanceの
  いずれにも保存されない。文書A/Bを再取込すると、これらのUI状態はすべて初期化され、新しい
  Node集合に対して再構築される(短縮IDマッピングと同様の扱い)

## α0.1.3 是正Checkpoint: Graphフィルタ・集約表示の不具合修正 / 表記の中立化

限定人手評価への移行前の再検証で見つかった課題を修正しました。新機能の追加は行っていません。
修正はいずれも表示計算・表記のみで、Knowledge Node/Edge・Candidate生成ロジック・
Knowledge JSON・Knowledge Data Contract 0.1には影響しません。

- **章・節単位とタグフィルタの併用でGraphが空になる不具合を修正**: document/section
  Nodeは通常タグを持たないため、タグ条件をNode集合全体へ単純に適用すると、折りたたみ・集約に
  必要な構造Node(Ancestor)まで失われ、可視Nodeが1件もなくなっていた。修正後は、まずタグ条件に
  一致する内容Node同士のsemantic Edge集合を明示的に確定し、その集合の内容Nodeとその
  Ancestorだけを可視化するようにした(section/document Node自体には内容Node用のタグ条件を
  直接要求しない)。章・節単位/文書単位/個別項目のいずれの粒度でもタグフィルタが正しく機能し、
  タグフィルタはUI表示専用のため保存されるKnowledge JSON(Node/Edge集合)には一切影響しない
- **章・節単位の集約Graphで、Nodeラベル・マーカーが重なる不具合を修正**: 単純な表示領域の
  拡大・縮小ではなく、配置計算そのものを見直した。Node本体が並ぶ列とEdge描画領域を分離し
  (ラベルは常にNodeの外側、Edgeは中央のコーパス領域に接続)、Edgeの接続点をNode中心ではなく
  Node形状の境界に変更し、Nodeラベルには不透明な背景を敷いて重なりによる視認性低下を防いだ。
  自然な中点が近接/一致する複数の集約線には、決定的なレーンオフセット(安定した並べ替えキーに
  基づく対称オフセット)を割り当て、マーカー同士が重ならないようにした
- **集約マーカー横の常時件数表示を廃止(可読性優先の簡素化)**: 人手評価で「マーカー横の件数
  表示が重なる」「重なりの解消が難しければ件数表示は不要」との指摘を受け、常時表示していた
  件数テキストを削除した。集約マーカー自体・ホバー時ツールチップ(全関連件数・採用済み・
  未処理・stale件数)・クリック時の詳細パネル(内訳・confidence範囲・元Edge一覧・
  「集約内容を確認」「この範囲の関連候補を確認」)はすべて維持している。常時表示ラベルが
  減ったことで、中規模サンプル(章・節単位)でのマーカー間衝突を実ブラウザの座標情報から
  再検証し、0件であることを確認している
- **文書A/文書Bの役割固定表記を中立化**: 「文書A(requirement側)」「文書B(design側)」という
  入力欄表記は、Knowledge Data Builderが要求仕様・設計資料以外の任意の2文書間の関連確認にも
  使えることを分かりにくくしていたため、「文書A」「文書B」という中立表記に改めた。Relation画面の
  「文書Aを基準に表示」「文書Bを基準に表示」は、あくまで表示のグループ化方向を示すものであり、
  文書A=要求・文書B=設計といった固定的な意味づけは行わない。`source_node_id`/
  `target_node_id`、Aを起点とするCandidate生成方式、A/B基準切替、Edge方向、Knowledge Data
  Contract、保存JSONの仕様はいずれも変更していない。同梱の小規模/中規模サンプルが要求仕様・
  設計検討表であることは、サンプル固有の使用例として案内に残しており、製品上の入力制約では
  ないことを明記している

## α0.1.2 追加改定: Node画面の作業設計・画面間Node識別改善 / Relation表示基準切替

2回目の人手評価で、「文書内容を確認・修正」画面の説明文を簡潔化しても、利用者が
「未修正/修正済という表示が作業進捗に見える」「クイックフィルタをどの作業で使うのか
分からない」「候補生成前から『Relation候補なし』が全件に表示され問題があるように見える」
「Graphで見た短縮IDでNode一覧を検索できない」といった点で迷うことが分かりました。これは
説明文だけでなく、編集履歴・作業進捗・データ上の注意条件・Node識別情報が画面上で混同されて
いたことが原因です。今回の対応は**Node画面が中心**で、Relation画面とKnowledge Graphの
既存機能・レイアウトは変更していません（短縮IDマッピングの全画面統一の確認と、Graphからの
小規模な画面間ジャンプのみ例外的に追加）。

- **画面の目的を再定義**: 見出しを「2. 変換結果を確認・修正」に変更し、「変換結果に明らかな
  誤りがある項目だけを修正します。該当する項目がなければ、この画面の作業は完了です。」という
  説明文にした。「全件を確認する」「全件を確認済みにする」という前提を作らない
- **状態列（旧: 未修正/修正済）の位置づけを修正**: 簡易表示では状態列自体を非表示にした。
  詳細表示でのみ「編集履歴」列として表示し、値も「変更なし」（通常の状態であり未完了ではない）/
  「変更あり」（今回のセッションで編集したことのみを示し、確認済みを意味しない）に改めた。
  document/section（構造Node）は「構造Node」と表示し、変更なし/変更ありとは区別する。
  新しい状態（未確認/確認済み/レビュー待ち等）は追加していない
- **7つのクイックフィルタを「確認メニュー」（4種・単一選択）と「詳細な絞り込み」（旧7種、
  折りたたみ）に整理**: 通常の利用者は画面上部の4つの確認メニューから1つを選ぶだけでよい。
  各メニューは複数の条件をOR結合し、選択すると「該当0件なら次の画面へ進めます」「該当N件
  なら内容を確認し、修正が必要な項目だけ変更してください」という案内を表示する。個別条件で
  絞り込みたい場合のみ「詳細な絞り込み」を開く（旧クイックフィルタ7種はここに移動。
  「修正済み」は「変更あり」に改称）
  - タグを確認: タグ未設定 または 未登録タグあり
  - 本文を確認: 本文が空/短い または 低confidence
  - 変更した項目を見る: 今回のセッションで変更した項目（編集履歴の閲覧であり完了状態ではない）
  - 関連づけ後に確認: semantic Relation Candidateが0件 または stale Relationが1件以上
    （「3. 文書間の関連を確認」で候補を生成するまでは無効化され、「関連候補を生成した後に
    使用できます。」と案内する。候補生成前の全content Nodeが一律「候補なし」と表示される
    問題を解消した）
- **検索範囲を拡張**: 本文・タイトル・タグに加え、短縮ID（`A-003`等）と正式な`node_id`でも
  検索できるようにした。placeholderは「ID・本文・タイトル・タグで検索」。Knowledge Graphで
  確認した短縮IDをそのままNode一覧の検索欄に入力して絞り込める
- **短縮IDの全画面統一を確認**: Node一覧・Relation一覧・Knowledge Graphは取込直後に1回だけ
  生成される単一のマッピング（`nodeShortIds`）を共有しており、同一Nodeには常に同じ短縮IDが
  表示される。フィルタ・並べ替えで再採番されず、再取込のたびに3画面同時に再同期される
  ことをPlaywright検証で確認した（以前から実装済みの仕組みで、今回はその整合性を明示的に
  検証項目へ追加した）
- **Knowledge Graph→Node一覧への画面間ジャンプ**: Graphの選択Node情報パネルに
  「この項目を変換結果一覧で確認」ボタンを追加。押すとNode一覧が対象Node 1件へ絞り込まれ、
  該当行が強調表示される。Graph自体の機能・レイアウトはこの1点以外変更していない

### Relation Candidateの表示基準切替（文書A基準/文書B基準）

「3. 文書間の関連を確認」に表示基準の切替を追加した。これはCandidateの再生成ではなく、
**既存のRelation Candidateのグループ化・列見出しの表示だけを切り替える機能**で、
`edge_id`・`source_node_id`・`target_node_id`・lifecycle・freshness・confidence・evidence・
採用/却下結果は一切変更しない。

- **文書Aを基準に表示**（既定）: 文書AのNodeをグループ見出しにし、各A Nodeに関連する
  文書Bの候補を表示する（従来の表示と同じ）
- **文書Bを基準に表示**: 文書BのNodeをグループ見出しにし、各B Nodeに関連する文書Aの候補を
  表示する。画面上部に「生成済みの関連候補を、文書Bの項目ごとにまとめて表示しています。」
  という注意文を表示する
- 列見出しは固定的な「Source/Target」ではなく、基準に応じて「文書Aの項目」/「文書Bの関連候補」
  ⇔「文書Bの項目」/「文書Aの関連候補」に切り替わる。ただし表内のセルが参照する実データの
  `source_node_id`（常に文書A）・`target_node_id`（常に文書B）は変更しない（表示列の並び順を
  基準に合わせて入れ替えているだけで、逆向きEdgeを新規作成することはない）
- 文書Bを起点とした新しいCandidate生成は実装していない。現在のCandidate Engineは文書A側の
  上位候補を生成する方式のままで、B基準表示は既存Candidateの再グループ化に限定される
- 表示基準はUI専用の状態で、Knowledge JSONには保存されない

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
  (階層の折りたたみ／展開はα0.1.2時点では未実装だったが、**α0.1.3で実装済み**。
  本ファイル冒頭の「文書階層の折りたたみ・表示粒度調整・Relation連携」を参照)
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

  **(上記は最初のα0.1.2改善時点の記録。状態列の位置づけ・クイックフィルタの分類・
  検索範囲は、本ファイル冒頭の「Node画面の作業設計・画面間Node識別改善」でさらに改定
  されています。最新の実装は冒頭の記述を参照してください。)**

### 4. 画面名・説明文の分かりやすさ改善（2回目の人手評価を受けて）
- 「2. ノードを確認・修正」→「**2. 文書内容を確認・修正**」に改称（英語概念名`Knowledge Nodes`は補助表記。
  その後の改定で見出しはさらに「2. 変換結果を確認・修正」に変更されています。冒頭の記述を参照）
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
3. Node確認・修正 — node_type / 本文(text) / タグの編集。4種の確認メニュー(OR条件)・
   詳細な絞り込み(旧クイックフィルタ7種)・短縮ID/node_id検索・複数選択・タグ一括追加/削除・
   簡易/詳細表示切替
4. 文書間の関連の自動候補生成 — 既存タグの一致・文字列類似度に基づく semantic candidate edge の生成
5. Edge採用/却下 — candidateをactive/rejectedへ。複数選択・一括採用/一括却下・グループ単位一括却下
6. Relation一覧 — 文書A/文書B基準の表示切替(既存候補の再グループ化のみ)、グループ表示
   (折りたたみ可)・状態/stale/evidence/confidenceフィルタ・並べ替え
7. Knowledge Graph — 採用済み/未処理候補/文書内階層の個別表示切替、表示粒度(文書単位/章・節
   単位/個別項目)、document/sectionの個別折りたたみ、集約Edge(件数・内訳・confidence範囲・
   元Edge一覧)、Node選択強調、周辺表示モード、文書/種別/タグ絞り込み、常設凡例
8. GraphからRelation画面への範囲指定 — section Node配下または集約Edgeの元edge_id集合で
   Relation Candidateを絞り込み、範囲指定バナー表示・解除操作
9. Knowledge JSON保存 — Knowledge Data Contract 0.1形式でのJSON出力
10. 作業量サマリ — 全Node数・操作対象にしたNode数・個別修正したNode数・関連候補総数・
    人が個別判断した候補数・一括採用/却下件数・最終採用済みEdge数を表示

意図的に含まないもの(次段階以降の課題。α0.1.3でも先回りして追加していません):

- AIによる本格的なSemantic Tagging、完全なQuantity統合、Property Resolution
- `satisfied_by`等の強いRelationの自動判定。タグ一致・文字列類似度だけでは「関係がありそう」
  までしか判定できず「要求を満足している」とまでは判定できないため
- AI Agentによる自律操作、Graph DB／Vector DB、PDF/Excel直接取込の統合
- 1000件級の性能最適化、Contractの全面改定
- 文書Bを起点とした新しいCandidate生成(B基準表示・section/集約Edgeからの範囲指定は、既存
  Candidateの再グループ化・絞り込みに限定される)
- 構造Node配下だけへ絞り込むNode一覧側の追加ジャンプ(「配下の内容Nodeを一覧で確認」。
  既存の構造Node1件への単純ジャンプは維持。実装コストが大きいため次Checkpointの候補)
- Human/AIレビュー確定(`review.human`/`review.ai`)のUI(内部engineには実装済み。
  `core/knowledge_store.js`の`reviewHuman`/`reviewAI`参照)

### 短縮ID(画面表示専用)について

Node一覧・Relation一覧・Knowledge Graphで使う`A-001`/`B-001`等の短縮IDは、**画面表示専用の
別名**です。取込のたびに文書A/Bそれぞれの中で1から採番し直され、Knowledge Data Contract 0.1
のschemaには含まれません(保存するKnowledge JSONにも出力されません)。元Nodeの一意な特定は
引き続き`node_id`（Contract §8のID規則）で行います。短縮IDと`node_id`の対応は、各画面で
短縮IDにカーソルを合わせる(title属性)か、Knowledge Graph上でNodeを選択すると確認できます。

短縮IDの割当は取込直後に1回だけ生成する単一のマッピングで、Node一覧・Relation一覧・
Knowledge Graphの3画面が共有しています。フィルタや並べ替えを行っても再採番されず、同じ
Nodeには常に同じ短縮IDが表示されます。再取込を行うと3画面同時に再同期されます。Node一覧の
検索欄に短縮ID(`A-003`等)または正式な`node_id`を入力すると、その1件だけへ絞り込めます。
Knowledge Graphの選択Node情報パネルから「この項目を変換結果一覧で確認」を押すと、Node一覧
側で同じNodeの行が絞り込み・強調表示されます。

### Structural Node(document/section)とlegacy Trace互換性

`document`/`section`のStructural Nodeは既存TraceRecordSetに対応するレコードを持たない
(既存Exportは内容行のみを`_trace_records[]`として持ち、章/節そのものは別レコードにならない)。
これらのNodeは**`export_binding: null`**として生成され、既存Sidecar/照合ツールとのbinding
互換性を一切主張しない。`export_binding`が非nullの値を持つのは、既存TraceRecordの
`trace_id`/`content_hash`をそのまま引き継ぐ内容Node（requirement/design_item等）のみ。

## 使い方

1. `ui/knowledge_builder_tool_v0.1.3-alpha.html` をブラウザで直接開く(サーバ不要)
2. 「1. データを読み込む」の「文書A」「文書B」に、既存PDF/Excelツールが出力したtrace JSON
   ファイルを指定する(文書A/Bの役割は固定していない。任意の2文書間の関連確認に使える)。
   動作確認用の小規模サンプルとして
   `samples/hvac_trace_sample_small/JSON_A_customer_requirements_trace.json` /
   `JSON_B_design_review_trace.json`(リポジトリ直下)がそのまま使える。これは要求仕様/設計
   検討表というサンプル固有の組み合わせであり、製品上の入力制約ではない。件数が増えたときの
   絞り込み・グループ表示・Graphの効果を評価する場合は下記の中規模サンプルを使うこと
3. 「読み込んでノードを生成」→「2. 変換結果を確認・修正」に一覧が表示される。まず4つの
   「確認メニュー」から確認したい観点を1つ選ぶ(該当0件ならその観点の作業は不要)。個別条件で
   絞り込みたい場合のみ「詳細な絞り込み」を開く。検索欄には本文・タイトル・タグに加え、
   短縮ID・正式な`node_id`も入力できる
4. 「3. 文書間の関連を確認」で「関連候補を自動生成」→ 文書Aの項目単位でグループ化され、
   既定では折りたたまれている。見出しをクリックして展開し、候補を確認する。「表示基準」を
   「文書Bを基準に表示」に切り替えると、同じ候補を文書Bの項目単位で見直せる(候補の
   再生成ではなく、既存候補の表示切替のみ)
5. 「4. ナレッジグラフを確認」では、初期状態で採用済みの文書間関連だけが表示される。
   Nodeをクリックすると接続先が強調表示され、選択Node情報の「この項目を変換結果一覧で確認」
   から「2. 変換結果を確認・修正」の該当行へ移動できる。「文書内の階層関係も表示」をONにすると
   (初回は章・節単位で表示)、「表示する細かさ」で文書単位/章・節単位/個別項目を切り替えたり、
   document/sectionごとの▶/▼トグルで個別に展開・折りたたみできる。折りたたんだ範囲の関連は
   集約線としてまとめて表示され、クリックすると件数・内訳・元Edge一覧を確認できる。section
   Nodeまたは集約線の情報パネルから「この範囲の関連候補を確認」を押すと、対象範囲だけに
   絞り込んだ状態で「3. 文書間の関連を確認」へ移動する(「Graphからの範囲指定を解除」で戻せる)
6. 「5. ナレッジデータを保存」でKnowledge Data Contract 0.1形式のJSONをダウンロードする。
   同じ画面に作業量サマリを表示する

## 中規模評価サンプル（件数が増えたときの評価用）

`samples/knowledge_builder_alpha01/medium/` に、Node/Relation Candidateが増えたときの
絞り込み・グループ表示・Graphの効果を評価するための中規模サンプル（文書A 80件・文書B 100件・
関連候補約230件規模）を同梱しています。使い方・意図的に含めたケース（同義語・略語・
タグ不足・1要求→複数設計項目等）・評価用ground truth(`expected_relations.json`)の使い方は
`samples/knowledge_builder_alpha01/medium/README.md` を参照してください。

## 評価していただきたい観点（α0.1.3）

1. 目的のNodeを短時間で絞り込めるか
2. 同名Nodeを短縮IDで識別できるか
3. Source NodeごとにRelation Candidateを比較できるか
4. confidenceとevidenceを見て候補を判断できるか
5. Graphで採用済み関係を追跡できるか
6. 選択Node周辺だけを確認できるか
7. 文書内階層と文書間関連を区別できるか
8. 多数の未処理候補によってGraphが初期状態から混雑しないか
9. 「文書内容を確認・修正」画面が「全件を確認済みにする画面」ではなく「明らかな誤りだけを
   直す画面」だと理解できるか
10. 4つの確認メニューから目的に合ったものを選べるか。0件のときに次の画面へ進んでよいと
    分かるか
11. 候補生成前に「関連づけ後に確認」メニューが使えないことが分かり、混乱しないか
12. Graphで見た短縮IDをNode一覧の検索欄に入力して、同じNodeを見つけられるか
13. Node一覧・Relation一覧・Graphで同じNodeが同じ短縮IDで識別できるか
14. 文書Aを基準にした表示と文書Bを基準にした表示を切り替えても、混乱せず同じ候補を
    見ていると理解できるか
15. 文書単位・章節単位・個別項目の3段階で、Graphの全体傾向と個別関係を切り替えて把握できるか
16. document/sectionを個別に折りたたみ・展開して、必要な範囲だけ詳しく確認できるか
17. 折りたたんでも元のNode/Edgeが失われていないと理解できるか(集約線が正式なEdgeではないと
    分かるか)
18. 集約線の件数・採用/未処理/stale内訳を見て、関連が集中している章・節を見つけられるか
19. 気になる集約範囲やsectionからRelation画面へ移動し、対象Candidateだけを確認できるか
20. Relation画面での採用/却下結果が、Graphの集約内訳へすぐ反映されると分かるか

自動Semantic Tagging(Knowledge Builder自身によるタグ自動生成)、`satisfied_by`等の強い
Relationの自動判定は今回のα0.1.3にも含まれないため評価対象外です。次Checkpoint以降で
別途評価します。

## 内部構成

```
core/
  id_hash_utils.js            ID・hash算出(§6.5/§6.6/§8)。既存quantity_sidecar_binding_core.js
                               のnormalize/hashParts/canonicalJson/computeRecordContentHashを再利用
  trace_json_adapter.js        既存trace JSON → KnowledgeNode/構造Edge(§10.1 Adapter)
  relation_candidate_engine.js タグ一致・文字列類似度によるsemantic candidate生成(§4.5)
  knowledge_store.js           Node/Edge編集・lifecycle・review・operation historyのreducer(§6.4)
                               (α0.1.2・α0.1.3とも変更なし。表示改善はUI側のみ)
verification/
  knowledge_builder_core_verification.js         Node.js検証(losslessness・dual-hash・stale判定等)
  knowledge_builder_ui_smoke_test.js              Playwright検証(小規模サンプルでのUI一連操作)
  knowledge_builder_medium_sample_smoke_test.js   Playwright検証(中規模サンプルでの規模・一括操作)
  (いずれもNODE_PATH="$(npm root -g)"が必要なものはPlaywright使用箇所のみ)
ui/
  knowledge_builder_tool_v0.1.3-alpha.html  評価用ブラウザツール本体
design/
  knowledge_data_contract_0.1.md          Knowledge Data Contract 0.1(設計文書。α0.1.2・α0.1.3とも未変更)
manual/
  knowledge_builder_detailed_operation_manual_v0.1.3_alpha.pdf  詳細操作説明書(α0.1.3)
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
