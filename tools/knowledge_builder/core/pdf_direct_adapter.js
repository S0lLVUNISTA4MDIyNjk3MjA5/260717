/* Knowledge Data Contract 0.1 - PDF Direct Adapter (Alpha 0.2.0 Checkpoint 3a).
 * Converts a raw text-layer PDF (ArrayBuffer) DIRECTLY into KnowledgeNode / structural
 * KnowledgeEdge / SourceDocument objects, independent of the existing PDF->JSON tool's
 * trace-JSON intermediate format and independent of the Knowledge Builder UI.
 *
 * Kept strictly separate from trace_json_adapter.js and excel_direct_adapter.js
 * (neither file is modified by this checkpoint).
 *
 * Node hierarchy (Checkpoint 3a scope): PDF file -> document Node, each high-confidence
 * heading -> section Node, each merged paragraph -> content Node (node_type: 'statement').
 * A document with no headings, or with body text before its first heading, gets exactly
 * one synthetic section titled "本文" (provenance.extensions.synthetic = true) holding
 * that pre-heading/headingless content - never more than one per document.
 *
 * node_type neutrality: content Nodes always use 'statement' (same frozen 0.1 enum value
 * excel_direct_adapter.js uses), regardless of whether this file is ingested as document A
 * or document B - this adapter takes no A/B-role parameter at all.
 *
 * export_binding is always null for every Node this adapter produces (document, section,
 * and content alike): a directly-read PDF paragraph has no corresponding legacy
 * TraceRecord/Sidecar binding to prove compatibility with. Same reasoning as
 * excel_direct_adapter.js's structural/content Nodes.
 *
 * Fail-closed rule: if a paragraph's raw text, page position, or bbox cannot be captured in
 * full, this adapter throws (code: pdf_text_position_unrecoverable / verbatim_or_page_unrecoverable)
 * rather than silently producing a lossy Node or silently dropping the line - aborting the
 * whole document's ingest. Coordinates are validated in multiple layers (per-line in
 * extractPdfLayout, per-merged-paragraph in segmentPdfContent, and again per content Node in
 * buildKnowledgeNodesFromPdf) via isValidBBox() (Checkpoint 3a.1 §3).
 *
 * locator.page contract (Checkpoint 3a.1 §1 - the canonical Node/Edge IDs as of this
 * checkpoint): document Node -> page: null (a document has no single page); a normal
 * (heading-based) section -> its heading line's 1-indexed page; a synthetic "本文" section ->
 * its first child paragraph's 1-indexed page; a statement (content) Node -> its own
 * 1-indexed page. locator.page is never 0 for any Node this adapter produces.
 * provenance.extensions.page_index stays 0-indexed throughout, unchanged from Checkpoint 3a.
 *
 * pdf.js resource lifecycle (Checkpoint 3a.1 §2): every pdf.js PDFDocumentProxy this adapter
 * opens (in inspectPdf() and, separately, in extractPdfLayout() - see the Checkpoint 3a
 * "known constraint" about opening the PDF twice, which this checkpoint intentionally keeps)
 * is destroyed via doc.destroy() in a finally block (withPdfDocument()), covering every exit
 * path: successful completion, parse failure, encryption/password rejection, and any of the
 * safety-limit errors below. inspectPdf() never returns the raw PDFDocumentProxy (only
 * {numPages}), so no caller can accidentally hold a live Document past its destruction. Inside
 * extractPdfLayout()'s per-page loop, each PDFPageProxy's cleanup() is also called as soon as
 * that page's lines are extracted, before moving to the next page.
 *
 * ---- Reuse / porting notice ----
 * Source file for all ported logic: tools/alpha_release/pdf_excel_json_tools_alpha_v0.10.1_ai_review_handoff/
 *   pdf_tool/spec_to_json_conversion_tool_alpha_v0.10.1.html (existing PDF->JSON alpha tool).
 *
 * - extractPdfLayout() below is a near-verbatim port of that file's `extractPdfLayout(file)`
 *   (lines ~3299-3378), specifically its inner per-page item/line/bbox extraction algorithm
 *   (line-grouping by y-tolerance, in-line x-ordering, normalized bbox computation). NOT
 *   ported: `loadPdfJs()`/`extractWithPdfJsVariants()`/`window.pdfjsLib` browser-script-
 *   injection wrapper (replaced here by resolvePdfJs(), a UI-independent resolver mirroring
 *   excel_direct_adapter.js's resolveXLSX()); the `extractPdfLayoutWithOcr()` OCR fallback
 *   (OCR is out of scope for Checkpoint 3a); and the tab-joined multi-segment line text
 *   (that file joins wide-gap segments with "\t" to reconstruct table columns later - out of
 *   scope here since table structuring is explicitly excluded, so segments are instead
 *   joined with a single space and a `heading_or_table_layout_detected` warning is recorded).
 * - The fixed heading patterns in matchFixedHeadingLine() below are inspired by that file's
 *   default profile's `heading_rules` (`DEFAULT_PROFILE.extraction.heading_rules`, ~lines
 *   1421-1482) and its `compileHeadingRules(ex)`/`matchHeadingLine(text, line, rules,
 *   wantKind, d)` (lines 3503-3541), specifically the 第...章 / N.N numbering regex shapes.
 *   NOT ported: the configurable rule-compilation/profile system itself (`compileHeadingRules`,
 *   arbitrary `heading_rules`/`fields` JSON) - Checkpoint 3a explicitly forbids a
 *   user-configurable heading profile ("ユーザー設定可能な見出しプロファイル" is out of
 *   scope) and requires a single fixed minimal rule set instead, with only one heading
 *   level (no 章/節 parent-child auto-nesting, unlike nothing in the original either - the
 *   original also never auto-nests, it only assigns a flat `level` tag). The 第...節 marker
 *   was added to the chapter pattern below (the original profile only recognized 第...[章編]),
 *   per Checkpoint 3a's explicit example "第2節 使用条件".
 * - normalizeCellText(s) (that file, lines 3403-3405: NFKC + whitespace collapse + trim) is
 *   reused verbatim in spirit as normalizePdfText() below.
 * - matchInitialTags() below reuses excel_direct_adapter.js's exact-match/explicit-alias-match
 *   *rules* (not its code - this file is self-contained per adapter-independence), extended
 *   with NFKC normalization and ASCII case-folding for comparison only (the stored tag value
 *   is always the vocabulary's canonical string) - still exact/alias matching only, no
 *   partial-word/synonym/edit-distance/AI matching, per Checkpoint 3a's explicit tag rules.
 *
 * Nothing from the existing PDF tool's UI, global/module-level mutable state, or its
 * trace-JSON <-> PDF matching/scoring logic (`scoreAgainstPdf`, `v12ReviewCounts`, etc.) is
 * reused or referenced here.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KnowledgePdfDirectAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function isNodeEnvironment() {
    return typeof module === 'object' && !!module.exports && typeof require === 'function';
  }

  function resolveIdHashUtils() {
    if (isNodeEnvironment()) {
      return require('./id_hash_utils.js');
    }
    if (globalThis.KnowledgeIdHashUtils) return globalThis.KnowledgeIdHashUtils;
    throw new Error('id_hash_utils.js (KnowledgeIdHashUtils) を読み込めません。');
  }

  const { sourceDocumentId, nodeId, edgeId, nodeKnowledgeHash, edgeKnowledgeHash } = resolveIdHashUtils();

  // ---- 安全上限(Checkpoint 3a §上限。採用値と理由は各定数のコメントを参照) ----
  // ブラウザを固まらせないための上限。実務上妥当な大規模文書(数百〜2000ページ級の技術文書)を
  // 吸収しつつ、壊れたPDFや意図しない巨大ファイルでの無制限処理を防ぐ。
  const MAX_PAGES = 2000; // 一般的な大型マニュアルでも数百ページ程度。2000ページで十分な余裕を確保。
  const MAX_TEXT_ITEMS = 2000000; // 2000ページ×平均1000項目/ページ(密な文書)を吸収できる上限。
  const MAX_EXTRACTED_CHARS = 5000000; // 2000ページ×平均2500文字/ページを吸収できる上限。
  const MAX_STATEMENTS = 50000; // 2000ページ×平均25段落/ページ相当。Node生成・hashループの上限防止。

  // ---- 見出し判定(Checkpoint 3a §見出し判定: 固定された最小ルールのみ) ----
  // 「第1章 総則」「第2節 使用条件」等(章・編・節のいずれも高信頼の対象に含める。
  // 元ツールの既定プロファイルは章・編のみだったため、節をCheckpoint 3aの指示どおり追加した)。
  const CHAPTER_HEADING_RE = /^第[0-9０-９一二三四五六七八九十百]+[章編節][\s　]*(.*)$/;
  // 「1. 概要」「1.2 適用範囲」等(N、N.N、N.N.N…の番号付き見出し。階層化はしない=1段のみ)。
  const NUMBERED_HEADING_RE = /^([0-9０-９]+(?:[.．][0-9０-９]+)*[.．]?)[\s　]+(.+)$/;
  // 見出し候補のタイトル部分がこの文字数を超える場合は低信頼とみなす(短さを理由に昇格はしない。
  // 逆に極端に長い場合だけ「見出しらしくない」と判断して降格する、非対称なゲート)。
  const MAX_HEADING_TITLE_LENGTH = 60;

  /**
   * 1行のテキストが固定見出しルールに合致するかどうかを判定する(UI非依存の純関数)。
   * フォントサイズは一切参照しない(引数に含めていない)。行の短さだけで見出し化することもない
   * (パターンに一致しない限りどれだけ短くても見出しにならない)。
   * @returns {{confidence:'high'|'low', title:string}|null}
   */
  function matchFixedHeadingLine(text) {
    const t = String(text ?? '').trim();
    if (!t) return null;
    let m = t.match(CHAPTER_HEADING_RE);
    if (m) {
      const trailing = (m[1] || '').trim();
      if (!trailing) return null; // 見出しマーカーだけ(タイトルなし)は対象外
      return trailing.length > MAX_HEADING_TITLE_LENGTH ? { confidence: 'low', title: t } : { confidence: 'high', title: t };
    }
    m = t.match(NUMBERED_HEADING_RE);
    if (m) {
      const trailing = (m[2] || '').trim();
      if (!trailing) return null;
      return trailing.length > MAX_HEADING_TITLE_LENGTH ? { confidence: 'low', title: t } : { confidence: 'high', title: t };
    }
    return null;
  }

  // 元ツールのnormalizeCellText(s)(NFKC正規化+空白圧縮+trim)を踏襲した正規化(Checkpoint 3a)。
  // provenance.verbatim.source_raw_text(原文)には使わない。Node.text等の表示・比較用のみ。
  function normalizePdfText(s) {
    return String(s ?? '').normalize('NFKC').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---- pdf.js解決(Excel Adapterのresolvexxx()と同じ二重環境パターン) ----
  function resolvePdfJs() {
    if (isNodeEnvironment()) {
      const path = require('path');
      // ブラウザ向けpdf.jsフルビルドがwindow/atobを前提にしているため(alpha-local-factories.js)、
      // Node環境では最小限のシムを与える(atobはNode 16+の標準グローバル。追加ポリフィル不要)。
      if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
      const vendorDir = path.join(__dirname, '..', 'ui', 'vendor', 'pdfjs');
      require(path.join(vendorDir, 'cmaps-data.js'));
      require(path.join(vendorDir, 'fonts-data.js'));
      require(path.join(vendorDir, 'alpha-local-factories.js'));
      const pdfjsLib = require(path.join(vendorDir, 'pdf.min.js'));
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(path.join(vendorDir, 'pdf.worker.min.js'));
      }
      return pdfjsLib;
    }
    if (globalThis.pdfjsLib) return globalThis.pdfjsLib;
    throw new Error('pdf.js (pdfjsLib) を読み込めません。');
  }

  function buildGetDocumentOptions(arrayBuffer, password) {
    const opts = {
      // pdf.jsはdataに渡したUint8Arrayの裏付けバッファを解析中に detach することがあるため、
      // 呼び出し元のarrayBufferを直接渡さずコピーする(inspectPdf/extractPdfLayoutが同じ
      // arrayBufferを2回開いても壊れないようにするため)。
      data: new Uint8Array(arrayBuffer.slice(0)),
      disableWorker: isNodeEnvironment(), // Node実行時はfake worker(同一プロセス内実行)を使う
      useWorkerFetch: false,
      isEvalSupported: false
    };
    if (globalThis.AlphaLocalCMapReaderFactory) { opts.CMapReaderFactory = globalThis.AlphaLocalCMapReaderFactory; opts.cMapPacked = true; }
    if (globalThis.AlphaLocalStandardFontDataFactory) opts.StandardFontDataFactory = globalThis.AlphaLocalStandardFontDataFactory;
    if (password != null) opts.password = password;
    return opts;
  }

  function classifyOpenError(e) {
    const name = e && e.name;
    const msg = String((e && e.message) || e || '');
    if (name === 'PasswordException' || /password/i.test(msg)) {
      const err = new Error('PDFが暗号化されているか、パスワードが必要です。');
      err.code = 'pdf_encrypted_or_password_required';
      return err;
    }
    const err = new Error(`PDFを解析できません: ${msg}`);
    err.code = 'pdf_parse_failed';
    return err;
  }

  // ---- 安全上限判定(Checkpoint 3a.1 §4: 純関数として分離し、巨大PDFを生成せずに
  // 境界値(上限ちょうどはPASS・上限+1はERROR)をテストできるようにする) ----
  function assertPageCountWithinLimit(numPages) {
    if (!Number.isInteger(numPages) || numPages < 1) {
      const err = new Error('PDFの総ページ数が0です。');
      err.code = 'pdf_zero_pages';
      throw err;
    }
    if (numPages > MAX_PAGES) {
      const err = new Error(`PDFの総ページ数(${numPages})が安全上限(${MAX_PAGES})を超えています。処理を中止しました。`);
      err.code = 'page_count_limit_exceeded';
      throw err;
    }
  }

  function assertTextItemCountWithinLimit(totalItems, page) {
    if (totalItems > MAX_TEXT_ITEMS) {
      const err = new Error(`抽出したtext item数が安全上限(${MAX_TEXT_ITEMS})を超えました(ページ${page}時点)。処理を中止しました。`);
      err.code = 'text_item_limit_exceeded';
      throw err;
    }
  }

  function assertExtractedCharCountWithinLimit(totalChars, page) {
    if (totalChars > MAX_EXTRACTED_CHARS) {
      const err = new Error(`抽出した総文字数が安全上限(${MAX_EXTRACTED_CHARS})を超えました(ページ${page}時点)。処理を中止しました。`);
      err.code = 'extracted_char_limit_exceeded';
      throw err;
    }
  }

  function assertStatementCountWithinLimit(totalParagraphs) {
    if (totalParagraphs > MAX_STATEMENTS) {
      const err = new Error(`生成予定のstatement数(${totalParagraphs})が安全上限(${MAX_STATEMENTS})を超えています。処理を中止しました。`);
      err.code = 'statement_count_limit_exceeded';
      throw err;
    }
  }

  // ---- 座標のfail-closed検証(Checkpoint 3a.1 §3) ----
  // bboxは正規化済み(0..1)の有限数4要素で、x0<=x1・top<=bottomを満たす必要がある。
  function isValidBBox(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return false;
    const [x0, top, x1, bottom] = bbox;
    if (![x0, top, x1, bottom].every(Number.isFinite)) return false;
    if (x0 < 0 || x0 > 1 || top < 0 || top > 1 || x1 < 0 || x1 > 1 || bottom < 0 || bottom > 1) return false;
    if (x0 > x1 || top > bottom) return false;
    return true;
  }

  // ---- pdf.jsリソースの確実な解放(Checkpoint 3a.1 §2) ----
  // getDocument()に成功した場合、fn(doc)の実行が成功・失敗いずれの場合もfinallyでdoc.destroy()する。
  // getDocument()自体が失敗した場合(解析失敗・暗号化等)はdocが存在しないため破棄対象もない。
  async function withPdfDocument(arrayBuffer, fn) {
    const pdfjsLib = resolvePdfJs();
    let doc;
    try {
      doc = await pdfjsLib.getDocument(buildGetDocumentOptions(arrayBuffer)).promise;
    } catch (e) {
      throw classifyOpenError(e);
    }
    try {
      return await fn(doc);
    } finally {
      try { await doc.destroy(); } catch (e) { /* 破棄失敗は握りつぶす(既に解放済み等) */ }
    }
  }

  /**
   * PDFを開き、基本情報だけを検証する軽量な事前チェック(UI非依存の純関数)。
   * ページ数の安全上限もここで検証する(本格抽出の前に早期にfail-closedする)。
   * 開いたpdf.js Documentは成功・失敗どちらの経路でも必ずdestroy()する(生のDocumentは返さない)。
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<{numPages:number}>}
   */
  async function inspectPdf(arrayBuffer) {
    return withPdfDocument(arrayBuffer, async (doc) => {
      const numPages = doc.numPages;
      assertPageCountWithinLimit(numPages);
      return { numPages };
    });
  }

  /**
   * PDFのページ・行レイアウトを抽出する(UI非依存の純関数)。是正: 元ツールextractPdfLayout()の
   * 内部アルゴリズム(行グルーピング・bbox計算)を移植し、ブラウザ専用のロード処理を除去したもの。
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<{pages: Array<Array<Line>>, numPages:number, totalChars:number,
   *                     perPageCharCounts:number[], warnings:object[]}>}
   *   Line = {text, rawText, segs, hasMultiSegment, page(1始まり), pageIndex(0始まり), bbox}
   */
  async function extractPdfLayout(arrayBuffer) {
    return withPdfDocument(arrayBuffer, async (doc) => {
      const numPages = doc.numPages;
      assertPageCountWithinLimit(numPages);

      const pages = [];
      const warnings = [];
      const perPageCharCounts = [];
      let totalChars = 0;
      let totalItems = 0;

      for (let p = 1; p <= numPages; p++) {
        const page = await doc.getPage(p);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const tc = await page.getTextContent();
          const rawItems = tc.items
            .filter(it => String(it.str || '').trim() !== '')
            .map(it => ({
              str: String(it.str || ''),
              x: it.transform[4],
              y: it.transform[5],
              w: it.width || 0,
              h: it.height || Math.abs(it.transform[3]) || 10
            }));

          totalItems += rawItems.length;
          assertTextItemCountWithinLimit(totalItems, p);

          const pageChars = rawItems.reduce((a, i) => a + i.str.length, 0);
          totalChars += pageChars;
          perPageCharCounts.push(pageChars);
          assertExtractedCharCountWithinLimit(totalChars, p);

          // 是正: 元ツールextractPdfLayout()と同じy座標グルーピング(行判定の許容誤差)。
          const lines = [];
          for (const it of rawItems) {
            const tol = Math.max(it.h * 0.6, 3);
            let line = lines.find(L => Math.abs(L.y - it.y) <= tol);
            if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
            line.items.push(it);
          }
          lines.sort((a, b) => b.y - a.y); // 上から下へ

          const outLines = [];
          if (rawItems.length === 0) {
            warnings.push({ code: 'page_extracted_text_empty', page: p, block_id: null });
          }

          for (const L of lines) {
            L.items.sort((a, b) => a.x - b.x);
            const segs = [];
            let cur = '', prevEnd = null, fh = L.items[0].h || 10;
            for (const it of L.items) {
              if (prevEnd !== null && it.x - prevEnd > Math.max(fh * 1.6, 12)) { segs.push(cur); cur = ''; }
              cur += it.str;
              prevEnd = it.x + it.w;
              if (it.h) fh = it.h;
            }
            segs.push(cur);
            const cleanSegs = segs.map(s => s.trim()).filter(s => s !== '');
            if (cleanSegs.length === 0) continue; // 本当に文字が1つもない行(原文自体が存在しない)
            // 是正Checkpoint 3a: 表・多段組みらしい配置(大きな水平ギャップ=複数segs)を検出しても、
            // 元ツールのようにタブ結合してテーブル復元用に温存しない(表構造化は対象外)。単一の空白で
            // 結合し、通常の本文として保持する。検出したこと自体は固定警告として記録する。
            const text = cleanSegs.join(' ');
            const hasMultiSegment = cleanSegs.length >= 2;

            const xs = L.items.map(i => i.x);
            const x1s = L.items.map(i => i.x + Math.max(0, i.w));
            const ys = L.items.map(i => i.y - Math.max(1, i.h) * 0.25);
            const y1s = L.items.map(i => i.y + Math.max(1, i.h));
            // 是正Checkpoint 3a.1 §3: 原文(text)は存在するのに座標が復元できない場合、その行だけ
            // 無言でcontinueして捨てるのではなく、文書全体をfail-closedする。
            if (![...xs, ...x1s, ...ys, ...y1s].every(Number.isFinite)) {
              const err = new Error(`ページ${p}の行(原文: "${text}")の座標を復元できません。原データを保持できないため、この文書の取込を中止します。`);
              err.code = 'pdf_text_position_unrecoverable';
              throw err;
            }
            const x0 = Math.min(...xs), x1 = Math.max(...x1s);
            const y0pdf = Math.min(...ys), y1pdf = Math.max(...y1s);
            const top = Math.max(0, Math.min(1, (viewport.height - y1pdf) / Math.max(1, viewport.height)));
            const bottom = Math.max(0, Math.min(1, (viewport.height - y0pdf) / Math.max(1, viewport.height)));
            const bbox = [
              Math.max(0, Math.min(1, x0 / Math.max(1, viewport.width))),
              top,
              Math.max(0, Math.min(1, x1 / Math.max(1, viewport.width))),
              bottom
            ];
            if (!isValidBBox(bbox)) {
              const err = new Error(`ページ${p}の行(原文: "${text}")のbboxが不正です(実際: ${JSON.stringify(bbox)})。原データを保持できないため、この文書の取込を中止します。`);
              err.code = 'pdf_text_position_unrecoverable';
              throw err;
            }
            outLines.push({ text, rawText: text, segs: cleanSegs, hasMultiSegment, page: p, pageIndex: p - 1, bbox });
          }
          pages.push(outLines);
        } finally {
          // 是正Checkpoint 3a.1 §2: 処理済みpageのリソースを可能な限り都度解放する。
          try { page.cleanup(); } catch (e) { /* cleanup失敗は無視(最終的にdoc.destroy()で解放される) */ }
        }
      }

      if (totalChars === 0) {
        const err = new Error('全ページで抽出テキストが0文字でした(画像PDF・スキャンPDFの可能性があります。OCRは対象外です)。');
        err.code = 'no_extractable_text';
        throw err;
      }

      return { pages, numPages, totalChars, perPageCharCounts, warnings };
    });
  }

  // ---- 段落結合(Checkpoint 3a §段落: 保守的。不確実なら結合しない) ----
  function shouldMergeLines(prevLine, nextLine) {
    if (!prevLine.bbox || !nextLine.bbox || prevLine.bbox.length !== 4 || nextLine.bbox.length !== 4) return false;
    const prevBottom = prevLine.bbox[3], prevLeft = prevLine.bbox[0];
    const nextTop = nextLine.bbox[1], nextLeft = nextLine.bbox[0];
    const prevHeight = prevLine.bbox[3] - prevLine.bbox[1];
    const nextHeight = nextLine.bbox[3] - nextLine.bbox[1];
    const lineHeight = Math.max(prevHeight, nextHeight, 0.001);
    const gap = nextTop - prevBottom;
    if (gap < -0.001) return false; // 行順が乱れている/重なっている場合は結合しない(不確実)
    if (gap > lineHeight * 0.6) return false; // 行間が広すぎる場合は別段落とみなす
    if (Math.abs(nextLeft - prevLeft) > 0.03) return false; // 左端がそろっていない場合は結合しない
    return true;
  }

  /**
   * extractPdfLayout()の結果から、見出し・synthetic「本文」section・段落(statement候補)への
   * 分割を行う(UI非依存の純関数)。ページ境界を越えた段落結合は行わない。
   * @param {object} layout  extractPdfLayout()の戻り値
   * @returns {{sections: object[], warnings: object[]}}
   */
  function segmentPdfContent(layout) {
    const sections = [];
    const warnings = [...layout.warnings];
    let currentSection = null; // {title, synthetic, headingConfidence, headingPage, paragraphs:[]}
    let pendingLines = []; // 結合中の行(同一ページ内)

    function ensureSyntheticSectionIfNeeded() {
      if (!currentSection) {
        currentSection = { title: '本文', synthetic: true, headingConfidence: null, headingPage: null, paragraphs: [] };
        sections.push(currentSection);
      }
    }

    function flushParagraph() {
      if (pendingLines.length === 0) return;
      ensureSyntheticSectionIfNeeded();
      const secIndex = sections.length - 1;
      const paraIndex = currentSection.paragraphs.length;
      const blockId = `blk-${secIndex}-${paraIndex}`;
      const rawText = pendingLines.map(l => l.rawText).join('\n');
      const normalizedText = normalizePdfText(pendingLines.map(l => l.text).join(' '));
      if (normalizedText === '') { pendingLines = []; return; } // 空白だけの段落はNode化しない

      const xs0 = pendingLines.map(l => l.bbox[0]), ys0 = pendingLines.map(l => l.bbox[1]);
      const xs1 = pendingLines.map(l => l.bbox[2]), ys1 = pendingLines.map(l => l.bbox[3]);
      const bbox = [Math.min(...xs0), Math.min(...ys0), Math.max(...xs1), Math.max(...ys1)];
      // 是正Checkpoint 3a.1 §3: 個々の行bboxはextractPdfLayout()で検証済みだが、結合後の
      // 段落bboxもここで再検証する(多層防御。無言で欠落させず、不正ならfail-closedする)。
      if (!isValidBBox(bbox)) {
        const err = new Error(`ページ${pendingLines[0].page}の段落(原文冒頭: "${rawText.slice(0, 30)}")のbboxが不正です(実際: ${JSON.stringify(bbox)})。原データを保持できないため、この文書の取込を中止します。`);
        err.code = 'pdf_text_position_unrecoverable';
        throw err;
      }
      const paraWarnings = [];
      if (pendingLines.some(l => l.hasMultiSegment)) {
        paraWarnings.push({ code: 'heading_or_table_layout_detected', page: pendingLines[0].page, block_id: blockId });
      }
      if (pendingLines.some(l => l.lowConfidenceHeadingCandidate)) {
        paraWarnings.push({ code: 'heading_candidate_low_confidence', page: pendingLines[0].page, block_id: blockId });
      }
      warnings.push(...paraWarnings);

      currentSection.paragraphs.push({
        blockId, page: pendingLines[0].page, pageIndex: pendingLines[0].pageIndex,
        bbox, lineCount: pendingLines.length, rawText, normalizedText, warnings: paraWarnings
      });
      pendingLines = [];
    }

    for (const pageLines of layout.pages) {
      pendingLines = []; // 是正Checkpoint 3a §段落: ページ境界を越えて段落を結合しない(ページ毎にリセット)
      let prevLineForMerge = null;
      for (const line of pageLines) {
        const headingMatch = matchFixedHeadingLine(line.text);
        if (headingMatch && headingMatch.confidence === 'high') {
          flushParagraph();
          currentSection = {
            title: headingMatch.title, synthetic: false, headingConfidence: 'high',
            headingPage: line.page, paragraphs: []
          };
          sections.push(currentSection);
          prevLineForMerge = null;
          continue;
        }
        if (headingMatch && headingMatch.confidence === 'low') {
          line.lowConfidenceHeadingCandidate = true;
        }
        if (prevLineForMerge && pendingLines.length > 0 && shouldMergeLines(prevLineForMerge, line)) {
          pendingLines.push(line);
        } else {
          flushParagraph();
          pendingLines.push(line);
        }
        prevLineForMerge = line;
      }
      flushParagraph();
    }

    if (sections.length === 0) {
      const err = new Error('抽出できたNode候補が0件です。');
      err.code = 'no_node_candidates';
      throw err;
    }
    const totalParagraphs = sections.reduce((a, s) => a + s.paragraphs.length, 0);
    if (totalParagraphs === 0) {
      const err = new Error('抽出できたNode候補が0件です。');
      err.code = 'no_node_candidates';
      throw err;
    }
    assertStatementCountWithinLimit(totalParagraphs);

    return { sections, warnings };
  }

  // ---- タグ(Checkpoint 3a §タグ: Excel直接入力と同じ条件+NFKC/ASCII大文字小文字無視) ----
  // 完全一致・明示alias一致のみ(部分一致・類義語推定・編集距離・AI推定は行わない)。
  // 比較のためだけにNFKC正規化+ASCII大文字小文字を無視する。保存されるタグ値は常に
  // 語彙側の正式な文字列(正規化前)を使う。
  function foldForTagCompare(s) {
    return String(s ?? '').normalize('NFKC').trim().replace(/[A-Za-z]/g, c => c.toLowerCase());
  }

  function matchInitialTags(candidateValues, tagVocabulary) {
    if (!tagVocabulary) return [];
    const allowed = tagVocabulary.allowed_tags || [];
    const aliases = tagVocabulary.aliases || {};
    const allowedByFold = new Map(allowed.map(tag => [foldForTagCompare(tag), tag]));
    const aliasByFold = new Map(Object.keys(aliases).map(k => [foldForTagCompare(k), aliases[k]]));
    const result = new Set();
    for (const raw of candidateValues) {
      const folded = foldForTagCompare(raw);
      if (!folded) continue;
      if (allowedByFold.has(folded)) { result.add(allowedByFold.get(folded)); continue; }
      if (aliasByFold.has(folded)) {
        const canonical = aliasByFold.get(folded);
        if (allowedByFold.has(foldForTagCompare(canonical))) result.add(allowedByFold.get(foldForTagCompare(canonical)));
      }
    }
    return [...result];
  }

  function structuralVerbatim(label) {
    return { source_raw_text: String(label || '') };
  }

  const EMPTY_SEMANTICS = () => ({
    subject: { text: null, concept_id: null },
    property: { text: null, concept_id: null },
    statement_type: 'information',
    derived_by: { type: 'ai', id: 'pdf-direct-adapter' },
    extensions: {}
  });

  const DEFAULT_REVIEW = () => ({
    human: { status: 'unreviewed', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null },
    ai: { status: 'unreviewed', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null, method: null, model: null }
  });

  async function finalizeNode(node) {
    node.revision.knowledge_hash = await nodeKnowledgeHash(node);
    return node;
  }

  async function makeContainsEdge(parentNode, childNode, occurredAt) {
    const eid = await edgeId(parentNode.node_id, childNode.node_id, 'structural', 'contains');
    const edge = {
      edge_id: eid,
      source_node_id: parentNode.node_id,
      target_node_id: childNode.node_id,
      relation_category: 'structural',
      relation_type: 'contains',
      lifecycle: 'active',
      confidence: 1.0,
      evidence: { matching_profile_id: null, features: [{ feature: 'hierarchy', detail: { parent: parentNode.node_id, child: childNode.node_id }, effect: 'supports' }] },
      generation: {
        generated_by: { type: 'ai', id: 'pdf-direct-adapter' },
        generated_at: occurredAt,
        engine: 'pdf-direct-adapter',
        source_node_knowledge_hash: parentNode.revision.knowledge_hash,
        target_node_knowledge_hash: childNode.revision.knowledge_hash
      },
      revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'pdf-direct-adapter' }, updated_at: occurredAt },
      review: {
        human: { status: 'not_applicable', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null },
        ai: { status: 'not_applicable', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null, method: null, model: null }
      },
      extensions: {}
    };
    edge.revision.knowledge_hash = await edgeKnowledgeHash(edge);
    return edge;
  }

  /**
   * segmentPdfContent()の結果からKnowledgeNode/Edgeを構築する(UI非依存の純関数)。
   * @param {object} segmented  segmentPdfContent()の戻り値
   * @param {object} opts
   * @param {string} opts.fileName
   * @param {string} opts.contentDigest  実ファイルのSHA-256(64桁hex)
   * @param {string} opts.ingestedAt
   * @param {object|null} [opts.tagVocabulary]
   * @param {string|null} [opts.documentNumber]
   * @param {string|null} [opts.revisionLabel]
   */
  async function buildKnowledgeNodesFromPdf(segmented, opts) {
    if (!segmented || !Array.isArray(segmented.sections) || segmented.sections.length === 0) {
      const err = new Error('抽出できたNode候補が0件です。');
      err.code = 'no_node_candidates';
      throw err;
    }
    const totalParagraphs = segmented.sections.reduce((a, s) => a + s.paragraphs.length, 0);
    if (totalParagraphs === 0) {
      const err = new Error('抽出できたNode候補が0件です。');
      err.code = 'no_node_candidates';
      throw err;
    }

    const producer = 'pdf';
    const fileName = String(opts.fileName || 'unknown.pdf');
    const sourceDocId = await sourceDocumentId(producer, fileName, opts.contentDigest);

    const sourceDocument = {
      source_document_id: sourceDocId, file_name: fileName, producer,
      content_digest: opts.contentDigest, document_number: opts.documentNumber ?? null,
      revision: opts.revisionLabel ?? null, ingested_at: opts.ingestedAt, extensions: {}
    };

    const nodes = [];
    const edges = [];

    // document node (PDFファイル)。ページ数・section数によらず1回だけ生成する。
    // 是正Checkpoint 3a.1 §1: document Nodeはページに紐付かないため page=null とする
    // (page=0を生成しない。0は「1ページ目」と誤読されうる不正な値のため使わない)。
    const docLocator = { kind: 'pdf', page: null, source_path: '$.document', section_id: null, section_title: null, block_id: null };
    const docNodeId = await nodeId(sourceDocId, docLocator);
    const docLabel = fileName;
    const docNode = await finalizeNode({
      node_id: docNodeId, node_type: 'document', text: docLabel, title: docLabel,
      tags: [], unregistered_tags: [], semantics: EMPTY_SEMANTICS(), quantities: [], parent_node_id: null,
      provenance: { source_document_id: sourceDocId, producer, locator: docLocator, verbatim: structuralVerbatim(docLabel), extensions: {} },
      revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'pdf-direct-adapter' }, updated_at: opts.ingestedAt },
      review: DEFAULT_REVIEW(),
      export_binding: null,
      confidence: 1.0, extensions: {}
    });
    nodes.push(docNode);

    for (let secIndex = 0; secIndex < segmented.sections.length; secIndex++) {
      const sec = segmented.sections[secIndex];
      const sectionId = `sec-${secIndex}`;
      // 是正Checkpoint 3a.1 §1: 通常sectionは見出し行の1始まりページ、synthetic sectionは
      // 最初の子paragraphの1始まりページを使う(どちらも必ず1以上。0やnullは生成しない)。
      const sectionPage = sec.synthetic ? (sec.paragraphs[0] && sec.paragraphs[0].page) : sec.headingPage;
      if (!Number.isInteger(sectionPage) || sectionPage < 1) {
        const err = new Error(`section[${secIndex}]のページ番号を決定できません(synthetic=${sec.synthetic})。原データを保持できないため、この文書の取込を中止します。`);
        err.code = 'pdf_text_position_unrecoverable';
        throw err;
      }
      const secLocator = {
        kind: 'pdf', page: sectionPage, source_path: `$.sections[${secIndex}]`,
        section_id: sectionId, section_title: sec.title, block_id: null
      };
      const secNodeId = await nodeId(sourceDocId, secLocator);
      const sectionNode = await finalizeNode({
        node_id: secNodeId, node_type: 'section', text: sec.title, title: sec.title,
        tags: [], unregistered_tags: [], semantics: EMPTY_SEMANTICS(), quantities: [], parent_node_id: docNodeId,
        provenance: {
          source_document_id: sourceDocId, producer, locator: secLocator, verbatim: structuralVerbatim(sec.title),
          extensions: { heading_confidence: sec.headingConfidence, synthetic: sec.synthetic }
        },
        revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'pdf-direct-adapter' }, updated_at: opts.ingestedAt },
        review: DEFAULT_REVIEW(),
        export_binding: null,
        confidence: 1.0, extensions: {}
      });
      nodes.push(sectionNode);
      edges.push(await makeContainsEdge(docNode, sectionNode, opts.ingestedAt));

      for (let paraIndex = 0; paraIndex < sec.paragraphs.length; paraIndex++) {
        const para = sec.paragraphs[paraIndex];

        // fail-closed: 原文・ページ位置・bboxを再現できない段落があれば、その段落だけ飛ばすのでは
        // なく文書全体をエラーにする(是正Checkpoint 3a.1 §3: bboxもここで再検証する)。
        if (typeof para.rawText !== 'string' || para.rawText === '' ||
          !Number.isInteger(para.page) || para.page < 1) {
          const err = new Error(`section[${secIndex}] paragraph[${paraIndex}]の原文またはページ位置を再現できません。原データを保持できないため、この文書の取込を中止します。`);
          err.code = 'verbatim_or_page_unrecoverable';
          throw err;
        }
        if (!isValidBBox(para.bbox)) {
          const err = new Error(`section[${secIndex}] paragraph[${paraIndex}]のbboxが不正です(実際: ${JSON.stringify(para.bbox)})。原データを保持できないため、この文書の取込を中止します。`);
          err.code = 'pdf_text_position_unrecoverable';
          throw err;
        }

        const blockId = para.blockId || `blk-${secIndex}-${paraIndex}`;
        const locator = {
          kind: 'pdf', page: para.page, source_path: `$.sections[${secIndex}].paragraphs[${paraIndex}]`,
          section_id: sectionId, section_title: sec.title, block_id: blockId
        };
        const contentNodeId = await nodeId(sourceDocId, locator);
        const tags = matchInitialTags([para.normalizedText], opts.tagVocabulary);

        const contentNode = await finalizeNode({
          // node_type: A/B(文書の役割)によらず常に'statement'固定。
          node_id: contentNodeId, node_type: 'statement', text: para.normalizedText, title: para.normalizedText,
          tags, unregistered_tags: [], semantics: EMPTY_SEMANTICS(), quantities: [], parent_node_id: sectionNode.node_id,
          provenance: {
            source_document_id: sourceDocId, producer, locator,
            verbatim: { source_raw_text: para.rawText },
            extensions: {
              page_index: para.pageIndex, bbox: para.bbox, line_count: para.lineCount,
              input_mode: 'pdf-direct', heading_confidence: sec.headingConfidence, synthetic: sec.synthetic,
              warnings: para.warnings || []
            }
          },
          revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'pdf-direct-adapter' }, updated_at: opts.ingestedAt },
          review: DEFAULT_REVIEW(),
          export_binding: null,
          confidence: 1.0, extensions: {}
        });
        nodes.push(contentNode);
        edges.push(await makeContainsEdge(sectionNode, contentNode, opts.ingestedAt));
      }
    }

    return { sourceDocument, nodes, edges, warnings: segmented.warnings };
  }

  /**
   * inspectPdf -> extractPdfLayout -> segmentPdfContent -> buildKnowledgeNodesFromPdf を
   * 通しで実行する便宜関数。
   * @param {ArrayBuffer} arrayBuffer
   * @param {object} opts  fileName, contentDigest, ingestedAt, tagVocabulary, documentNumber, revisionLabel
   */
  async function adaptPdfDirect(arrayBuffer, opts) {
    await inspectPdf(arrayBuffer); // 早期のページ数/暗号化チェック(下のextractPdfLayoutも再検証する)
    const layout = await extractPdfLayout(arrayBuffer);
    const segmented = segmentPdfContent(layout);
    const result = await buildKnowledgeNodesFromPdf(segmented, opts);
    return { layout, segmented, ...result };
  }

  return Object.freeze({
    inspectPdf, extractPdfLayout, segmentPdfContent, buildKnowledgeNodesFromPdf, adaptPdfDirect,
    matchFixedHeadingLine, normalizePdfText, matchInitialTags, isValidBBox,
    assertPageCountWithinLimit, assertTextItemCountWithinLimit,
    assertExtractedCharCountWithinLimit, assertStatementCountWithinLimit,
    MAX_PAGES, MAX_TEXT_ITEMS, MAX_EXTRACTED_CHARS, MAX_STATEMENTS
  });
});
