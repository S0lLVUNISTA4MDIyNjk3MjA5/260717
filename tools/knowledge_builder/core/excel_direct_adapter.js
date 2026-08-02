/* Knowledge Data Contract 0.1 - Excel Direct Adapter (Alpha 0.2.0 Checkpoint 2).
 * Converts a raw .xlsx file (ArrayBuffer) DIRECTLY into KnowledgeNode / structural
 * KnowledgeEdge / SourceDocument objects, without going through the existing
 * Excel->JSON tool or its intermediate trace JSON format.
 *
 * Kept strictly separate from trace_json_adapter.js (that file is not modified by
 * this checkpoint; the existing Trace JSON path is untouched).
 *
 * Node hierarchy (minimal, per Checkpoint 1/2 scope): workbook -> document Node,
 * selected sheet -> section Node, each non-empty data row -> content Node
 * (node_type: 'statement' - see below).
 *
 * node_type neutrality: content Nodes always use 'statement' ("上記に分類しきれない
 * 意味単位（フォールバック）", already part of the frozen 0.1 enum, §3.2), regardless
 * of whether this file is ingested as "document A" or "document B". Unlike
 * trace_json_adapter.js's `role` ('requirement'/'design'), this adapter takes no
 * A/B-role parameter at all, so it cannot encode a fixed document-role assumption.
 *
 * export_binding is always null for every Node this adapter produces (document,
 * section, and content alike): a directly-read Excel row has no corresponding
 * legacy TraceRecord/Sidecar binding to prove compatibility with, so it must not
 * claim one (same reasoning trace_json_adapter.js already applies to its own
 * document/section structural Nodes - see structuralVerbatim/export_binding:null
 * there). knowledge_store.js's validateDataset()/recomputeExportContentHash() already
 * treat export_binding:null as a normal, expected case (no change needed there).
 *
 * Fail-closed rule: if a row's per-cell raw/display/ref cannot be captured in full,
 * this adapter throws rather than silently producing a lossy Node. Since the UI only
 * replaces the live dataset after BOTH document A and document B adapters resolve
 * successfully (see ingest() in the UI file), this failure aborts the whole ingest
 * atomically - it never produces a partial/one-sided commit.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KnowledgeExcelDirectAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function resolveIdHashUtils() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('./id_hash_utils.js');
    }
    if (globalThis.KnowledgeIdHashUtils) return globalThis.KnowledgeIdHashUtils;
    throw new Error('id_hash_utils.js (KnowledgeIdHashUtils) を読み込めません。');
  }

  function resolveXLSX() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('../ui/vendor/xlsx.full.min.js');
    }
    if (globalThis.XLSX) return globalThis.XLSX;
    throw new Error('xlsx.full.min.js (XLSX) を読み込めません。');
  }

  const { sourceDocumentId, nodeId, edgeId, nodeKnowledgeHash, edgeKnowledgeHash } = resolveIdHashUtils();

  // ---- 列記号フォールバック(見出し未判定/未指定時) ----
  // index0は「シート先頭列(A列)からの絶対列index」を渡すこと(使用範囲の先頭列からの相対indexではない。
  // 是正Checkpoint 2a: C列開始等、使用範囲がA列以外から始まるシートで誤った列記号を生成していた不具合を修正)。
  function columnLetter(index0) {
    let n = index0 + 1;
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // rawが「値なし」でないかどうか(0や falseは正当な値として扱う。nullish/空文字列だけを「値なし」とする)。
  function hasRawValue(cell) {
    return cell.raw !== null && cell.raw !== undefined && cell.raw !== '';
  }

  // 是正Checkpoint 2a.1: SheetJSはcellDates:trueの日付セルを、シリアル値を「実行環境のローカル時刻」の
  // 暦要素として解釈したDateオブジェクトで返す(内部的にlocalなDateコンストラクタを使うため)。
  // そのため同じ.xlsxファイルでも、読み取るマシンのタイムゾーンが違うとraw値(延いてはknowledge_hash)が
  // ずれてしまう。日付が本来タイムゾーンを持たない暦日である以上、返されたDateのローカル暦要素を
  // そのままUTC基準へ組み直すことで、実行環境に依存しない安定したraw値にする。
  function normalizeDateCellRaw(cell) {
    if (cell && cell.t === 'd' && cell.v instanceof Date) {
      const d = cell.v;
      return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()));
    }
    return cell ? (cell.v ?? null) : null;
  }

  // 是正Checkpoint 2a: 表示値(display)が空でも、数式(formula)を持つセルは「空セル」扱いにしない。
  // 是正Checkpoint 2a.1: 表示書式で非表示になっているだけでraw値を持つセルも同様に「空セル」扱いにしない
  // (原データを保持できる行を無言で捨てないため)。
  function cellHasContent(cell) {
    return String(cell.display ?? '').trim() !== '' || !!cell.formula || hasRawValue(cell);
  }

  // セルのtext表現。表示値があればそれを使い、表示値がない数式セルは"=数式"という固定表記にする
  // (是正Checkpoint 2a §2: 数式だけの行でも本文が不定にならないようにする)。
  // 是正Checkpoint 2a.1: 表示値も数式もないがraw値を持つセルは、raw値をそのまま文字列化する。
  function cellTextValue(cell) {
    const disp = String(cell.display ?? '').trim();
    if (disp !== '') return disp;
    if (cell.formula) return `=${cell.formula}`;
    if (hasRawValue(cell)) return String(cell.raw);
    return '';
  }

  /**
   * ワークブックを読み取り専用で解析する(inspectのみ・状態を変更しない)。UI非依存の純関数。
   * 是正Checkpoint 2b: 複数シート選択UIのため、各シートのempty(空シート)/hidden(非表示シート)を
   * ここで判定して返す(UI側で個別に判定ロジックを持たせない。判定はこの純関数だけの責務にする)。
   * @param {ArrayBuffer} arrayBuffer  .xlsxファイルの内容
   * @returns {{ workbook: object, sheetNames: {name:string, index:number, hidden:boolean, empty:boolean}[] }}
   */
  function inspectWorkbook(arrayBuffer) {
    const XLSX = resolveXLSX();
    let workbook;
    try {
      workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, cellFormula: true, cellNF: true, cellText: true });
    } catch (e) {
      throw new Error(`Excelファイルを読み取れません: ${e.message || e}`);
    }
    if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      throw new Error('ワークブックにシートがありません。');
    }
    const wbSheetMeta = (workbook.Workbook && Array.isArray(workbook.Workbook.Sheets)) ? workbook.Workbook.Sheets : [];
    const sheetNames = workbook.SheetNames.map((name, index) => {
      const worksheet = workbook.Sheets[name];
      const empty = !worksheet || !worksheet['!ref'];
      // Hidden: 0=表示, 1=非表示, 2=非常に非表示(いずれも1以上を「非表示」として扱う)。
      const meta = wbSheetMeta[index];
      const hidden = !!(meta && Number(meta.Hidden) >= 1);
      return { name, index, hidden, empty };
    });
    return { workbook, sheetNames };
  }

  /**
   * 選択したシートから、見出し行・データ開始行の指定に基づいて行データを抽出する(UI非依存の純関数)。
   * 空行は`isEmpty:true`として結果に含める(呼び出し側でNode化するかどうかを判断する。
   * プレビュー表示にも使うため、この時点ではまだ除外しない)。
   * @param {object} workbook  inspectWorkbook()が返したworkbookそのもの
   * @param {string} sheetName
   * @param {number} headerRowNumber  1始まり
   * @param {number} dataStartRowNumber  1始まり
   */
  function extractSheetRows(workbook, sheetName, headerRowNumber, dataStartRowNumber) {
    const XLSX = resolveXLSX();
    if (!workbook || !Array.isArray(workbook.SheetNames)) throw new Error('workbookが不正です。');
    const sheetIndex = workbook.SheetNames.indexOf(sheetName);
    if (sheetIndex < 0) throw new Error(`シート「${sheetName}」が見つかりません。`);
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet || !worksheet['!ref']) {
      throw new Error(`シート「${sheetName}」にデータがありません(空シート)。`);
    }
    if (!Number.isInteger(headerRowNumber) || headerRowNumber < 1) {
      throw new Error('見出し行番号は1以上の整数で指定してください。');
    }
    if (!Number.isInteger(dataStartRowNumber) || dataStartRowNumber < 1) {
      throw new Error('データ開始行番号は1以上の整数で指定してください。');
    }
    if (dataStartRowNumber <= headerRowNumber) {
      throw new Error('データ開始行番号は見出し行番号より後の行にしてください。');
    }

    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const firstCol = range.s.c, lastCol = range.e.c;
    const lastRow0 = range.e.r;

    if ((dataStartRowNumber - 1) > lastRow0) {
      throw new Error(`シート「${sheetName}」にデータ開始行(${dataStartRowNumber}行目)以降のデータがありません(空シート)。`);
    }

    // 見出し: 空欄または未指定の列は列記号(A, B, C...)にフォールバックする。
    const headerRow0 = headerRowNumber - 1;
    const rawHeaders = [];
    const headerIsFallback = [];
    for (let c = firstCol; c <= lastCol; c++) {
      const ref = XLSX.utils.encode_cell({ r: headerRow0, c });
      const cell = worksheet[ref];
      const text = cell && cell.w != null ? String(cell.w).trim() : (cell && cell.v != null ? String(cell.v).trim() : '');
      rawHeaders.push(text || columnLetter(c)); // 絶対列index(A列=0起点)で列記号を生成する
      headerIsFallback.push(!text);
    }
    // 列見出しの重複(まれ)は列記号を付けて一意化する(こちらも絶対列indexを使う)。
    const seen = new Map();
    const headers = rawHeaders.map((h, i) => {
      if (!seen.has(h)) { seen.set(h, 1); return h; }
      seen.set(h, seen.get(h) + 1);
      return `${h}(${columnLetter(firstCol + i)})`;
    });

    const rows = [];
    for (let r0 = dataStartRowNumber - 1; r0 <= lastRow0; r0++) {
      const cells = [];
      const warnings = [];
      let anyNonBlank = false;
      for (let ci = 0; ci < headers.length; ci++) {
        const c = firstCol + ci;
        const ref = XLSX.utils.encode_cell({ r: r0, c });
        const cell = worksheet[ref];
        const raw = normalizeDateCellRaw(cell);
        const display = cell ? (cell.w != null ? cell.w : (cell.v != null ? String(cell.v) : '')) : '';
        const formula = cell && cell.f ? String(cell.f) : null;
        const cellObj = { ref, header: headers[ci], raw, display, formula };
        // 是正Checkpoint 2a §2: 表示値が空でも数式を持つセルは空セル扱いにしない。
        // 是正Checkpoint 2a.1: raw値のみ持つセル(表示書式で非表示等)も空セル扱いにしない。
        if (cellHasContent(cellObj)) anyNonBlank = true;
        const displayIsBlank = String(display ?? '').trim() === '';
        // 是正Checkpoint 2b: 複数シートを同時に扱うため、警告にもsheet_name/sheet_indexを含め、
        // どのシートの警告かを一意に判別できるようにする(formula_no_display_value等をシート間で混同しない)。
        if (formula && displayIsBlank) {
          warnings.push({ code: 'formula_no_display_value', sheet_name: sheetName, sheet_index: sheetIndex, ref, header: headers[ci] });
        } else if (!formula && displayIsBlank && hasRawValue(cellObj)) {
          warnings.push({ code: 'raw_value_without_display', sheet_name: sheetName, sheet_index: sheetIndex, ref, header: headers[ci] });
        }
        cells.push(cellObj);
      }
      const rowNumber = r0 + 1;
      const cellRange = `${XLSX.utils.encode_cell({ r: r0, c: firstCol })}:${XLSX.utils.encode_cell({ r: r0, c: lastCol })}`;
      rows.push({ rowNumber, cellRange, cells, isEmpty: !anyNonBlank, warnings });
    }

    return {
      sheetName, sheetIndex, headerRowNumber, dataStartRowNumber,
      headers, headerIsFallback, usedRange: worksheet['!ref'], rows,
      nonEmptyRowCount: rows.filter(r => !r.isEmpty).length
    };
  }

  // 表示専用の省略(是正Checkpoint 2a §3): Node.titleそのものは保存時に切り詰めない。
  // 呼び出し側(プレビュー等の表示層)がこの関数を使って表示だけを省略する。
  function truncateForDisplay(s, max) {
    const str = String(s ?? '');
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  // 行の最初の非空セル値をtitleにする(全セル空欄はここに来ない。呼び出し側で空行を除外済み)。
  // 保存時は切り詰めない(§3)。表示値のない数式セルはcellTextValue()により固定表記になる(§2)。
  function deriveTitle(nonBlankCells, rowNumber) {
    if (!nonBlankCells.length) return `行${rowNumber}`;
    return cellTextValue(nonBlankCells[0]);
  }

  // 全非空セルを"見出し: 値"の形で連結した文字列をtextにする(Step 2で修正可能な初期値)。
  function deriveText(nonBlankCells) {
    return nonBlankCells.map(c => `${c.header}: ${cellTextValue(c)}`).join(' / ');
  }

  // 安全な完全一致・alias一致だけを初期タグにする(類義語・部分一致・AI推定は行わない)。
  // aliases は "エイリアス文字列 -> 正式タグ" の写像として扱う(tag_vocabulary.aliasesの向き)。
  function matchInitialTags(cellDisplayValues, tagVocabulary) {
    if (!tagVocabulary) return [];
    const allowed = new Set(tagVocabulary.allowed_tags || []);
    const aliases = tagVocabulary.aliases || {};
    const result = new Set();
    for (const raw of cellDisplayValues) {
      const value = String(raw ?? '').trim();
      if (!value) continue;
      if (allowed.has(value)) { result.add(value); continue; }
      if (Object.prototype.hasOwnProperty.call(aliases, value)) {
        const canonical = aliases[value];
        if (allowed.has(canonical)) result.add(canonical);
      }
    }
    return [...result];
  }

  function structuralVerbatim(label) {
    return { source_record: { title: String(label || '') }, source_record_display: null, source_row: 0 };
  }

  const EMPTY_SEMANTICS = () => ({
    subject: { text: null, concept_id: null },
    property: { text: null, concept_id: null },
    statement_type: 'information',
    derived_by: { type: 'ai', id: 'excel-direct-adapter' },
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
        generated_by: { type: 'ai', id: 'excel-direct-adapter' },
        generated_at: occurredAt,
        engine: 'excel-direct-adapter',
        source_node_knowledge_hash: parentNode.revision.knowledge_hash,
        target_node_knowledge_hash: childNode.revision.knowledge_hash
      },
      revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'excel-direct-adapter' }, updated_at: occurredAt },
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
   * 複数シートのextractSheetRows()結果からKnowledgeNode/Edgeを構築する(UI非依存の純関数)。
   * 是正Checkpoint 2b: 1つのworkbookから1つ以上のシートを選択し、同一文書内の複数sectionとして
   * 変換する。選択シート数によらずdocument Node/SourceDocumentは常に1件だけ生成する。
   * @param {object[]} extractions  extractSheetRows()の戻り値の配列(選択した各シート。1件以上必須)
   * @param {object} opts
   * @param {string} opts.fileName
   * @param {string} opts.contentDigest  実ファイルのSHA-256(64桁hex)
   * @param {string} opts.ingestedAt
   * @param {object|null} [opts.tagVocabulary]  {allowed_tags:string[], aliases:object}
   * @param {string|null} [opts.documentNumber]
   * @param {string|null} [opts.revisionLabel]
   */
  async function buildKnowledgeNodesFromExcelSheets(extractions, opts) {
    if (!Array.isArray(extractions) || extractions.length === 0) {
      throw new Error('取り込むシートを1つ以上選択してください。');
    }
    for (const extraction of extractions) {
      if (!extraction || !Array.isArray(extraction.rows)) throw new Error('extraction結果が不正です。');
    }

    const producer = 'excel';
    const fileName = String(opts.fileName || 'unknown.xlsx');
    const sourceDocId = await sourceDocumentId(producer, fileName, opts.contentDigest);

    const sourceDocument = {
      source_document_id: sourceDocId, file_name: fileName, producer,
      content_digest: opts.contentDigest, document_number: opts.documentNumber ?? null,
      revision: opts.revisionLabel ?? null, ingested_at: opts.ingestedAt, extensions: {}
    };

    const nodes = [];
    const edges = [];

    // document node (workbook)。選択シート数によらず1回だけ生成する(SourceDocumentも1件のみ)。
    const docLocator = { kind: 'excel', sheet: fileName, row: 0, source_path: '$.document' };
    const docNodeId = await nodeId(sourceDocId, docLocator);
    const docLabel = fileName;
    const docNode = await finalizeNode({
      node_id: docNodeId, node_type: 'document', text: docLabel, title: docLabel,
      tags: [], unregistered_tags: [], semantics: EMPTY_SEMANTICS(), quantities: [], parent_node_id: null,
      provenance: { source_document_id: sourceDocId, producer, locator: docLocator, verbatim: structuralVerbatim(docLabel), extensions: {} },
      revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'excel-direct-adapter' }, updated_at: opts.ingestedAt },
      review: DEFAULT_REVIEW(),
      // 直接入力: 既存TraceRecordSetに対応するレコードがなく、legacy Sidecar互換を主張しない。
      export_binding: null,
      confidence: 1.0, extensions: {}
    });
    nodes.push(docNode);

    // 決定性: Node生成順は利用者のチェック順ではなく、workbook内のsheet index順に固定する。
    // これにより、シート選択順を変えても正式ID集合・保存JSONの内容は変わらない。
    const sortedExtractions = [...extractions].sort((a, b) => a.sheetIndex - b.sheetIndex);

    for (const extraction of sortedExtractions) {
      // section node (選択sheet)
      const secLocator = { kind: 'excel', sheet: extraction.sheetName, row: 0, source_path: `$.section[${extraction.sheetName}]` };
      const secNodeId = await nodeId(sourceDocId, secLocator);
      const secLabel = extraction.sheetName;
      const sectionNode = await finalizeNode({
        node_id: secNodeId, node_type: 'section', text: secLabel, title: secLabel,
        tags: [], unregistered_tags: [], semantics: EMPTY_SEMANTICS(), quantities: [], parent_node_id: docNodeId,
        provenance: {
          source_document_id: sourceDocId, producer, locator: secLocator, verbatim: structuralVerbatim(secLabel),
          extensions: { sheet_index: extraction.sheetIndex }
        },
        revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'excel-direct-adapter' }, updated_at: opts.ingestedAt },
        review: DEFAULT_REVIEW(),
        export_binding: null,
        confidence: 1.0, extensions: {}
      });
      nodes.push(sectionNode);
      edges.push(await makeContainsEdge(docNode, sectionNode, opts.ingestedAt));

      let sectionContentNodeCount = 0;
      for (const row of extraction.rows) {
        if (row.isEmpty) continue; // 空行はNode化しない

        // fail-closed: 原データ(ref/header/raw/display)を再現できない行があれば、
        // その行だけ飛ばすのではなく文書全体をエラーにする(指示どおり)。
        for (const cell of row.cells) {
          if (cell.ref == null || cell.header == null || cell.raw === undefined || cell.display === undefined) {
            throw new Error(`シート「${extraction.sheetName}」行${row.rowNumber}のセル情報を再現できません。原データを保持できないため、この文書の取込を中止します。`);
          }
        }

        const locator = { kind: 'excel', sheet: extraction.sheetName, row: row.rowNumber, source_path: `$.rows[${row.rowNumber}]` };
        const contentNodeId = await nodeId(sourceDocId, locator);

        const sourceRecord = {}, sourceRecordDisplay = {}, formulas = {};
        for (const cell of row.cells) {
          sourceRecord[cell.header] = cell.raw;
          sourceRecordDisplay[cell.header] = cell.display;
          formulas[cell.header] = cell.formula;
        }

        const nonBlankCells = row.cells.filter(cellHasContent);
        const title = deriveTitle(nonBlankCells, row.rowNumber);
        const text = deriveText(nonBlankCells);
        const tags = matchInitialTags(nonBlankCells.map(c => cellTextValue(c)), opts.tagVocabulary);

        const contentNode = await finalizeNode({
          // node_type: A/B(文書の役割)によらず常に'statement'固定。requirement/design_itemには載せない。
          node_id: contentNodeId, node_type: 'statement', text, title,
          tags, unregistered_tags: [], semantics: EMPTY_SEMANTICS(), quantities: [], parent_node_id: sectionNode.node_id,
          provenance: {
            source_document_id: sourceDocId, producer, locator,
            verbatim: { source_record: sourceRecord, source_record_display: sourceRecordDisplay, source_row: row.rowNumber },
            extensions: {
              sheet_index: extraction.sheetIndex, cell_range: row.cellRange,
              column_headers: extraction.headers, formulas, input_mode: 'excel-direct',
              // 是正Checkpoint 2a §2: 表示値のない数式セル等の固定警告(code形式)を保存JSONにも残す。
              warnings: row.warnings
            }
          },
          revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'excel-direct-adapter' }, updated_at: opts.ingestedAt },
          review: DEFAULT_REVIEW(),
          // 直接入力content Node: 既存Sidecar互換を主張しない(document/sectionと同じ扱い)。
          export_binding: null,
          confidence: 1.0, extensions: {}
        });
        nodes.push(contentNode);
        edges.push(await makeContainsEdge(sectionNode, contentNode, opts.ingestedAt));
        sectionContentNodeCount++;
      }

      // 是正Checkpoint 2b: 選択したシートのうち1つでもNode候補0件なら、文書全体を失敗させる
      // (空行しかない/意図しないシートの選択ミスをそのままNode化しない)。
      if (sectionContentNodeCount === 0) {
        throw new Error(`シート「${extraction.sheetName}」から取込可能なNode候補が0件です。この文書の取込を中止します。`);
      }
    }

    return { sourceDocument, nodes, edges };
  }

  /**
   * extractSheetRows()の結果(単一シート)からKnowledgeNode/Edgeを構築する便宜関数。
   * buildKnowledgeNodesFromExcelSheets([extraction], opts) への薄いラッパー(単一シート専用の
   * 既存呼び出し元との後方互換のために残す)。
   * @param {object} extraction  extractSheetRows()の戻り値
   * @param {object} opts  buildKnowledgeNodesFromExcelSheets()と同じ
   */
  async function buildKnowledgeNodesFromExcel(extraction, opts) {
    return buildKnowledgeNodesFromExcelSheets([extraction], opts);
  }

  /**
   * inspectWorkbook -> extractSheetRows -> buildKnowledgeNodesFromExcel を通しで実行する便宜関数。
   * @param {ArrayBuffer} arrayBuffer
   * @param {object} opts  fileName, contentDigest, ingestedAt, sheetName, headerRow, dataStartRow,
   *                       tagVocabulary, documentNumber, revisionLabel
   */
  async function adaptExcelDirect(arrayBuffer, opts) {
    const { workbook } = inspectWorkbook(arrayBuffer);
    const extraction = extractSheetRows(workbook, opts.sheetName, opts.headerRow, opts.dataStartRow);
    const result = await buildKnowledgeNodesFromExcel(extraction, opts);
    return { extraction, ...result };
  }

  return Object.freeze({
    inspectWorkbook, extractSheetRows, buildKnowledgeNodesFromExcel, buildKnowledgeNodesFromExcelSheets, adaptExcelDirect,
    columnLetter, matchInitialTags, deriveTitle, deriveText,
    cellHasContent, cellTextValue, truncateForDisplay
  });
});
