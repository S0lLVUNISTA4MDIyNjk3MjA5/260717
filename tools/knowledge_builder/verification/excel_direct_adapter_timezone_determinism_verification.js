#!/usr/bin/env node
/* Excel Direct Adapter Timezone Determinism Remediation - Checkpoint 2 permanent regression.
 *
 * Confirms that excel_direct_adapter.js produces byte-identical results for the same .xlsx
 * bytes regardless of the host process's timezone. Each timezone runs the full adapter
 * pipeline (inspectWorkbook -> extractSheetRows -> buildKnowledgeNodesFromExcel) in its own,
 * separate Node child process (spawned via excel_direct_adapter_timezone_probe.js with TZ set
 * in that child's environment), because V8's Date/Intl engine caches the host timezone at
 * startup and mutating process.env.TZ in-process is not a reliable way to change it afterward.
 *
 * Required zones (per remediation instruction): UTC, Asia/Tokyo, Asia/Shanghai,
 * America/New_York, plus Asia/Kolkata - a second historical non-integer-minute LMT-offset
 * zone (India: LMT +5:21 vs modern +5:30, a ~9min residual under the old, unfixed code path;
 * see Checkpoint 1's root-cause report), confirmed in Checkpoint 1 to reproduce the same
 * defect class as Asia/Shanghai (LMT +8:05:43 vs modern +8:00) before this fix, and therefore
 * kept here as permanent coverage rather than only Asia/Shanghai.
 *
 * Run: node tools/knowledge_builder/verification/excel_direct_adapter_timezone_determinism_verification.js
 */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const PROBE = path.join(__dirname, 'excel_direct_adapter_timezone_probe.js');
const ZONES = ['UTC', 'Asia/Tokyo', 'Asia/Shanghai', 'America/New_York', 'Asia/Kolkata'];

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

function runProbe(mode, tz) {
  const out = execFileSync(process.execPath, [PROBE, mode], {
    env: Object.assign({}, process.env, { TZ: tz }),
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function collectAcrossZones(mode) {
  const results = {};
  for (const zone of ZONES) results[zone] = runProbe(mode, zone);
  return results;
}

function allEqual(results, field) {
  const values = ZONES.map(z => results[z][field]);
  return values.every(v => v === values[0]);
}

(function main() {
  // --- mode 'basic': existing excel_direct_fixture_date.xlsx (date-only, visible display). ---
  // This is the exact fixture/scenario the original Codex-reported defect used
  // (2026-08-01T23:59:17.000Z under Asia/Shanghai instead of 2026-08-02T00:00:00.000Z).
  {
    const r = collectAcrossZones('basic');
    console.log('--- basic (date-only) per-zone rawIso ---');
    for (const z of ZONES) console.log(`  ${z}: ${r[z].rawIso}`);
    assert(allEqual(r, 'rawIso'), 'basic: rawIso identical across all 5 timezones');
    assert(r.UTC.rawIso === '2026-08-02T00:00:00.000Z', 'basic: rawIso matches expected value (2026-08-02T00:00:00.000Z), not the pre-fix defective one');
    assert(allEqual(r, 'display'), 'basic: display unchanged across timezones');
    assert(allEqual(r, 'text'), 'basic: Node.text unchanged across timezones');
    assert(allEqual(r, 'title'), 'basic: Node.title unchanged across timezones');
    assert(allEqual(r, 'sourceDocumentId'), 'basic: source_document_id unchanged across timezones');
    assert(allEqual(r, 'nodeId'), 'basic: node_id unchanged across timezones');
    assert(allEqual(r, 'knowledgeHash'), 'basic: knowledge_hash unchanged across timezones');
    assert(allEqual(r, 'p2a2ValueNormalizedText'), 'basic: P2-A2 VALUE unit normalized_text unchanged across timezones');
  }

  // --- mode 'datetime': new fixture with a non-midnight, sub-second (500ms) date+time value. ---
  {
    const r = collectAcrossZones('datetime');
    console.log('--- datetime (date+time, sub-second) per-zone rawIso ---');
    for (const z of ZONES) console.log(`  ${z}: ${r[z].rawIso}`);
    assert(allEqual(r, 'rawIso'), 'datetime: rawIso identical across all 5 timezones');
    assert(r.UTC.rawIso === '2026-08-02T12:34:56.500Z', 'datetime: rawIso preserves sub-second precision and matches expected value');
    assert(allEqual(r, 'display'), 'datetime: display unchanged across timezones');
    assert(allEqual(r, 'text'), 'datetime: Node.text unchanged across timezones');
    assert(allEqual(r, 'title'), 'datetime: Node.title unchanged across timezones');
    assert(allEqual(r, 'sourceDocumentId'), 'datetime: source_document_id unchanged across timezones');
    assert(allEqual(r, 'nodeId'), 'datetime: node_id unchanged across timezones');
    assert(allEqual(r, 'knowledgeHash'), 'datetime: knowledge_hash unchanged across timezones');
    assert(allEqual(r, 'p2a2ValueNormalizedText'), 'datetime: P2-A2 VALUE unit normalized_text unchanged across timezones');
  }

  // --- mode 'blank_display': date-formatted cell whose positive-value display is blank ---
  // (format ';yyyy/mm/dd;;'), while the raw Excel serial is still present and
  // XLSX.SSF.is_date() recognizes it as a date. This is the Checkpoint 1 Sec.5 / Checkpoint 2
  // item 7 "conditional P2-A2 risk": before this fix, cellTextValue()'s raw-value fallback
  // called String(cell.raw) on a Date object, and Date.prototype.toString() is inherently
  // host-timezone-dependent even for a correctly-fixed, UTC-based Date instant. The
  // excel_direct_adapter.js-level fix (cellTextValue() now uses cell.raw.toISOString() for
  // Date raw values - see "是正Checkpoint 2a.2" comment there) closes this for
  // provenance.verbatim.source_record, display, Node.text, Node.title, source_document_id,
  // node_id and knowledge_hash - all asserted invariant below.
  //
  // It does NOT close it for the separate P2-A2 rule-extraction projection
  // (private_dictionary_rule_extraction_core.js's safeNormalizeUnitText(), which calls
  // String(raw) directly on the same Date object via its own, independent code path). That
  // file's candidate-ID-affecting normalization logic is explicitly out of scope for this
  // remediation ("do not change candidate-ID rules themselves"). The assertion below measures
  // and documents the TRUE, current behavior (still variant) rather than asserting a false
  // invariance - this is a confirmed, reported, out-of-scope residual finding, not a silent gap.
  {
    const r = collectAcrossZones('blank_display');
    console.log('--- blank_display (blank positive display, date raw value) per-zone rawIso / p2a2 ---');
    for (const z of ZONES) console.log(`  ${z}: rawIso=${r[z].rawIso} text=${JSON.stringify(r[z].text)} p2a2=${JSON.stringify(r[z].p2a2ValueNormalizedText)}`);
    assert(allEqual(r, 'rawIso'), 'blank_display: rawIso (provenance.verbatim.source_record) unchanged across timezones');
    assert(r.UTC.rawIso === '2026-08-02T00:00:00.000Z', 'blank_display: rawIso matches expected value');
    assert(r.UTC.display === '', 'blank_display: display is blank as constructed by the fixture (positive format section empty)');
    assert(allEqual(r, 'display'), 'blank_display: display (blank) unchanged across timezones');
    assert(allEqual(r, 'text'), 'blank_display: Node.text unchanged across timezones (fixed: cellTextValue() Date fallback now uses toISOString())');
    assert(allEqual(r, 'title'), 'blank_display: Node.title unchanged across timezones');
    assert(allEqual(r, 'sourceDocumentId'), 'blank_display: source_document_id unchanged across timezones');
    assert(allEqual(r, 'nodeId'), 'blank_display: node_id unchanged across timezones');
    assert(allEqual(r, 'knowledgeHash'), 'blank_display: knowledge_hash unchanged across timezones');
    // Documented, out-of-scope residual: P2-A2's own normalized_text is NOT invariant here.
    const p2a2Variant = !allEqual(r, 'p2a2ValueNormalizedText');
    assert(p2a2Variant, 'blank_display: KNOWN RESIDUAL (documented, out of this remediation\'s scope) - P2-A2 normalized_text for this cell remains timezone-variant because private_dictionary_rule_extraction_core.js normalizes the same raw Date via its own String(raw) call, independent of excel_direct_adapter.js; fixing it would require changing that file\'s normalization logic, which this checkpoint explicitly prohibits ("do not change candidate-ID rules themselves")');
  }

  console.log(failures === 0 ? '\nALL TIMEZONE DETERMINISM CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
