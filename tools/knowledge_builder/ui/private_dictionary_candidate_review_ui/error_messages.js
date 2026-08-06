'use strict';
/* P2-A3 candidate review UI - content-free error messages.
 *
 * Every user-visible failure goes through here. Messages never contain a file name, a file
 * path, a sheet name, candidate text, evidence text, a native Error message, or a stack. The
 * only variable part is a count.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3ErrorMessages = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const MESSAGES = {
    MISSING_BROWSER_GLOBAL: '内部構成エラーです。解析に必要なモジュールが読み込まれていません。配布物を再展開してください。',
    WEB_CRYPTO_UNAVAILABLE: 'この環境ではブラウザの暗号機能を利用できないため、解析を開始できません。',
    NO_INPUT_SELECTED: 'PDFまたはExcelを1件以上選択してください。',
    UNSUPPORTED_EXTENSION: '対応していない形式のファイルが含まれていたため、選択から除外しました。',
    FILE_TOO_LARGE: '1ファイルあたりの上限を超えるファイルが含まれています。読み込みは行っていません。',
    TOTAL_TOO_LARGE: '選択したファイルの合計サイズが上限を超えています。読み込みは行っていません。',
    TOO_MANY_FILES: '選択できるファイル数の上限を超えています。読み込みは行っていません。',
    PDF_READ_FAILED: 'PDFを解析できませんでした。テキストを含むPDFか確認してください。',
    PDF_ENCRYPTED: 'PDFが暗号化されているか、パスワードが必要です。',
    EXCEL_READ_FAILED: 'Excelを解析できませんでした。ファイル形式を確認してください。',
    EXCEL_NO_USABLE_SHEET: '表示可能かつ空でないシートがないExcelが含まれています。',
    DUPLICATE_SOURCE_DOCUMENT: '同一内容の入力ファイルが重複しています。重複を除いてから再実行してください。',
    PROJECTION_INVALID: '入力から生成した内部データが検証に失敗したため、解析を中止しました。',
    EXTRACTION_FAILED: '候補抽出に失敗したため、解析を中止しました。',
    EVIDENCE_REF_UNRESOLVED: '出典情報を解決できない候補があったため、解析を中止しました。',
    EVIDENCE_REF_AMBIGUOUS: '出典情報が一意に定まらないため、解析を中止しました。',
    SAMPLE_LOAD_FAILED: '標準サンプルを読み込めませんでした。配布物が不完全な可能性があります。',
    INTERNAL: '処理に失敗しました。',
  };

  /* Turns any thrown value into a content-free {code, message, count} record.
   * A P2-A2 {code, path} contract object keeps its code (codes are fixed identifiers, not
   * content). Anything else - including a native Error - collapses to INTERNAL, so no message
   * or stack can reach the screen. */
  function describe(thrown, fallbackCode) {
    let code = fallbackCode || 'INTERNAL';
    let count = null;
    if (thrown && typeof thrown === 'object') {
      if (typeof thrown.uiCode === 'string' && MESSAGES[thrown.uiCode]) {
        code = thrown.uiCode;
        if (Number.isInteger(thrown.count)) count = thrown.count;
      } else if (typeof thrown.code === 'string' && typeof thrown.path === 'string') {
        code = fallbackCode || 'INTERNAL';
      }
    }
    const base = MESSAGES[code] || MESSAGES.INTERNAL;
    return { code, message: count == null ? base : `${base}（該当 ${count} 件）`, count };
  }

  function fail(uiCode, count) {
    const e = { uiCode, count: Number.isInteger(count) ? count : null };
    return e;
  }

  function messageFor(code) { return MESSAGES[code] || MESSAGES.INTERNAL; }

  return { MESSAGES, describe, fail, messageFor };
});
