#!/usr/bin/env node
/* Private Dictionary Rule Extraction Contract 0.1 (P2-A2 Evaluation Slice E1) - local human
 * evaluation CLI.
 *
 * Reads one or more explicitly-named local PDF/Excel files, runs them through the existing
 * PDF/Excel direct adapters (unmodified) and the new rule-extraction core, and writes a
 * LOCAL, PRIVATE candidate evaluation artifact plus a content-free shareable summary into an
 * explicitly-named output directory.
 *
 * This file owns all filesystem access for this feature slice. The core
 * (private_dictionary_rule_extraction_core.js) never touches the filesystem, network, or any
 * external AI service.
 *
 * Usage:
 *   node private_dictionary_candidate_evaluation_cli.js --pdf /local/path/spec.pdf --out /local/path/out
 *   node private_dictionary_candidate_evaluation_cli.js --excel /local/path/review.xlsx --out /local/path/out
 *   node private_dictionary_candidate_evaluation_cli.js --pdf a.pdf --excel b.xlsx --out /local/path/out
 *
 * No directory auto-scan, no network, no telemetry, no external AI. Existing output files are
 * never overwritten without the directory being empty of them first.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PdfAdapter = require(path.join(__dirname, '..', 'core', 'pdf_direct_adapter.js'));
const ExcelAdapter = require(path.join(__dirname, '..', 'core', 'excel_direct_adapter.js'));
const Core = require(path.join(__dirname, '..', 'core', 'private_dictionary_rule_extraction_core.js'));

const OUTPUT_FILE_NAMES = ['candidate_evaluation.json', 'candidate_review.md', 'shareable_summary.json'];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = { pdf: [], excel: [], out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pdf') { result.pdf.push(argv[++i]); }
    else if (a === '--excel') { result.excel.push(argv[++i]); }
    else if (a === '--out') { result.out = argv[++i]; }
    else { fail(`unrecognized argument. Usage: --pdf <path> | --excel <path> (repeatable) --out <dir>`); }
  }
  return result;
}

function readAsArrayBuffer(filePath) {
  const buf = fs.readFileSync(filePath); // caller-checked existence; native fs errors are caught by main()
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function sha256Hex(arrayBuffer) {
  return crypto.createHash('sha256').update(Buffer.from(arrayBuffer)).digest('hex');
}

async function buildPdfProjection(filePath) {
  const arrayBuffer = readAsArrayBuffer(filePath);
  const contentDigest = sha256Hex(arrayBuffer);
  const fileName = path.basename(filePath);
  const adapterResult = await PdfAdapter.adaptPdfDirect(arrayBuffer, {
    fileName, contentDigest, ingestedAt: new Date().toISOString(), tagVocabulary: null, documentNumber: null, revisionLabel: null
  });
  return Core.buildExtractionInputProjectionFromPdfAdapterResult(adapterResult);
}

async function buildExcelProjection(filePath) {
  const arrayBuffer = readAsArrayBuffer(filePath);
  const contentDigest = sha256Hex(arrayBuffer);
  const fileName = path.basename(filePath);
  const { workbook, sheetNames } = ExcelAdapter.inspectWorkbook(arrayBuffer);
  const usable = sheetNames.filter(s => !s.hidden && !s.empty);
  if (usable.length === 0) fail('the workbook has no visible, non-empty sheets to extract');
  const extractions = [];
  for (const s of usable) {
    const detected = ExcelAdapter.detectHeaderAndDataStart(workbook, s.name);
    extractions.push(ExcelAdapter.extractSheetRows(workbook, s.name, detected.headerRow, detected.dataStartRow));
  }
  const adapterResult = await ExcelAdapter.buildKnowledgeNodesFromExcelSheets(extractions, {
    fileName, contentDigest, ingestedAt: new Date().toISOString(), tagVocabulary: null, documentNumber: null, revisionLabel: null
  });
  return Core.buildExtractionInputProjectionFromExcelAdapterResult(adapterResult);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.pdf.length === 0 && args.excel.length === 0) fail('at least one --pdf or --excel input is required');
  if (!args.out) fail('--out <directory> is required (no default output location)');

  for (const p of [...args.pdf, ...args.excel]) {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) fail('one of the specified input files does not exist or is not a regular file');
  }

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const targetPaths = OUTPUT_FILE_NAMES.map(name => path.join(outDir, name));
  for (const tp of targetPaths) {
    if (fs.existsSync(tp)) fail('the output directory already contains a previous evaluation artifact; choose an empty --out directory or remove the existing files first');
  }

  // ---- All computation happens in memory before any file is written, so a mid-run failure
  // ---- never leaves partial output on disk. ----
  const projections = [];
  try {
    for (const p of args.pdf) projections.push(await buildPdfProjection(p));
    for (const p of args.excel) projections.push(await buildExcelProjection(p));

    for (const projection of projections) {
      const v = Core.validateExtractionInputProjection(projection);
      if (!v.valid) fail('an internally constructed projection failed validation (internal error)');
    }

    const evaluation = await Core.extractLocalDictionaryCandidates(projections);
    const localJson = Core.serializeCandidateEvaluationCanonical(evaluation);
    const reviewMd = Core.buildCandidateReviewMarkdown(evaluation);
    const shareableJson = JSON.stringify(Core.buildShareableExtractionSummary(evaluation), null, 2);

    fs.writeFileSync(targetPaths[0], localJson, { encoding: 'utf8', flag: 'wx' });
    fs.writeFileSync(targetPaths[1], reviewMd, { encoding: 'utf8', flag: 'wx' });
    fs.writeFileSync(targetPaths[2], shareableJson, { encoding: 'utf8', flag: 'wx' });

    console.log('LOCAL PRIVATE CONTENT - DO NOT SHARE WITH AI, GITHUB, OR EXTERNAL SERVICES');
    console.log(`Wrote: ${targetPaths.join(', ')}`);
    console.log(`candidates=${evaluation.summary.candidate_count} aliases=${evaluation.summary.alias_candidate_count} conflicts=${evaluation.summary.conflict_count} rejected=${evaluation.summary.rejected_count}`);
  } catch (e) {
    // Never surface a native Error, its message/stack, or any raw path/term. Only our own
    // sanitized {code,path} contract (if applicable) is safe to name.
    for (const tp of targetPaths) { try { fs.unlinkSync(tp); } catch (_) { /* not written yet, ignore */ } }
    if (e && typeof e === 'object' && typeof e.code === 'string' && typeof e.path === 'string' && Object.keys(e).length === 2) {
      fail(`extraction failed (${e.code})`);
    } else {
      fail('processing failed');
    }
  }
}

main();
