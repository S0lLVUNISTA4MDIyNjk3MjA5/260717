'use strict';
/* P2-A3 candidate review UI - pagination.
 *
 * Internal contract: pages are 1-origin. Page 1 is the first page, and an empty list still
 * reports totalPages 1 with currentPage 1 so the controls always have a valid state to render.
 *
 * paginate() is pure and clamps out-of-range input rather than throwing, which is what makes
 * "a decision reduced the filtered count below the current page" safe: the caller re-derives the
 * page from the same function and lands on the last valid page instead of an empty view.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3Pagination = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const PAGE_SIZES = Object.freeze([50, 100, 200]);
  const FIRST_PAGE = 1;

  function paginate(totalItems, pageSize, requestedPage) {
    const total = Math.max(0, Number(totalItems) || 0);
    const size = Math.max(1, Number(pageSize) || PAGE_SIZES[0]);
    const totalPages = Math.max(1, Math.ceil(total / size));
    let currentPage = Math.floor(Number(requestedPage) || FIRST_PAGE);
    if (!Number.isFinite(currentPage) || currentPage < FIRST_PAGE) currentPage = FIRST_PAGE;
    if (currentPage > totalPages) currentPage = totalPages;      // clamp, never an empty page
    const startOffset = (currentPage - FIRST_PAGE) * size;
    const endOffset = Math.min(startOffset + size, total);
    return {
      totalItems: total, pageSize: size, totalPages, currentPage, startOffset, endOffset,
      count: Math.max(0, endOffset - startOffset),
      hasPrev: currentPage > FIRST_PAGE,
      hasNext: currentPage < totalPages,
    };
  }

  function slice(items, info) {
    return items.slice(info.startOffset, info.endOffset);
  }

  /* Builds the first / prev / page x of y / next / last control row. onGo receives a 1-origin
   * page number and is expected to re-render. */
  function renderControls(container, info, onGo, labelPrefix) {
    if (!container) return;
    container.replaceChildren();

    const make = (text, targetPage, enabled, aria) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn sm ghost page-btn';
      button.textContent = text;
      button.disabled = !enabled;
      if (aria) button.setAttribute('aria-label', aria);
      button.dataset.page = String(targetPage);
      button.addEventListener('click', () => { if (enabled) onGo(targetPage); });
      return button;
    };

    container.append(make('«', FIRST_PAGE, info.hasPrev, '先頭ページ'));
    container.append(make('‹', info.currentPage - 1, info.hasPrev, '前ページ'));

    const status = document.createElement('span');
    status.className = 'page-status';
    const shownFrom = info.count === 0 ? 0 : info.startOffset + 1;
    status.textContent = `${info.currentPage} / ${info.totalPages} ページ`
      + `（${shownFrom}–${info.endOffset} 件 / 全 ${info.totalItems} 件）`;
    container.append(status);

    container.append(make('›', info.currentPage + 1, info.hasNext, '次ページ'));
    container.append(make('»', info.totalPages, info.hasNext, '最終ページ'));

    if (labelPrefix) {
      const note = document.createElement('span');
      note.className = 'page-note';
      note.textContent = labelPrefix;
      container.append(note);
    }
  }

  return { PAGE_SIZES, FIRST_PAGE, paginate, slice, renderControls };
});
