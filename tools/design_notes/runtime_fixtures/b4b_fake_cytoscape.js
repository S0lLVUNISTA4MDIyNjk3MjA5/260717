/* B-4b Checkpoint 2 Playwright smoke専用の最小cytoscapeフェイク。
 * 実cytoscapeはCDN配信のため、外部ネットワークを完全遮断するテスト方針
 * (既存smoke testの慣例)の下では読み込めない。レイアウト・描画の見た目は一切気にせず、
 * 本ツールの既存グラフ描画コード(runGraphLayout等)とB-4bの装飾コード
 * (cy.edges()/data()/removeData()/style().selector().style().update()、read-only化のための
 * edge.emit('tap'))がエラーなく動作し、かつテスト側からedgeのdata属性を検査できる
 * 最小限のコレクション意味論(filter/nodes/edges連鎖でcollection-nessを保つ)のみ実装する。 */
window.cytoscape = function(opts) {
  const elements = (opts && opts.elements ? opts.elements : []).map(el => ({
    data: Object.assign({}, el && el.data ? el.data : {}),
  }));
  const isEdgeRecord = rec => !!(rec.data && (rec.data.type === 'dependency' || (rec.data.source && rec.data.target)));

  function wrapElement(rec) {
    const styleProps = {};
    const listeners = {};
    const self = {
      data(key, value) {
        if (key === undefined) return Object.assign({}, rec.data);
        if (value === undefined) return rec.data[key];
        rec.data[key] = value;
        return self;
      },
      removeData(key) { delete rec.data[key]; return self; },
      id() { return rec.data.id; },
      isParent() { return false; },
      isNode() { return !isEdgeRecord(rec); },
      isEdge() { return isEdgeRecord(rec); },
      style(prop, value) {
        if (prop === undefined) return Object.assign({}, styleProps);
        if (value === undefined) return prop in styleProps ? styleProps[prop] : 'element';
        styleProps[prop] = value;
        return self;
      },
      addClass() { return self; },
      removeClass() { return self; },
      toggleClass() { return self; },
      hasClass() { return false; },
      connectedEdges() { return makeCollection([]); },
      descendants() { return makeCollection([]); },
      on(event, handler) { (listeners[event] = listeners[event] || []).push(handler); return self; },
      emit(event) { (listeners[event] || []).forEach(h => h({ target: self })); return self; },
      _rec: rec,
    };
    return self;
  }

  function makeCollection(items) {
    const arr = items.slice();
    arr.data = (key, value) => { if (!arr.length) return undefined; return arr[0].data(key, value); };
    arr.style = () => arr;
    arr.addClass = () => arr;
    arr.removeClass = () => arr;
    arr.on = (event, handler) => { arr.forEach(el => el.on(event, handler)); return arr; };
    arr.nodes = () => makeCollection(Array.prototype.filter.call(arr, el => el.isNode()));
    arr.edges = () => makeCollection(Array.prototype.filter.call(arr, el => el.isEdge()));
    arr.filter = fn => makeCollection(Array.prototype.filter.call(arr, fn));
    arr.layout = () => ({ run() {} });
    return arr;
  }

  const allRecords = elements;
  const edgeRecords = allRecords.filter(isEdgeRecord);
  const nodeRecords = allRecords.filter(rec => !isEdgeRecord(rec));

  const cyApi = {
    destroy() {},
    container() { return opts && opts.container ? opts.container : null; },
    edges(selector) { void selector; return makeCollection(edgeRecords.map(wrapElement)); },
    nodes(selector) {
      if (typeof selector === 'string' && selector.includes(':parent')) return makeCollection([]);
      return makeCollection(nodeRecords.map(wrapElement));
    },
    elements() { return makeCollection(allRecords.map(wrapElement)); },
    batch(fn) { if (typeof fn === 'function') fn(); return cyApi; },
    style() {
      const styleApi = {
        selector() { return styleApi; },
        style() { return styleApi; },
        update() { return cyApi; },
      };
      return styleApi;
    },
    on() { return cyApi; },
    fit() { return cyApi; },
    center() { return cyApi; },
    resize() { return cyApi; },
    zoom() { return 1; },
    pan() { return { x: 0, y: 0 }; },
    minZoom() { return cyApi; },
    maxZoom() { return cyApi; },
    boxSelectionEnabled() { return cyApi; },
    autounselectify() { return cyApi; },
  };
  return cyApi;
};
