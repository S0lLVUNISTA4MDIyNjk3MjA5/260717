# Samples/Matching-Methods（照合方式サンプル集）

HE-1 Remediation Checkpoint 2-G にて、開発者側で real Chromium runtime 検証を完了した照合方式サンプル集です。
元は独立レビューア作成の `Reviewer_Matching_Method_Samples_v2.zip`（SHA-256:
`7957f491b1054a334c8217d2848dba2165e5769f0f6f20b477eb238b2c29d8f5`）で、全16サンプルを本ツールで
実行し、Ground Truth と完全一致することを確認した上でこのフォルダに収録しています。

**この集合は RA-01 / RA-02 / User-HVAC / 既存 Human Evaluation フィクスチャを置き換えるものではありません。**
それらは引き続き独立した敵対的リグレッション証跡として別枠で保持されます。本集合は「各照合方式を人間が
小さなデータで個別に確認する」ことを目的とした、別の補助教材です。

## 各サンプルの読み込み方

各 `NN_XXXX/` フォルダの `A.json` / `B.json`（`12_CONFIG_ALL_OFF` のみ `RA-02_A.json` /
`RA-02_B.json`）を読み込み、そのフォルダの `GROUND_TRUTH.json` に書かれた `manual_key_pairs` /
`setup` の指示通りに照合ペア・設定を行ってから「再照合」してください。結果は
`GROUND_TRUTH.json` の `expected` と比較できます。Detail タブの展開行で「照合方法」「信頼度」
「照合根拠」を確認してください（Checkpoint 2-G 以降、これらは「日本語 (英語enum)」形式で表示されます。
JSON内部の method 値・Excel出力の生列は enum のまま変更されていません）。

## サンプル一覧（意味・操作・期待結果・日本語表示・分類・依存関係）

| case | 意味 | 操作 | 期待結果 | 期待Human表示 | 分類 | 依存 |
|---|---|---|---|---|---|---|
| 00_AUTO | 自動キー推定と基本edge | 通常自動推定（操作不要） | AUTO-A1↔B1, AUTO-A2↔B2 の2edge | 完全一致 (exact) | 正例 | なし |
| 01_EXACT | 完全一致 | key pair method=exact | EX-A1↔B1, EX-A2↔B2 | 完全一致 (exact) | 正例 | なし |
| 02_PARTIAL | 固有substringの部分一致 | key pair method=contains | PAR-A1↔B1, A2↔B2, A3↔B3、method=partial | 部分一致 (partial) | 正例 | なし |
| 03_CODE | 構造化identifier一致 | key pair method=code | CODE-A1↔B1, A2↔B2 | コード一致 (code) | 正例 | なし |
| 04_MODEL | モデル名の包含一致 | key pair method=model | MODEL-A1↔B1, A2↔B2 | モデル名一致 (model) | 正例 | なし |
| 05_SYNONYM | 業務辞書synonymMapによる一致 | 業務辞書JSONを読み込み、key pair method=synonym | SYN-A1↔B1, A2↔B2 | 同義語一致 (synonym) | 正例 | business_dictionary.json |
| 06_FUZZY | 表記ゆれ/bigram類似一致 | key pair method=fuzzy | FUZ-A1↔B1, A2↔B2, A3↔B3、method=fuzzy | 類似一致 (fuzzy) | 正例 | なし（実装のbigram閾値により、developer runtime検証でA3/B3の語尾を調整済み。詳細はGROUND_TRUTH.jsonのnotesを参照） |
| 07_VECTOR | TF-IDF/特徴語ベースの文脈類似 | key pair method=vector | VEC-A1↔B1, A2↔B2, A3↔B3、method=vector | ベクトル類似 (vector) | 正例 | TinySegmenter CDNが利用できない環境ではcharacter-typeフォールバックtokenizerで動作（developer runtime検証でA1/A3の語彙を調整済み） |
| 08_TAG | 明示タグ共有による一致 | matchLogic.tagSettings.enabled/useForMatching=true、key pairなし | TAG-A1↔B1, A2↔B2、method=tag | タグ一致 (tag)（辞書由来ではない明示タグの例） | 正例 | なし |
| 09_HIERARCHY | 親子候補の降格/説明（階層ゲート） | key pair method=contains、useHierarchyGate=true（既定） | HIER-A1↔CHILD(method=exact), HIER-A1↔PARENT(method=hier, confidence=0.72) | 完全一致 (exact) / 階層判定 (hier) | 正例（親子両方が意図通りの方式で観察される） | なし。B側はannotateGranularity()の実PRT自動検出に必要な`parent_code`命名フィールドを持つ（詳細はGROUND_TRUTH.jsonのnotesを参照） |
| 10_AMBIGUOUS_EXACT_NEGATIVE | 非一意完全一致の安全側抑制（RC3） | key pair method=exact | 0 edge（意図的） | ― | 負例 | なし |
| 11_PRIVATE_DICTIONARY | Approved Dictionary Snapshotの有無によるtag edge | Snapshot未設定で5 edge確認→K_dictionary_snapshot.jsonを設定しtagSettings ON→6 edge（+EMO, method=tag, confidence=0.88） | 5→6 edge | タグ一致 (tag) | 正例（既存I/J/K検証を再利用） | K_dictionary_snapshot.json（G_sample_dictionary_snapshotは未使用側の参考） |
| 12_CONFIG_ALL_OFF | 全照合ペアOFFでも設定意思を保持しedge 0 | 既存の有効なkey pairを全てenabled:falseに | 0 edge、explicitAllDisabledNoticeを表示 | ― | 負例（既存RA-02を再利用） | なし |
| 13_AUTO_SYNONYM | JSONから自動生成するsynonym候補 | 「JSONから候補生成」実行後、key pair method=synonym | 3件の同義語候補群を正しく生成。auto-synonymは既定confidence(0.65)がminConfidence(0.7)未満のため、既定設定では「要確認」候補としてレビュー画面（ML/学習タブの候補一覧）に現れ、既定のacceptedエッジには自動昇格しない（製品のhelp文書が明記する意図通りの挙動） | 自動同義語一致 (auto-synonym)（候補一覧内） | 正例（候補生成として） | なし |
| 14_ML_FEEDBACK | フィードバック学習ワークフロー | 通常照合→MLタブで候補生成→A1-B1/A2-B2/A3-B3を正例、無関係pairを負例としてラベル付け→学習実行→モデル適用ON/OFF比較 | 教師ラベルはsource=manual_labelとして保持、学習後もruleScoreを追跡可能、モデル適用OFFで通常rule confidenceへ復帰 | （method表示は基礎ruleのまま。ML適用時はconfidenceのみ調整） | 正例 | なし |
| 15_LONG_TEXT_CHUNK | 長文チャンク照合（文単位評価） | chunkSettings.enabled=falseで基準確認→trueで再照合 | 両状態でCH-A1↔B1のみ、無関係edgeなし（methodは基礎方式に依存し変わり得る） | （方式は基礎methodに依存） | 正例 | なし |

## Ground Truth運用方針

各GROUND_TRUTH.jsonの`expected`/`notes`は、開発者側real Chromium runtime検証で実際に観測された結果を
反映しています。サンプルの意図した挙動が製品の実装（既存の保護済みロジック: RC1/RC2/RC3、
bigram/TF-IDF閾値、annotateGranularity()の階層自動検出等）と整合するよう、非意味的なfixture構造・
文言のみを調整した箇所があります（06_FUZZY, 07_VECTOR, 09_HIERARCHY）。matching logic自体
（calcPairMatch/activeKeyPairs/RC1-3/confidenceRules/applyHierarchyGate等）は一切変更していません。
