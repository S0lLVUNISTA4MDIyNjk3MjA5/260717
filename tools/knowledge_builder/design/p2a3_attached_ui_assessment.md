# P2-A3 添付UI 静的分析報告

Checkpoint 1 成果物 / 添付された旧P2-A2評価UIの静的分析と、P2-A3への移行方針。

本書は静的分析のみで作成した。添付物は実行していない。添付パック内には private な候補本文・
評価成果物は含まれておらず（除外済み）、本書にも一切転載していない。

---

## 1. 添付物の同一性

| 対象 | SHA-256 | 検証結果 |
|---|---|---|
| `p2a3_attached_ui_reference_source_only.zip` | `367dbd25727a56bd529cc99e56b1c489d2d9fb93502b74dd44129262e7730930` | 指示書記載値と**完全一致** |
| `p2a3_attached_ui_reference_with_docs.zip` | `1076d5988325c9954477db0b1bd99a01af46db05b052fedd88e387f20ddebbdc` | 指示書に期待値の記載なし。実測値を記録するにとどめる |
| 元の大型ZIP `P2-A2_Evaluation_Tool_UI_6de6fbc_Windows_NoInstall(1).zip` | `9e0ef6bf61f41a16c4257daa9cb47688938750727875baaeadfe3a39580702f8` | **未提供のため未検証**。パック内 `README_FOR_DEVELOPER_AI.md` の自己申告値 |

`source_only` パック同梱の `MANIFEST.sha256`（13エントリ）を `sha256sum -c` で照合し、**全13件 OK**。
`with_docs` は `source_only` の全ファイルに加え、ユーザーマニュアルPDF 2件、license 4件、
runtime notice 1件を含む上位集合である。

添付UIのソース基準は merge 前の P2-A2 head `6de6fbc9316316aa842d35f4267eb514e134f1ba` であり、
P2-A3 の正本 `af6ba3283afa3cf042871f1ed4f8277a3abb16d0`（PR #13 merge commit）とは異なる。
**添付物は参考実装であり正本ではない。**

---

## 2. directory構成

```text
p2a3_reference_pack_source_only/
├─ README_FOR_DEVELOPER_AI.md
├─ ATTACHED_UI_ASSESSMENT_SUMMARY.md
├─ EXCLUDED_CONTENT.txt
├─ MANIFEST.sha256
└─ reference_ui/
   ├─ README_H1_EVALUATION.md
   ├─ README_UI.md
   ├─ WINDOWS_STARTUP_HELP.txt
   ├─ start_ui.bat / start_ui.sh / start_ui.command
   └─ ui/
      ├─ server.js
      └─ public/{index.html, app.js, styles.css}
```

`with_docs` は追加で `docs/*.pdf`（マニュアル2件）、`licenses/runtime/NODE_LICENSE.txt`、
`licenses/vendor/{VENDOR_NOTICE.md, xlsx-LICENSE.txt, pdfjs/*}`、`runtime/NODE_RUNTIME_NOTICE.txt` を持つ。

パックから明示的に除外されているもの（`EXCLUDED_CONTENT.txt`）：bundled `node.exe`（x64/ARM64）、
`.p2a2-ui-runtime/`、入出力生成物、P2-A2 core/adapter/CLI の複製、verification suite/fixture、
`quantity_sidecar_binding_core.js`、PDF.js/SheetJS の vendor asset。

---

## 3. 起動方式

| launcher | 方式 | 評価 |
|---|---|---|
| `start_ui.bat` | `%PROCESSOR_ARCHITECTURE%` / `%PROCESSOR_ARCHITEW6432%` で x64/ARM64 を判定し `runtime\win-{x64,arm64}\node.exe` を選択 | 再利用価値が高い |
| `start_ui.sh` | system `node` を `command -v` で確認して起動 | 版数の扱いに問題あり（後述） |
| `start_ui.command` | 同上（macOS 用、終了時に `read` で待機） | 同上 |

`start_ui.bat` が持つ良い性質：

- `ui\server.js` 不在を「ZIP 内から直接実行した」ケースとして検出し、展開を促して `exit /b 2`
- `x86` を明示的に非対応として `exit /b 3`
- bundled runtime 不在で `exit /b 4`
- `node.exe --version` が取れない場合（ZIP 破損・セキュリティソフトによるブロック）を `exit /b 5`
- 全異常系で `pause` を挟み、window が即時閉じない
- CLI の exit code をそのまま `exit /b` で返す
- セキュリティ設定の無断解除を案内していない

**問題点**：`start_ui.sh` / `start_ui.command` が `Node.js 18以降が必要です` と表示する。
これは実測に基づく検証済み範囲ではなく、推測された最低versionである。P2-A3 の launcher 要件
（「最低versionを推測しない」「未検証versionを対応済みと書かない」）に反するため、
そのまま踏襲してはならない。

---

## 4. local server方式

`ui/server.js` の実装（静的読解）：

| 項目 | 実装 | P2-A3での扱い |
|---|---|---|
| bind | `HOST = '127.0.0.1'`、`server.listen(0, HOST, …)` | **踏襲** |
| port | `0` 指定による動的port | **踏襲** |
| 認証 | `crypto.randomBytes(24).toString('base64url')` を起動時に生成し、`/api/*` で `X-UI-Token` 照合 | **踏襲**（ただし後述の URL 露出に注意） |
| static配信 | `/`, `/app.js`, `/styles.css` の固定 map。map 外は 404 | **踏襲**（allowlist 方式。path traversal が構造的に不可能） |
| directory listing | なし | **踏襲** |
| browser起動 | platform 別に `cmd /c start` / `open` / `xdg-open` を detached spawn、エラーは握り潰す | **踏襲** |
| 外部接続 | なし | **踏襲** |

token は起動時に URL クエリ `?token=…` として渡され、`app.js` が `sessionStorage` へ移して
`history.replaceState(null, '', '/')` で URL から除去する。`Referrer-Policy: no-referrer` と
併せれば実用上の露出は限定的だが、**browser 履歴には残り得る**。P2-A3 でも同方式を採る場合は
この残留を contract へ明記する。

---

## 5. security header

`secureHeaders()` が設定するもの：

```text
Cache-Control: no-store
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy:
  default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';
  form-action 'self'
```

**確認された不足点**：

1. `worker-src` の指定がない。旧UIは PDF 解析を server 側 Node で行うため worker を使わず問題に
   ならなかったが、P2-A3 は PDF.js を browser で動かすため `worker-src` が必須になる。
2. `default-src 'self'` を baseline にしている。P2-A3 では `default-src 'none'` を baseline とし、
   必要な directive だけを明示的に開ける方が fail-closed に近い。
3. `sendJson()` / `sendError()` は `secureHeaders()` を呼ばず、`Cache-Control` と `nosniff` しか
   付けない。JSON 応答に CSP / frame deny / referrer policy が乗らない経路が存在する。
   P2-A3 では全レスポンスで同一の header set を通す。

---

## 6. file選択方式

`index.html` / `app.js` で確認：

- PDF 用・Excel 用の 2 つの `<label class="picker">` に `<input type="file" multiple>`
- `accept` 属性で拡張子と MIME を制限
- `dragenter` / `dragover` / `dragleave` / `drop` を両 picker に登録し、`e.dataTransfer.files` を受理
- 拡張子でクライアント側フィルタし、除外時にメッセージ表示
- 選択済みファイルを種別・名前・サイズの行として一覧表示（`textContent` 使用、XSS 経路なし）
- 「選択をクリア」ボタン
- 処理中は `runButton` / `clearButton` を disable
- privacy 警告を画面上部に常時表示

この層は **設計としてほぼそのまま P2-A3 で再利用できる**（実装コードのコピーではなく方式として）。

---

## 7. private data lifecycle（最大の再設計対象）

旧UIの流れ：

```text
browser: File 選択
  → POST /api/jobs/{uuid}/file        (octet-stream で server へ upload)
server:  runRoot/{job}/input/NNN-xxxx.ext へ disk 保存
  → POST /api/jobs/{uuid}/run
server:  execFile(node, [CLI, --pdf …, --excel …, --out runRoot/{job}/output])
  → CLI が candidate_evaluation.json / candidate_review.md / shareable_summary.json を disk 出力
server:  出力 JSON を読み、件数のみを browser へ返す
browser: GET /api/jobs/{uuid}/output/{name} で download、
         GET /api/jobs/{uuid}/preview で candidate_review.md を <pre> 表示
```

つまり **private な入力ファイル本体と private な評価成果物の両方が、server プロセスと
ローカルディスクを経由する**。P2-A3 の第一選択（browser-memory processing）とは正反対の設計である。

cleanup：

- `job.createdAt` から 30 分（`JOB_TTL_MS`）経過した非実行中 job を 60 秒間隔で `fsp.rm` 削除
- `DELETE /api/jobs/{id}` で明示削除
- `SIGINT` / `SIGTERM` / `exit` で `runRoot` を `rmSync(recursive, force)`

TTL と cleanup 自体は妥当だが、**プロセスが強制終了された場合（kill -9、電源断、
Windows のウィンドウ強制クローズ）には private 成果物がディスクに残留する**。

---

## 8. runtime同梱方式と `.p2a2-ui-runtime` 問題

```js
function makeRunRoot() {
  try {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'p2a2-evaluation-ui-'));
  } catch (_) {
    const fallbackParent = path.join(ROOT, '.p2a2-ui-runtime');   // ← 配布物 root
    fs.mkdirSync(fallbackParent, { recursive: true });
    return fs.mkdtempSync(path.join(fallbackParent, 'run-'));
  }
}
```

`os.tmpdir()` への `mkdtemp` が失敗した場合、**配布物 root 直下の `.p2a2-ui-runtime/run-*/` へ
private な input と output を書き込む**。この directory は配布物ツリーの内側にあるため、
作業ディレクトリをそのまま再ZIP化すると private 実データが配布物へ混入する。
これが実際に発生した packaging 事故の直接原因である。

P2-A3 での扱い：

- **配布物ツリー内への runtime fallback を全面禁止**する。
- tmp 確保に失敗した場合は fail-closed で停止し、代替書き込み先を探さない。
- そもそも browser-memory 方式では server 側に input/output を置かないため、この経路自体を消す。
- 加えて、packaging は allowlist 方式で構築し、作業 directory の再ZIP化を禁止する。

Windows runtime 同梱については、`with_docs` 側の `runtime/NODE_RUNTIME_NOTICE.txt` と
`licenses/runtime/NODE_LICENSE.txt` の配置方法（runtime 本体と license を分離して置く）が
参考になる。**runtime binary 自体は Checkpoint 1 の source commit へは追加しない。**

---

## 9. license

`with_docs` パックに以下を確認：

```text
licenses/runtime/NODE_LICENSE.txt
licenses/vendor/VENDOR_NOTICE.md
licenses/vendor/xlsx-LICENSE.txt
licenses/vendor/pdfjs/VENDOR_NOTICE.md
licenses/vendor/pdfjs/pdfjs-LICENSE.txt
runtime/NODE_RUNTIME_NOTICE.txt
```

これらに相当するファイルは固定 base SHA `af6ba328` のリポジトリ側にも存在する
（`tools/knowledge_builder/ui/vendor/` 配下）。P2-A3 の配布 license は
**添付パックからではなくリポジトリ側の正本を使用する**。license 本文は書き換えない。

---

## 10. 再利用する部分 / 再利用しない部分

### 再利用する（考え方として。コードの丸ごとコピーはしない）

| 項目 | 理由 |
|---|---|
| `127.0.0.1` 限定 bind + `listen(0)` 動的 port | ローカル専用性の担保として妥当 |
| 起動時 random token + `X-UI-Token`（API を持つ場合） | 他プロセスからの偶発アクセス防止 |
| 固定 map 方式の static 配信 | path traversal が構造的に発生しない |
| `no-store` / `nosniff` / `frame DENY` / `no-referrer` / CSP | header set の骨格 |
| Windows launcher の architecture 判定・runtime 検証・全異常系 `pause` | Windows 配布の実務的な要件を満たしている |
| ZIP 内直接実行の検出と展開誘導 | 実際に起きる利用者ミスへの対策 |
| PDF/Excel の複数選択・drag and drop・一覧表示・クリア | 操作性として十分 |
| privacy 警告の常時表示と private/shareable の視覚的区分 | そのまま踏襲 |
| runtime notice / license の分離配置 | 配布物構成として参考になる |

### 再利用しない（P2-A3 で作り直す）

| 項目 | 理由 |
|---|---|
| server への file upload | private 入力を server/disk へ出す。browser-memory 方式へ置換 |
| server 側 temporary input/output | 同上。残留リスクと packaging 混入リスク |
| CLI subprocess 起動 | private path を子プロセス引数へ渡す。browser 内実行へ置換 |
| `.p2a2-ui-runtime` fallback | 配布物混入事故の直接原因。全面禁止 |
| `candidate_review.md` の `<pre>` preview を主結果とする構成 | レビュー操作ができない。interactive table へ置換 |
| JSON / Markdown download 中心の成果物導線 | Excel 保存・再開へ置換し、JSON/MD は advanced export へ隔離 |
| 旧 SHA `6de6fbc` の固定表示（`index.html` footer） | 正本 SHA が異なる。build 情報は生成時に注入する |
| `Node.js 18以降が必要です` の推測表記 | 検証済み version のみ表示する方式へ変更 |
| review decision UI の不在（ACCEPT/REJECT/UNCERTAIN、reason、note、alias 個別判定、conflict 解決） | P2-A3 の中核機能として新規実装 |

---

## 11. packaging問題（恒久検査項目化するもの）

添付パックと元 ZIP の事例から、以下を P2-A3 の package 検査 allowlist / denylist へ恒久的に含める。

```text
.p2a2-ui-runtime/      run-*/                 input/                 output/
candidate_evaluation.json                     candidate_review.md
shareable_summary.json                        review_session.json
実行済み review workbook                      synthetic test output
private marker                                temporary file
log                                           stack trace
absolute path を含むファイル                   .git/
node_modules/                                 .DS_Store / Thumbs.db
```

配布直前に **allowlist 方式で package tree を新規構築**し、既存の作業 directory を
そのまま ZIP 化しない。

---

## 12. P2-A3への移行方針

1. 正本は固定 integration commit `af6ba3283afa3cf042871f1ed4f8277a3abb16d0` とする。
   添付パック内のファイルを製品コードへコピーしない。
2. 第一選択は **browser-memory processing**。local server は static asset 配信と browser 起動のみ。
   → 本 Checkpoint で実測により実現可能と確認済み（§13）。
3. `Extraction Result`（immutable）/ `Evidence Display Index`（表示専用）/ `Review State`（人間判断）
   の 3 層を分離する。
4. interactive candidate table、evidence panel、alias tab、conflict tab、dashboard を実装する。
5. private review workbook と content-free shareable workbook を分離する。
6. JSON / Markdown は通常操作から外し、advanced export として折りたたむ。
7. package は allowlist 方式。runtime data / output / test fixture を構造的に除外する。

---

## 13. browser-memory architecture 実現性の実測結果

指示書 §10 の「実現性確認」を、固定 base SHA `af6ba328` のリポジトリ側ファイルを用いて実測した。

**確認した browser export（すべて `globalThis` へ UMD で公開されている）**

| global 名 | 供給元 |
|---|---|
| `QuantitySidecarBinding` | `tools/quantity_sidecar_binding_core.js` |
| `KnowledgeIdHashUtils` | `tools/knowledge_builder/core/id_hash_utils.js` |
| `KnowledgePdfDirectAdapter` | `tools/knowledge_builder/core/pdf_direct_adapter.js` |
| `KnowledgeExcelDirectAdapter` | `tools/knowledge_builder/core/excel_direct_adapter.js` |
| `PrivateDictionaryRuleExtractionCore` | `tools/knowledge_builder/core/private_dictionary_rule_extraction_core.js` |
| `pdfjsLib` | `tools/knowledge_builder/ui/vendor/pdfjs/pdf.min.js` |
| `XLSX` | `tools/knowledge_builder/ui/vendor/xlsx.full.min.js` |

いずれも `if (typeof module === 'object' && module.exports)` で Node、`root.<Name> = api` で browser
という二重環境パターンを既に持っており、**browser 実行のための製品コード変更は不要**である。

**実測条件**

- Chromium（Playwright 同梱）、`127.0.0.1` の static-only server 経由
- 適用 header：`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none';
  frame-ancestors 'none'; form-action 'self'` ＋ `no-store` / `nosniff` / `DENY` / `no-referrer`
- 入力：synthetic な鉄道車両用空調装置 PDF（3ページ）＋ XLSX（2 sheet）。実データ不使用
- browser 側で `crypto.subtle.digest('SHA-256')` により content digest を算出し、
  CLI と同一の手順（adapter → projection → validate → extract → serialize）を実行

**結果**

| 項目 | 結果 |
|---|---|
| 全 global の解決 | 7/7 成功 |
| PDF.js worker | `worker-src 'self' blob:` 下で実 Worker として起動・動作 |
| projection validation | PDF / Excel とも `valid === true` |
| 抽出結果 | candidates 19 / aliases 3 / conflicts 0 / rejected 20（Node と同一） |
| `candidate_evaluation.json` | Node 実行結果と **byte 完全一致**（SHA-256 `031139d9521283ee76e071414f33b15bb92c2de0dc2838a6d057c0c7a4ab7409`） |
| `candidate_review.md` | byte 完全一致 |
| `shareable_summary.json` | byte 完全一致 |
| page error | 0 件 |
| off-site request | 0 件（全て same-origin） |
| console への候補データ出力 | なし |

**結論：browser-memory processing は実現可能であり、固定 base SHA の Node 実行結果と
bit 単位で同一の結果を produce する。抽出ロジックの再実装も server 保存方式への後退も不要。**
したがって指示書 §10 の blocking 条件には該当しない。

なお本実測は Chromium のみで行った。Windows 実機の Edge / Chrome、および macOS Safari は未検証であり、
Checkpoint 2 以降の検証対象として残す。

---

## 14. 未解決事項

1. Chromium 以外の browser（Edge / Chrome on Windows、Safari）での実測は未実施。
2. 大規模入力（数百ページ PDF、数万行 Excel）における browser メモリ上限は未測定。
   contract 側で resource bounds を規定するが、実測は Checkpoint 2 以降。
3. 元の大型 ZIP `9e0ef6bf…` は未提供のため、その SHA-256 は検証していない。
4. Windows runtime 同梱の具体手順（bundled node の取得元・version 固定方法）は
   packaging checkpoint の対象であり本 Checkpoint の範囲外。
