#!/usr/bin/env node
/* Excel Direct Adapter Timezone Determinism Remediation - Checkpoint 2.
 *
 * Single-timezone probe, meant to be spawned as a child process with a specific TZ env var by
 * excel_direct_adapter_timezone_determinism_verification.js (never invoked directly as a test
 * itself). Runs the full excel_direct_adapter.js pipeline against one of the date fixtures under
 * whatever TZ the parent process set, and prints one JSON line to stdout with every value the
 * parent needs to compare across timezones. Kept separate from the fixtures used by the original
 * excel_direct_adapter_verification.js so that timezone-determinism coverage does not depend on
 * modifying that file or its existing assertions.
 *
 * Usage: node excel_direct_adapter_timezone_probe.js <mode>
 *   mode: 'basic' | 'datetime' | 'blank_display'
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Adapter = require('../core/excel_direct_adapter.js');
const RuleExtraction = require('../core/private_dictionary_rule_extraction_core.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TAG_VOCAB = { allowed_tags: ['安全', '性能', '機能', '品質', 'インターフェース', '製造', '検査', '保守'], aliases: {} };

function readAsArrayBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const MODE = process.argv[2];

const MODES = {
  basic: {
    file: 'excel_direct_fixture_date.xlsx', sheet: '日付あり', headerRow: 1, dataStartRow: 2,
    dateHeader: '納期', fileName: 'excel_direct_fixture_date.xlsx', contentDigest: 'd'.repeat(64),
  },
  datetime: {
    file: 'excel_direct_fixture_datetime.xlsx', sheet: '日時あり', headerRow: 1, dataStartRow: 2,
    dateHeader: '納期時刻', fileName: 'excel_direct_fixture_datetime.xlsx', contentDigest: 'a'.repeat(64),
  },
  blank_display: {
    file: 'excel_direct_fixture_date_blank_display.xlsx', sheet: '日付表示なし', headerRow: 1, dataStartRow: 2,
    dateHeader: '納期', fileName: 'excel_direct_fixture_date_blank_display.xlsx', contentDigest: 'b'.repeat(64),
  },
};

(async () => {
  const cfg = MODES[MODE];
  if (!cfg) { console.error('unknown mode: ' + MODE); process.exit(2); }

  const ab = readAsArrayBuffer(path.join(FIXTURES_DIR, cfg.file));
  const { workbook } = Adapter.inspectWorkbook(ab);
  const extraction = Adapter.extractSheetRows(workbook, cfg.sheet, cfg.headerRow, cfg.dataStartRow);
  const result = await Adapter.buildKnowledgeNodesFromExcel(extraction, {
    fileName: cfg.fileName, contentDigest: cfg.contentDigest,
    ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB,
  });
  const node = result.nodes.find(n => n.node_type === 'statement');
  const roundTripped = JSON.parse(JSON.stringify(node));

  const out = {
    tz: process.env.TZ || null,
    resolvedTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    rawIso: roundTripped.provenance.verbatim.source_record[cfg.dateHeader],
    display: node.provenance.verbatim.source_record_display[cfg.dateHeader],
    text: node.text,
    title: node.title,
    sourceDocumentId: result.sourceDocument.source_document_id,
    nodeId: node.node_id,
    knowledgeHash: node.revision.knowledge_hash,
  };

  // P2-A2 projection: the VALUE unit's normalized_text for the date column (Checkpoint 1 §5
  // conditional-risk item, Checkpoint 2 §7). Only meaningful when the raw value can end up used
  // (blank_display mode); computed unconditionally for all modes for a full before/after picture.
  const projection = await RuleExtraction.buildExtractionInputProjectionFromExcelAdapterResult(result);
  // KEY/VALUE units for the same column are pushed as a pair with consecutive occurrence_ordinal
  // values (KEY first, then VALUE - see buildExtractionInputProjectionFromExcelAdapterResult()),
  // so the reliable way to find "the VALUE unit paired with the 納期 KEY unit" is by ordinal
  // adjacency, not by shared parent_source_unit_id (every KEY/VALUE pair in the same row shares
  // the same ROW_RECORD parent, so that alone does not disambiguate columns).
  const dateKeyUnit = projection.units.find(u => u.structural_role === 'KEY' && u.normalized_text === cfg.dateHeader);
  const dateValueUnit = dateKeyUnit
    ? projection.units.find(u => u.structural_role === 'VALUE' && u.parent_source_unit_id === dateKeyUnit.parent_source_unit_id
        && u.occurrence_ordinal === dateKeyUnit.occurrence_ordinal + 1)
    : null;
  out.p2a2ValueNormalizedText = dateValueUnit ? dateValueUnit.normalized_text : null;

  process.stdout.write(JSON.stringify(out) + '\n');
})().catch(e => { console.error('PROBE_FATAL', e); process.exit(1); });
