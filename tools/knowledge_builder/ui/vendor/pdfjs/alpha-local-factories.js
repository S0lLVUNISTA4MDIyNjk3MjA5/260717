/* α版: pdf.jsのCMap/標準フォントをfile://経由のXHRで取得すると、ブラウザのCORS制限
   （file://ページからfile://への XMLHttpRequest はブロックされる）により失敗するため、
   ビルド時にBase64埋め込みしたデータ（cmaps-data.js / fonts-data.js）から読み取る
   カスタムCMapReaderFactory/StandardFontDataFactoryを実装しています。
   pdf.js本体・cmaps/standard_fontsのデータ自体は無改変です（同じ168件のCMap・14件のフォント
   ファイルをBase64化しただけで、内容は変更していません）。 */
(function () {
  function base64ToUint8Array(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  class AlphaLocalCMapReaderFactory {
    constructor({ isCompressed = true } = {}) {
      this.isCompressed = isCompressed;
    }
    async fetch({ name }) {
      if (!name) throw new Error("CMap name must be specified.");
      const table = window.__ALPHA_PDFJS_CMAPS__ || {};
      const b64 = table[name];
      if (!b64) throw new Error("Unable to load binary CMap (embedded data not found): " + name);
      return {
        cMapData: base64ToUint8Array(b64),
        compressionType: 1 /* CMapCompressionType.BINARY */
      };
    }
  }

  class AlphaLocalStandardFontDataFactory {
    constructor() {}
    async fetch({ filename }) {
      if (!filename) throw new Error("Font filename must be specified.");
      const table = window.__ALPHA_PDFJS_FONTS__ || {};
      const b64 = table[filename];
      if (!b64) throw new Error("Unable to load font data (embedded data not found): " + filename);
      return base64ToUint8Array(b64);
    }
  }

  window.AlphaLocalCMapReaderFactory = AlphaLocalCMapReaderFactory;
  window.AlphaLocalStandardFontDataFactory = AlphaLocalStandardFontDataFactory;
})();
