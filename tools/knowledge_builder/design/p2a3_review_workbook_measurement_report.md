# P2-A3 Checkpoint 3 review Workbook 測定報告

private/shareable review Workbook の生成・resume 性能測定と、`MAX_REVIEW_WORKBOOK_BYTES` の提案。

本書には private 本文を記載しない。測定入力はすべて synthetic で、file 名・candidate 語彙は
測定用に生成した無内容の文字列である。

---

## 1. 測定方法

- 本番 UI（`server.js` + `index.html`）を `127.0.0.1` の動的 port で起動し、Chromium
  （`/opt/pw-browsers/chromium`、`--enable-precise-memory-info`）で接続した。
- Checkpoint 2 で承認された source 入力上限（1 MB / 2 MB / 20 件）から実際に生成される
  candidate/alias/conflict 規模を、**実 PDF を再生成せず** synthetic session として
  ブラウザ内に直接構築した（451/451/451 pagination fixture と同じ手法の拡張）。
  ingest pipeline（adapter → projection → 抽出）は Checkpoint 2 から変更していないため、
  Workbook 層自身の scaling を測るにはこれで十分であり、多 MB の PDF を再生成するより
  高速かつ確実である。
- 各 session に対し、ACCEPT/REJECT/UNCERTAIN/UNREVIEWED が均等に混在する判定を
  `ReviewState.setCandidateDecisionBulk`（O(n)）で一括適用した。
- 計測点：`P2A3PrivateReviewExport.buildPrivateReviewWorkbookBytes()` の所要時間と出力 byte 数、
  `P2A3ShareableSummaryExport.buildShareableSummaryWorkbookBytes()` の所要時間と出力 byte 数、
  `P2A3PrivateReviewImport.validateAndBuildPendingReviewState()`（resume）の所要時間と成否、
  `performance.memory.usedJSHeapSize`、応答維持（測定後に DOM 操作が反映されるか）、
  browser crash 有無（`page.isClosed()`）。
- 再現コマンド：
  ```bash
  node tools/knowledge_builder/verification/p2a3_review_workbook_performance_measurement.js
  ```

---

## 2. 測定結果

| ケース | candidate 数 | private Workbook bytes | private export | shareable export | shareable bytes | import（resume） | heap | 応答 | crash |
|---|---|---|---|---|---|---|---|---|---|
| 451/451/451 synthetic | 451 | 0.54 MB | 101.7 ms | 7.5 ms | 28.2 KB | 127.0 ms（成功） | 19→31 MB | ○ | なし |
| Checkpoint 2 の 0.91MB 入力相当（32,500/8,000/2,000） | 32,500 | 17.45 MB | 4,067.3 ms | 19.3 ms | 28.2 KB | 2,824.8 ms（成功） | 40→190 MB | ○ | なし |
| Checkpoint 2 の 1.84MB 入力相当（66,000/16,000/4,000） | 66,000 | **35.48 MB** | 9,706.9 ms | 29.2 ms | 28.2 KB | 5,601.1 ms（成功） | 134→231 MB | ○ | なし |

3 ケースとも:
- private Workbook の生成が完走し、生成した Workbook から resume が成功した（candidate 数一致）。
- shareable Workbook は candidate 数に対してほぼ一定サイズ（集計のみのため）。
- 測定後も DOM 操作（`change` イベント発火）が反映され、応答を維持した。
- `page.isClosed()` は全ケースで `false`（browser crash なし）。

### 2.1 測定中に発見・修正した実装問題

1. **Node での XLSX 解決順序バグ**：`workbook_cells.js` の `getXLSX()` が
   `globalThis.XLSX || require(...)` の順で解決していたため、pdf.js の Node 互換 shim が
   副作用として `window` を定義し、それに反応した vendored XLSX バンドル自身の UMD tail
   （`if (typeof window !== "undefined") window.XLSX = XLSX`）が **未初期化のローカル変数**を
   `globalThis.XLSX` へ設定してしまい、`.utils` を持たない壊れたオブジェクトが以後ずっと
   拾われる状態になっていた。`excel_direct_adapter.js` の既存 `resolveXLSX()` と同じ順序
   （Node では `require` を先に試す）へ修正した。
2. **row bound の off-by-one（サイレント truncate）**：`readSheetBounded()` の `sheetRows` 計算が
   1 行不足しており、「期待行数+1（余分な1行）」を読むはずが「期待行数と同じ」までしか
   読めていなかった。これにより、余分な行を追加した tamper fixture がその余分な行ごと
   読み飛ばされ、**正常な Workbook として受理されてしまう**（§27 が明示的に禁止する挙動）
   バグがあった。`cap = maxDataRows + 2`（header 1 行 + 期待データ行 + 余分な 1 行）へ修正し、
   tamper fixture（Source Documents への余分な 1 行追加）で再現・再検証した。
3. **overflow 早期判定が具体的な分類を握りつぶす**：上記 2 の修正後、行数超過を
   `REVIEW_WORKBOOK_INVALID` として即座に拒否する早期 gate があったため、duplicate ID や
   余分な source fingerprint のような、より具体的な理由分類（`REVIEW_DUPLICATE_ID` /
   `REVIEW_SOURCE_MISMATCH` 等）に到達する前に汎用エラーへ丸められていた。
   sheetRows によるパース済み行数は既に上限で bound されているため DoS 対策としては
   このゲートは不要と判断し、削除して後続の具体的な検証（duplicate 検出・ID 集合比較・
   fingerprint 集合比較）へ処理を委ねるよう変更した。

いずれも本 Checkpoint の新規コードの中で発見・修正しており、P2-A2 変更禁止 7 ファイルは
無関係である。

---

## 3. §61 の判定（Checkpoint 2 入力上限との整合）

Checkpoint 2 で承認された source 入力上限（1 MB / file、2 MB total、20 files）から実際に
生成される最大規模（1.84 MB・3 file 入力が生む 66,000 candidate 相当）で、
private Workbook の生成・resume は**完走し、応答を維持し、crash しなかった**。

**BLOCKED の条件**（「source 解析は成功するが Workbook 側で browser が不安定になる」）には
**該当しない。** Checkpoint 2 で承認された入力上限を無断変更する必要はない。

---

## 4. `MAX_REVIEW_WORKBOOK_BYTES` の提案

```text
MAX_REVIEW_WORKBOOK_BYTES = 60 MB (62,914,560)
```

### 4.1 根拠

- 測定範囲内（66,000 candidate、35.48 MB の private Workbook）で **不安定点は観測されなかった**。
- そのため、S18.1（source 入力上限）のように「観測された不安定点からの倍率」という形の
  安全余裕は表現できない。ここでは、**観測された最大成功値（35.48 MB）に対する倍率**
  （約 1.7 倍）として 60 MB を提案する。
- **最大成功値そのもの（35.48 MB）を上限にしていない。**
- **未測定値は採用していない。** 撤回済みの「未実測 512 MB」とは異なり、実測された成功点を
  出発点にしている。
- `Limits.checkReviewWorkbookFile()` は `File.size` のみで判定し、`File.arrayBuffer()` を
  呼ぶ前に拒否する（source 入力の pre-read gate と同じ設計）。

### 4.2 制約・未解決事項

- **真の不安定点は本 Checkpoint では特定していない。** 66,000 candidate は
  「Checkpoint 2 が承認した最大の source 入力から生じる規模」であって、Workbook 層自体の
  限界ではない。より高い規模（例：数十万 candidate）での追加測定が必要かどうかは
  Checkpoint 3 レビューの判断に委ねる。
- 測定は Chromium のみ。Windows Edge／Chrome、macOS Safari は未検証（S18.1 と同じ制約）。
- `performance.memory` は Chromium 限定指標。
- この提案値は Checkpoint 3 レビューでの正式承認前は正式配布上限として扱わない。

---

## 5. 再現コマンド

```bash
node tools/knowledge_builder/verification/p2a3_review_workbook_performance_measurement.js
node tools/knowledge_builder/verification/private_dictionary_candidate_review_workbook_verification.js
```
