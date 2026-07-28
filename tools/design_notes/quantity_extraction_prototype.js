// 工程4a（数量抽出）たたき台プロトタイプ v2.14
// tools/design_notes/quantity_extraction_prototype_review.md の必須修正6項目
// （符号付き数値／区間統合／境界包含区分／原文保持／暫定判定明示／条件誤伝播防止）
// および、そのレビュー過程で追加発見した2件（±公差、桁区切りカンマ）を反映。
// v2.1: 境界包含を考慮した被覆判定と、約・最大・最小等の修飾語保持を追加。
// v2.2: 最大・最小由来の隣接する片側境界も1件の区間へ統合。
// v2.3: 文分割が小数点を文区切りと誤認識し数値が破損する不具合を修正
//       （工程3プロトタイプでの実データ検証中に発見。例: 「12.5 kW」が「5 kW」になっていた）。
// v2.4: coverageGap()の比較方向を、実仕様が「点」か「範囲」かで切り替えるよう修正
//       （片側閾値要求(Xkg以上等) vs 単一の達成値を常に誤判定していた不具合。詳細は
//        semantic_mapping_prototype.md参照）。
// v2.5: 外部レビューにより、v2.4の「actualが点か範囲か」だけでは比較方向を一意に決定できない
//       ケース（実仕様側も片側区間＝保証下限/保証上限の場合）が指摘され、安全策として片側区間は
//       自動判定せず比較不能を返すよう修正。あわせて、空区間([50,50)等)を点と誤認する不具合、
//       抽出時の警告を比較結果へ伝播していなかった不具合も修正。恒久対応（工程3による
//       interval_semantics候補生成）は今後の検討課題。詳細はquantity_extraction_prototype_review.md
//       0.4節を参照。
// v2.6: 外部レビューにより、片側区間だけでなく両側区間も意味(対応可能領域か変動範囲か等)が
//       未確定という追加指摘を受け、coverageGap()に第3引数options.comparisonMode
//       （'actual_covers_requirement' | 'requirement_covers_actual'）を追加。両側区間は
//       modeが明示されない限り自動判定せず比較不能を返すよう変更（内部名を
//       'range_covers_range'から改名）。あわせて、単位不一致等の早期returnで
//       extractionWarningsが失われていた不具合も修正（警告収集を関数冒頭へ移動）。
//       詳細はquantity_extraction_prototype_review.md 0.5節を参照。
// v2.7: 外部レビューにより、coversLower()/coversUpper()が無限境界(下限/上限なし)を誤って
//       扱う不具合が指摘され修正。「要求12kW以上×実仕様0〜20kW」のように、要求が無限に
//       広がる(上限なし)のに実仕様が有限区間の場合、実仕様は要求を覆えないはずが、旧実装は
//       inner側の境界がnullなら無条件でtrueを返していたため誤ってsatisfied:trueになっていた。
//       修正により、outer側もnullである場合に限り「無限境界を覆う」と判定するようにした。
//       あわせて、coversLower/coversUpperが無限境界を正しく扱えるようになったことで片側区間と
//       両側区間を区別する必要がなくなったため、comparisonMode指定時は実仕様が片側区間でも
//       比較できるよう統合した（modeが指定されない場合は従来どおり比較不能を返す）。
//       詳細はquantity_extraction_prototype_review.md 0.6節を参照。
// v2.8: 外部レビューにより、actualが真の点であってもcomparisonModeが明示されればそれを
//       尊重すべきという指摘を受け修正。v2.7までは、actualが点であればcomparisonModeの指定を
//       無視して常にpoint_in_regionへ入っていたため、明示的にactual_covers_requirement等を
//       渡してもAPI利用者の意図どおりに動かなかった（例: 要求0~50℃×実仕様25℃は、25℃を
//       「達成値」と見るか「対応可能領域」と見るかで結果が逆転するはずが、常に前者として
//       扱われていた）。mode未指定かつ点の場合は従来どおりpoint_in_regionを既定動作として
//       維持しつつ、mode明示時はそれに従うよう修正した。詳細はquantity_extraction_prototype_review.md
//       0.7節を参照。
// v2.9: 「最高・最低」を「最大・最小」の同義語として認識するよう追加(工程3の
//       interval_semantics候補生成の対照テスト作成中に、「最低」が全く認識されず単なる
//       数値として抽出される不具合を発見)。あわせて、isGenuinePoint/isEmptyIntervalを
//       exportし、工程3プロトタイプがcoverageGap()と同じ「点」「空区間」の定義を再利用
//       できるようにした。
// v2.10: 公開実データ(国土交通省「公共建築工事標準仕様書」)での検証中に、見出し番号と値が
//        区切りなく結合したテキスト(「表2.1.9200V」)から無意味な数量「1.9200V」を誤って
//        抽出する不具合を発見。数値トークンの先頭に、直前が数字・ピリオドでないことを要求
//        する境界チェックを追加して対応(詳細は5.13節参照)。
// v2.11: 同じ実データ検証で、(1)全角英字(Ａ/Ｖ等)で書かれた単位が一切認識されない不具合を
//        発見し、全角ASCII全体を1文字ずつ半角化する正規化へ拡張、(2)JIS Z 8203に準拠する
//        圧力(MPa/kPa/Pa)・皮相電力(kVA)単位を追加。あわせて、単一アルファベット1文字の単位
//        (A=アンペア、L=リットル)も候補に挙がったが、実データへ適用したところ鋼種型番
//        (SUS304L等)と衝突し誤検出になることが判明したため追加を見送った(詳細は5.14節)。
// v2.12: レビューで「JIS Z 8000シリーズ(量及び単位)を単位ホワイトリストのマスターデータとして
//        活用すべき」との指摘を受け、単位辞書の各エントリへJIS Z 8000の対応する部(第3〜8部)を
//        `standard_ref`フィールドとして追加した(当初はコメントのみで済ませていたが、再レビューで
//        「コードから参照・検証・出力できないものはマスターデータと言えない」と指摘され、実際の
//        フィールド化に修正した)。あわせて、㎡・㎥等のCJK互換文字は実データに一度も出現しな
//        かったため追加を見送り、将来追加する場合の正規形の方針(JIS Z 8000に倣いm²・m³側へ
//        統一する)を記録した(詳細は5.15節)。
// v2.13: 再レビューの軽微な将来改善提案「本体統合時に不変マスターとして扱うならUNIT_DEFSを
//        凍結すべき」に対応し、配列・各エントリ・各standard_refの3階層をObject.freeze()した。
//        承認を妨げる指摘ではなかったが、変更コストが小さく安全性が上がるため反映した。
// v2.14: trace_comparison_schema_v1.md設計へのレビューで、数量IDの識別に使っていた
//        occurrence_index(同じnormalized_textが複数回出現する場合の出現順カウンタ)が、結局
//        extractQuantities()自身の出力順序への暗黙依存を解消できていない、との指摘を受けた
//        （抽出器を並べ替えたり、原文の先頭に同じ表記の数量を追加すると、既存レビューが別の
//        数量へ誤って結び付き得る）。抽出処理は内部で絶対文字位置(absStart/absEnd)を既に計算
//        していたが、戻り値には含めていなかった。これをsource_span: {start, end}として正式に
//        返すよう修正した(condition_candidatesの数量にも同様に付与)。原文中の同一表記が複数回
//        出現しても、それぞれ異なるsource_spanを持つため、内容ハッシュにsource_spanを含めれば
//        occurrence_indexという間接的な位置特定に頼らずに数量を一意識別できる。
// 依存ライブラリなし。 `node quantity_extraction_prototype.js` で単体実行できる。

// v2.11(実データ検証で発見): real_corpus_validation.js(8.18節)で、国土交通省「公共建築工事
// 標準仕様書」の実文107件のうち、対応5単位を含むのはわずか16件(約15%)だったことが判明した。
// 残りの大半で使われていた単位のうち、実際に文書内で複数回・一貫して正しく現れることを
// 確認できたもの(MPa=圧力、kVA=皮相電力)を、JIS Z 8203(国際単位系(SI)及びその使い方)に
// 準拠する単位として追加する。JIS Z 8203はSI単位系での圧力をPa(ゲージ圧)・kPa・MPaで表す
// ことを規定しており、MPaと同じ接尾辞を持つkPa・Paも一貫性のため合わせて追加した。
//
// 【安全側に倒して見送った単位】A(アンペア)とL(リットル)も同じ実データ調査で候補に挙がったが、
// 実際にこの文書へ適用したところ、Aは4件中2件(96.5A、18A)、Lは7件中7件(304L、316Lは全て
// SUS304L/SUS316Lというステンレス鋼種の型番であり、単位ではない)が誤検出だった。単一の
// アルファベット1文字だけの単位記号は、型番・合金成分比率・製品コード等の数字列と衝突しやすく、
// 実データで安全性を確認できなかったため追加を見送った(8.12節・8.17節と同じ「実データで
// 検証できない拡張は行わない」原則。詳細はsemantic_mapping_prototype.md 8.19節を参照)。
// v2.12(5.15節): 単位辞書を「量及び単位」を定めるJIS Z 8000規格群(全12部)への参照付き
// マスターデータへ整理した。各エントリに`standard_ref`(対応するJIS Z 8000の部とカテゴリ名)を
// 構造化データとして追加した(v2.12当初はコメントのみで済ませていたが、再レビューで
// 「コードから参照・検証・出力できないものはマスターデータとは言えない」と指摘され、実際に
// フィールド化した)。`dimension`は比較可能性(同じ次元かどうか)の判定に使う内部識別子で、
// 引き続きJIS用語を直接コピーしたものではなく英語識別子のままとしている。
//   temperature(温度)              → JIS Z 8000-5(熱力学)
//   length(長さ)                   → JIS Z 8000-3(空間及び時間)
//   power(仕事率)・pressure(圧力)   → JIS Z 8000-4(力学)
//   voltage(電圧)・apparent_power(皮相電力) → JIS Z 8000-6(電磁気)
//   frequency(周波数)              → JIS Z 8000-3(空間及び時間。周波数は時間の逆数として定義される)
//   sound_pressure_level(音圧レベル) → JIS Z 8000-8(音響学)
//
// 【全角互換文字(㎡/㎥/㎜/㎏等)について】JIS Z 8000は、m²・m³のような合成記号を標準の表記と
// している。Unicode CJK互換文字ブロックの㎡・㎥等(1文字で「平方メートル」等を表す文字)は、
// 由来がレガシー互換用途であり、JIS/SI準拠の文書では合成記号(m²等)を使うのが標準である。
// 8.18〜8.19節の実データ検証(国土交通省「公共建築工事標準仕様書」)では、この文書がそもそも
// ㎡・㎥等を一度も使わず、「ｍ３」のように全角の合成表記を用いていたため(v2.11の全角ASCII
// 正規化で対応済み)、CJK互換文字への対応は今回は追加していない(実データでの裏付けがない
// 拡張は行わないという8.11節以来の原則による)。もし将来、㎡・㎥等を含む実データが見つかった
// 場合は、canonical形式はJIS Z 8000に倣いm²・m³側に統一する(㎡→m²であって、その逆ではない)
// ことを、あらかじめここに設計方針として記録しておく。
const UNIT_DEFS = [
  { source: '°C', canonical: 'degC', dimension: 'temperature',
    standard_ref: { standard: 'JIS Z 8000-5', category: 'thermodynamics' } },
  { source: '℃', canonical: 'degC', dimension: 'temperature',
    standard_ref: { standard: 'JIS Z 8000-5', category: 'thermodynamics' } },
  { source: 'kW', canonical: 'kW', dimension: 'power',
    standard_ref: { standard: 'JIS Z 8000-4', category: 'mechanics' } },
  { source: 'V', canonical: 'V', dimension: 'voltage',
    standard_ref: { standard: 'JIS Z 8000-6', category: 'electromagnetism' } },
  { source: 'Hz', canonical: 'Hz', dimension: 'frequency',
    standard_ref: { standard: 'JIS Z 8000-3', category: 'space_and_time' } },
  { source: 'dB(A)', canonical: 'dB(A)', dimension: 'sound_pressure_level',
    standard_ref: { standard: 'JIS Z 8000-8', category: 'acoustics' } },
  { source: 'mm', canonical: 'mm', dimension: 'length',
    standard_ref: { standard: 'JIS Z 8000-3', category: 'space_and_time' } },
  { source: 'MPa', canonical: 'MPa', dimension: 'pressure',
    standard_ref: { standard: 'JIS Z 8000-4', category: 'mechanics' } },
  { source: 'kPa', canonical: 'kPa', dimension: 'pressure',
    standard_ref: { standard: 'JIS Z 8000-4', category: 'mechanics' } },
  { source: 'Pa', canonical: 'Pa', dimension: 'pressure',
    standard_ref: { standard: 'JIS Z 8000-4', category: 'mechanics' } },
  { source: 'kVA', canonical: 'kVA', dimension: 'apparent_power',
    standard_ref: { standard: 'JIS Z 8000-6', category: 'electromagnetism' } },
].map(u => Object.freeze({ ...u, standard_ref: Object.freeze(u.standard_ref) }));
Object.freeze(UNIT_DEFS);
const UNIT_ALT = '°C|℃|kW|kVA|V|Hz|dB\\(A\\)|mm|MPa|kPa|Pa';

function unitInfo(raw) {
  const def = UNIT_DEFS.find(u => u.source === raw);
  return def ? { source: raw, canonical: def.canonical, dimension: def.dimension, standard_ref: def.standard_ref }
             : { source: raw, canonical: raw, dimension: 'unknown', standard_ref: null };
}

// 文脈トークン(周辺語)。将来はドメイン別に拡張する前提の暫定リスト。
const CONTEXT_TOKENS = ['三相', '単相', 'AC', 'DC', '交流', '直流', '定格'];

// 全角→半角の1:1文字置換のみ行う(文字数・位置を変えない)。
// これにより、抽出したspanをそのまま元のtextへ適用してsource_textを取り出せる
// （正規化前の原文と、正規化後の文字列を両方保持できる＝レビュー2.4への対応）。
// v2.11(実データ検証で発見): 全角英字(Ａ/Ｖ等)は単位記号としても実際の政府調達仕様書に
// 現れる（例:「定格電流が15Ａ」）が、修正前は全角数字・全角ピリオドしか変換しておらず、
// 全角のまま書かれた単位は(数字と英字がともに全角でも)一切認識できなかった。全角ASCII
// (U+FF01-U+FF5E)はUnicodeの定義上、対応する半角ASCII(U+0021-U+007E)から一律+0xFEE0だけ
// シフトした位置にあるため、オフセット計算で1文字→1文字のまま包括的に半角化できる
// (数字・英字・括弧・カンマ等を、個別の文字表を保守せず一度にカバーする)。
function normalizeText1to1(text) {
  return text
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    // 全角ASCIIブロックに含まれない別のマイナス記号(U+2212)・波ダッシュ(U+301C)は個別に置換する。
    .replace(/[－−]/g, '-')
    .replace(/[～〜]/g, '~');
}

function parseNumber(numStr) {
  return Number(numStr.replace(/,/g, ''));
}

// 符号・桁区切りカンマ・小数に対応した数値トークン（レビュー2.1、および追加発見のカンマ区切りバグへの対応）
const NUM = '(-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?)';
// 実データ検証(国土交通省「公共建築工事標準仕様書」)で発見: 見出し番号と値がPDF由来のテキストで
// 区切りなく結合している場合(例:「表2.1.9200V・400V…」の"表2.1.9"に続けて"200V"が現れる)、
// NUMは数字列の途中(直前が数字・ピリオド)からでも一致してしまい、「1.9200V」のような無意味な
// 数量を誤って抽出していた。各正規表現の先頭(スキャン開始点となる最初のNUM)にのみ、直前が
// 数字・ピリオドでないことを要求する境界チェックを課す(2番目以降のNUMは~・±・/・「から」等の
// 記号区切りが直前にあるため、この問題は起きない)。
const NUM_AT_BOUNDARY = '(?<![\\d.])' + NUM;

function splitSentences(text) {
  // 句点等の直後で分割し、各文の絶対オフセットを保持する。
  // 条件節の付与(後述)をこの文単位に限定することで、文をまたいだ誤伝播を防ぐ（レビュー2.6への対応）。
  // v2.3: ASCIIピリオド"."は、数字に挟まれている場合(小数点)は文区切りとみなさない。
  // 修正前は「周囲温度50 °Cで12.5 kW」の小数点を文区切りと誤認識し、
  // 「12.5 kW」が「5 kW」に破損する不具合があった(工程3プロトタイプの実データ検証で発見)。
  const parts = [];
  let start = 0;
  const re = /(?<!\d)\.(?!\d)|[。!?！？]/g;
  let m;
  while ((m = re.exec(text))) {
    parts.push({ text: text.slice(start, m.index + 1), offset: start });
    start = m.index + 1;
  }
  if (start < text.length) parts.push({ text: text.slice(start), offset: start });
  return parts;
}

function contextTokensBefore(sentenceNorm, localIndex) {
  const windowStart = Math.max(0, localIndex - 12);
  const before = sentenceNorm.slice(windowStart, localIndex);
  return CONTEXT_TOKENS.filter(tok => before.includes(tok));
}

function boundFromOperatorWord(word) {
  // "以上"/"以下"等の直後語から、単一制約(lower-only or upper-only)を作る
  if (word === '以上') return { side: 'lower', inclusive: true };
  if (word === '以下') return { side: 'upper', inclusive: true };
  if (word === '未満') return { side: 'upper', inclusive: false };
  if (word === '超える' || word === '超え') return { side: 'lower', inclusive: false };
  return null;
}

function makeIntervalExact(value) {
  return { kind: 'interval', lower: { value, inclusive: true }, upper: { value, inclusive: true } };
}

function extractFromSentence(sentenceText, sentenceOffset, fullOriginal) {
  const norm = normalizeText1to1(sentenceText);
  const raws = []; // 中間表現: {startLocal, endLocal, quantity, unit, warnings, _boundSide}
  const consumed = new Array(norm.length).fill(false);
  const markConsumed = (s, e) => { for (let i = s; i < e; i++) consumed[i] = true; };
  const isFree = (s, e) => { for (let i = s; i < e; i++) if (consumed[i]) return false; return true; };

  // 1. 範囲: "X~Y unit"（unitはX側にあってもなくてもよい。canonicalで比較。レビュー3.1への対応）
  {
    const re = new RegExp(`${NUM_AT_BOUNDARY}\\s*(${UNIT_ALT})?\\s*~\\s*${NUM}\\s*(${UNIT_ALT})`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, lo, uLo, hi, uHi] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      const uHiInfo = unitInfo(uHi);
      const warnings = [];
      if (uLo && unitInfo(uLo).canonical !== uHiInfo.canonical) warnings.push('範囲前後で単位が食い違う');
      const loVal = parseNumber(lo), hiVal = parseNumber(hi);
      const reversed = loVal > hiVal;
      if (reversed) warnings.push('下限が上限を超えている(逆転範囲)'); // レビュー3.4: 自動修正せず警告のみ
      raws.push({
        startLocal: s, endLocal: e,
        quantity: { kind: 'interval', lower: { value: loVal, inclusive: true }, upper: { value: hiVal, inclusive: true } },
        unit: uHiInfo, warnings,
      });
      markConsumed(s, e);
    }
  }

  // 1b. "Xunitから Yunitまで"（両側とも単位あり、canonicalで比較。まで、は任意）
  {
    const re = new RegExp(`${NUM_AT_BOUNDARY}\\s*(${UNIT_ALT})\\s*から\\s*${NUM}\\s*(${UNIT_ALT})\\s*(まで)?`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, lo, uLo, hi, uHi] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      const uLoInfo = unitInfo(uLo), uHiInfo = unitInfo(uHi);
      const warnings = [];
      if (uLoInfo.canonical !== uHiInfo.canonical) warnings.push('範囲前後で単位が食い違う');
      const loVal = parseNumber(lo), hiVal = parseNumber(hi);
      if (loVal > hiVal) warnings.push('下限が上限を超えている(逆転範囲)');
      raws.push({
        startLocal: s, endLocal: e,
        quantity: { kind: 'interval', lower: { value: loVal, inclusive: true }, upper: { value: hiVal, inclusive: true } },
        unit: uHiInfo, warnings,
      });
      markConsumed(s, e);
    }
  }

  // 2. ±公差: "X±Y unit" → 区間[X-Y, X+Y]。レビュー後の追加発見バグ(値の取り違え)への対応。
  {
    const re = new RegExp(`${NUM_AT_BOUNDARY}\\s*±\\s*${NUM}\\s*(${UNIT_ALT})`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, nominal, tol, u] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      const nomVal = parseNumber(nominal), tolVal = parseNumber(tol);
      raws.push({
        startLocal: s, endLocal: e,
        quantity: { kind: 'interval', lower: { value: nomVal - tolVal, inclusive: true }, upper: { value: nomVal + tolVal, inclusive: true } },
        unit: unitInfo(u),
        warnings: [`公差表記(中心値${nomVal}, 公差±${tolVal})から区間を算出`],
      });
      markConsumed(s, e);
    }
  }

  // 3. 並列値: "X/Y unit"（意味は未確定のまま保持。レビュー3.2への対応）
  {
    const re = new RegExp(`${NUM_AT_BOUNDARY}\\s*/\\s*${NUM}\\s*(${UNIT_ALT})`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, a, b, u] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      raws.push({
        startLocal: s, endLocal: e,
        quantity: { kind: 'alternatives', options: [parseNumber(a), parseNumber(b)], selection_semantics: 'unknown' },
        unit: unitInfo(u),
        warnings: ['スラッシュの意味(択一/両対応/比率等)は文脈判定が必要'],
      });
      markConsumed(s, e);
    }
  }

  // 4. 単一値 + 比較演算子(以上/以下/未満/超える) + 約
  {
    const re = new RegExp(`${NUM_AT_BOUNDARY}\\s*(${UNIT_ALT})`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, numStr, u] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      const after = norm.slice(e, e + 8);
      const beforeStart = Math.max(0, s - 8);
      const before = norm.slice(beforeStart, s);
      let opWord = null;
      if (/^\s*以上/.test(after)) opWord = '以上';
      else if (/^\s*以下/.test(after)) opWord = '以下';
      else if (/^\s*未満/.test(after)) opWord = '未満';
      else if (/^\s*を?超え/.test(after)) opWord = '超える';

      // v2.1: 修飾語を数量表現の一部として保持する。
      // 「最大・最小」は片側境界の候補、「約・およそ・程度・公称」は曖昧性情報として保持する。
      // v2.9: 「最高・最低」を「最大・最小」の同義語として認識する(工程3のinterval_semantics
      // 候補生成の対照テスト作成中に、「最低」が全く認識されず単なる数値として抽出されて
      // しまう不具合を発見。実文書では最大/最小と同程度に一般的な表現のため追加した)。
      // source_textには実際に書かれた語(最高/最低)をそのまま保持し、種別(type)のみ
      // 最大/最小と同じ'maximum'/'minimum'へ正規化する。
      const prefixMatch = before.match(/(約|およそ|最大|最小|最高|最低|公称)\s*$/);
      const suffixMatch = after.match(/^\s*(程度)/);
      const prefix = prefixMatch ? prefixMatch[1] : null;
      const suffix = suffixMatch ? suffixMatch[1] : null;
      const prefixCanonical = prefix === '最高' ? '最大' : prefix === '最低' ? '最小' : prefix;
      const spanStart = prefixMatch ? s - prefixMatch[0].length : s;
      const spanEnd = suffixMatch ? e + suffixMatch[0].length : e;
      const qualifiers = [];
      if (prefix === '約' || prefix === 'およそ' || suffix === '程度') {
        qualifiers.push({ type: 'approximate', source_text: prefix || suffix });
      }
      if (prefixCanonical === '最大') qualifiers.push({ type: 'maximum', source_text: prefix });
      if (prefixCanonical === '最小') qualifiers.push({ type: 'minimum', source_text: prefix });
      if (prefix === '公称') qualifiers.push({ type: 'nominal', source_text: prefix });

      const value = parseNumber(numStr);
      const warnings = [];
      let quantity;
      let bound = opWord ? boundFromOperatorWord(opWord) : null;
      if (!bound && prefixCanonical === '最大') bound = { side: 'upper', inclusive: true };
      if (!bound && prefixCanonical === '最小') bound = { side: 'lower', inclusive: true };
      if (bound) {
        // レビュー2.3: 境界の包含/非包含を保持する
        quantity = bound.side === 'lower'
          ? { kind: 'interval', lower: { value, inclusive: bound.inclusive }, upper: null }
          : { kind: 'interval', lower: null, upper: { value, inclusive: bound.inclusive } };
      } else {
        quantity = makeIntervalExact(value); // レビュー4章: 単一値も区間モデルへ統一(lower=upper)
      }
      if (qualifiers.some(q => q.type === 'approximate')) warnings.push('概数表記のため、境界値は厳密値として扱わない');
      if (prefixCanonical === '最大' || prefixCanonical === '最小') warnings.push(`「${prefix}」を片側境界候補として抽出。文脈による確定が必要`);
      if (prefix === '公称') warnings.push('「公称」表記のため、実測値・保証値との混同に注意');
      raws.push({
        // v2.2: 最大/最小由来の境界も_boundSideへ反映し、以上/以下と同様に隣接統合の対象にする
        // （統合後も qualifiers/warnings は引き継がれ、confidenceは自動的に低いまま保たれる）。
        startLocal: spanStart, endLocal: spanEnd, quantity, unit: unitInfo(u), warnings,
        qualifiers, _boundSide: bound ? bound.side : null,
      });
      markConsumed(spanStart, spanEnd);
    }
  }

  raws.sort((a, b) => a.startLocal - b.startLocal);

  // 5. 片側制約の隣接ペアをひとつの区間へ統合(例: "0℃以上50℃以下" → 2件 → 1件。レビュー2.2への対応)
  const merged = [];
  for (let i = 0; i < raws.length; i++) {
    const cur = raws[i];
    const next = raws[i + 1];
    if (
      cur._boundSide === 'lower' && next && next._boundSide === 'upper' &&
      cur.unit.canonical === next.unit.canonical &&
      cur.quantity.lower && next.quantity.upper
    ) {
      merged.push({
        startLocal: cur.startLocal, endLocal: next.endLocal,
        quantity: { kind: 'interval', lower: cur.quantity.lower, upper: next.quantity.upper },
        unit: cur.unit,
        warnings: [...cur.warnings, ...next.warnings],
        qualifiers: [...(cur.qualifiers || []), ...(next.qualifiers || [])],
      });
      i++; // next を消費済みにする
      continue;
    }
    merged.push(cur);
  }

  // 6. 条件節付与(同一文内限定。レビュー2.6への対応)。
  // 直後に「において」「で」が続く数量を、後続数量の condition_candidates にする(確信度付き、自動確定しない)。
  for (let i = 0; i < merged.length; i++) {
    const q = merged[i];
    const tail = norm.slice(q.endLocal, q.endLocal + 6);
    const isMarker = /^\s*(において|で)/.test(tail);
    if (isMarker && merged[i + 1]) {
      merged[i + 1]._condition = q;
      q._isConditionOnly = true;
    }
  }

  // 7. 出力形へ整形。source_text/normalized_textは同一spanで元テキストから切り出す(1:1マッピングのため安全)。
  return merged
    .filter(q => !q._isConditionOnly)
    .map(q => {
      const absStart = sentenceOffset + q.startLocal;
      const absEnd = sentenceOffset + q.endLocal;
      const contextTokens = contextTokensBefore(norm, q.startLocal);
      const warnings = [...q.warnings];
      const out = {
        source_text: fullOriginal.slice(absStart, absEnd),
        // v2.14: 原文(fullOriginal)内の絶対文字位置。同じnormalized_textが複数回出現しても
        // 出現ごとに異なる値になるため、occurrence_indexのような間接的な位置特定に頼らずに
        // 数量を一意識別できる(trace_comparison_schema_v1.mdのquantity_id導出で使用する)。
        source_span: { start: absStart, end: absEnd },
        normalized_text: norm.slice(q.startLocal, q.endLocal),
        quantity: q.quantity,
        unit: q.unit,
        ...(q.qualifiers && q.qualifiers.length ? { qualifiers: q.qualifiers } : {}),
        // property/subject/state は工程3(意味対応付け)が埋める領域であり、本プロトタイプ(工程4a)では確定しない
        context: { property: null, subject: null, state: null, tokens: contextTokens },
        extraction: { confidence: warnings.length ? 0.6 : 0.95, warnings },
      };
      if (q._condition) {
        const cAbsStart = sentenceOffset + q._condition.startLocal;
        const cAbsEnd = sentenceOffset + q._condition.endLocal;
        out.condition_candidates = [{
          source_text: fullOriginal.slice(cAbsStart, cAbsEnd),
          source_span: { start: cAbsStart, end: cAbsEnd },
          quantity: q._condition.quantity,
          unit: q._condition.unit,
          confidence: 0.7,
        }];
      }
      return out;
    });
}

function extractQuantities(text) {
  const sentences = splitSentences(text);
  const all = [];
  for (const sent of sentences) {
    all.push(...extractFromSentence(sent.text, sent.offset, text));
  }
  return all;
}

// ── 工程5デモ: 区間の被覆判定(レビュー2.5: 暫定判定であることを明示する) ──
// 区間が空集合(矛盾)かどうかを判定する。下限>上限、または下限===上限で
// 両端のいずれかが非包含(exclusive)の場合は、値を1つも含まない空集合になる。
// (レビュー指摘: 50℃以上50℃未満([50,50))を値だけ見て「点50℃」と誤認する不具合)
function isEmptyInterval(q) {
  if (!q.lower || !q.upper) return false;
  if (q.lower.value > q.upper.value) return true;
  if (q.lower.value === q.upper.value) return !(q.lower.inclusive && q.upper.inclusive);
  return false;
}

// 真の点(単一の達成値)かどうかを判定する。空集合を誤って点扱いしないよう、
// 値の一致に加えて両端が包含(inclusive)であることも要求する。
function isGenuinePoint(q) {
  return !!(q.lower && q.upper && q.lower.value === q.upper.value && q.lower.inclusive && q.upper.inclusive);
}

// outer側の区間がinner側の区間を覆っているか(inner ⊆ outer)を判定する共通ロジック。
// actual_covers_requirement(outer=actual, inner=requirement)にも
// requirement_covers_actual(outer=requirement, inner=actual)にも同じ形で使う。
function coversLower(outer, inner) {
  // inner.lowerがnull(下限なし=負の無限大まで広がる)場合、outerがそれを覆うには
  // outer.lowerもnullでなければならない(外部レビュー指摘。v2.6は無条件でtrueを返しており、
  // 要求[12,+∞)を実仕様[0,20]が誤って充足していると判定していた)。
  if (!inner.lower) return !outer.lower;
  if (!outer.lower) return true;
  if (outer.lower.value < inner.lower.value) return true;
  if (outer.lower.value > inner.lower.value) return false;
  return outer.lower.inclusive || !inner.lower.inclusive;
}
function coversUpper(outer, inner) {
  // 上限側も同様。inner.upperがnull(上限なし=正の無限大まで広がる)場合、
  // outerがそれを覆うにはouter.upperもnullでなければならない。
  if (!inner.upper) return !outer.upper;
  if (!outer.upper) return true;
  if (outer.upper.value > inner.upper.value) return true;
  if (outer.upper.value < inner.upper.value) return false;
  return outer.upper.inclusive || !inner.upper.inclusive;
}

// 達成値(v)が要求(rq)の許容範囲内にあるかを判定する(point_in_regionモードの実体)。
function pointInRegionResult(rq, v, extractionWarnings) {
  const lowerCovered = !rq.lower || v > rq.lower.value || (v === rq.lower.value && rq.lower.inclusive);
  const upperCovered = !rq.upper || v < rq.upper.value || (v === rq.upper.value && rq.upper.inclusive);
  const boundaryMismatch = {
    lower: !!(rq.lower && v === rq.lower.value && !rq.lower.inclusive),
    upper: !!(rq.upper && v === rq.upper.value && !rq.upper.inclusive),
  };
  return {
    comparable: true,
    provisional: true, // 意味対応付け(工程3)による同一設計特性・同一条件の確認を経ていない暫定結果
    comparison_mode: 'point_in_region',
    assumptions: ['同じ設計特性として選択済み', '同じ運転条件', '単位換算不要'],
    satisfied: lowerCovered && upperCovered,
    lowGap: rq.lower ? v - rq.lower.value : null,
    highGap: rq.upper ? rq.upper.value - v : null,
    boundaryMismatch,
    extractionWarnings,
  };
}

function coverageGap(requirement, actual, options = {}) {
  // v2.6: 抽出時の警告(修飾語の文脈未確定等)を、早期returnも含めた全ての結果へ伝播する。
  // 単位不一致・非interval形式で早期returnする経路では警告収集前に戻っていたため
  // 警告が失われていた不具合への対応(レビュー指摘。詳細はレビュー記録0.5節参照)。
  const extractionWarnings = [
    ...(requirement.extraction?.warnings || []).map(w => ({ side: 'requirement', warning: w })),
    ...(actual.extraction?.warnings || []).map(w => ({ side: 'actual', warning: w })),
  ];

  if (requirement.unit.canonical !== actual.unit.canonical) {
    return { comparable: false, reason: '単位不一致', extractionWarnings };
  }
  const rq = requirement.quantity, ac = actual.quantity;
  if (rq.kind !== 'interval' || ac.kind !== 'interval') {
    return { comparable: false, reason: '区間形式でない値は本デモでは比較しない', extractionWarnings };
  }

  if (isEmptyInterval(rq) || isEmptyInterval(ac)) {
    return {
      comparable: false,
      reason: '区間が空集合(矛盾する境界)の可能性があります。境界包含区分を確認してください',
      extractionWarnings,
    };
  }

  const mode = options.comparisonMode;

  // v2.8: actualが真の点であっても、意味は一意ではない(外部レビュー指摘)。
  // 「要求0~50℃に対し実仕様25℃」は、25℃が「試験で確認した1点(達成値)」なら要求範囲内の
  // 点として適合するが、「対応可能な温度が25℃だけ(能力領域)」という意味なら、0~50℃の
  // 要求範囲を覆っていないため未充足になる――同じ数値でも解釈で結果が逆転する。
  // v2.7までは、actualが点であればcomparisonModeの指定を無視して常にpoint_in_regionへ
  // 入っていたため、明示的にactual_covers_requirement等を渡してもAPI利用者の意図どおりに
  // 動かなかった。v2.8では、modeが明示された場合はそれを優先する。
  //   - mode未指定 かつ actualが真の点: 暫定的にpoint_in_regionとして扱う(達成値との比較が
  //     最も典型的なケースであるため。完全な安全策として比較不能にする案もあったが、既存の
  //     デモ・回帰テストとの互換性を優先し、軽い方の対応を採用した)。
  //   - mode: 'point_in_region'が明示された場合: actualが真の点であることを要求する
  //     (点でなければ、このmodeは意味を持たないため比較不能を返す)。
  //   - mode: 'actual_covers_requirement' / 'requirement_covers_actual'が明示された場合:
  //     actualが点であっても、その点を退化区間[v,v]とみなし、下記のcoversLower/coversUpperに
  //     よる一般的な区間包含判定へそのまま合流させる(点は単に幅0の区間である)。
  if (!mode && isGenuinePoint(ac)) {
    return pointInRegionResult(rq, ac.lower.value, extractionWarnings);
  }
  if (mode === 'point_in_region') {
    if (!isGenuinePoint(ac)) {
      return {
        comparable: false,
        reason: 'comparisonMode: point_in_regionはactualが真の点の場合のみ有効です',
        extractionWarnings,
      };
    }
    return pointInRegionResult(rq, ac.lower.value, extractionWarnings);
  }

  // v2.7: actualが点でない場合(片側区間・両側区間のいずれも)、その区間が何を意味するかは
  // 構造だけからは一意に決まらない(外部レビュー指摘。v2.5は片側区間だけ、v2.6は両側区間にも
  // 拡張してこの扱いにしていたが、coversLower/coversUpperが無限境界(lower/upper===null)を
  // 正しく扱えるようになったv2.7では、片側・両側を区別する必要自体がなくなった)。
  // 少なくとも次の2通りの意味があり、比較方向が逆になる。
  //   - actual_covers_requirement: actualが対応可能領域(温度0~50℃等)や保証範囲を表す場合。
  //     実仕様の範囲が要求範囲を覆っているか(actual ⊇ requirement)を判定する。
  //   - requirement_covers_actual: actualが変動・公差範囲(220±10V等)や測定結果のばらつき、
  //     保証下限・保証上限(Xkg以上/Xkg以下)を表す場合。実仕様の範囲全体が要求の許容範囲に
  //     収まっているか(requirement ⊇ actual)を判定する。
  //     例: 要求200~240V×実仕様220±10V(実質210~230V)は、変動範囲としてなら充足のはずだが、
  //     v2.5までは常にactual_covers_requirement方向(actual ⊇ requirement)で判定していたため、
  //     actualが要求範囲全体を覆っていないという理由で誤って未充足と判定していた。
  // どちらの意味かは工程3(意味対応付け)が候補として持つべき情報であり、工程4a単体では
  // 判定できない。comparisonModeが明示されない限り、自動で方向を決めず比較不能を返す。
  if (mode !== 'actual_covers_requirement' && mode !== 'requirement_covers_actual') {
    return {
      comparable: false,
      reason: '区間の意味(対応可能領域か、変動・公差範囲か、保証下限/保証上限か等)が未確定のため、comparisonModeの指定なしに比較方向を確定できません',
      extractionWarnings,
    };
  }
  const outer = mode === 'actual_covers_requirement' ? ac : rq;
  const inner = mode === 'actual_covers_requirement' ? rq : ac;
  const lowerCovered = coversLower(outer, inner);
  const upperCovered = coversUpper(outer, inner);
  const boundaryMismatch = {
    lower: !!(inner.lower && outer.lower && inner.lower.value === outer.lower.value && inner.lower.inclusive && !outer.lower.inclusive),
    upper: !!(inner.upper && outer.upper && inner.upper.value === outer.upper.value && inner.upper.inclusive && !outer.upper.inclusive),
  };
  return {
    comparable: true,
    provisional: true,
    comparison_mode: mode,
    assumptions: ['同じ設計特性として選択済み', '同じ運転条件', '単位換算不要'],
    satisfied: lowerCovered && upperCovered,
    lowGap: (rq.lower && ac.lower) ? ac.lower.value - rq.lower.value : null,
    highGap: (rq.upper && ac.upper) ? rq.upper.value - ac.upper.value : null,
    boundaryMismatch,
    extractionWarnings,
  };
}

module.exports = { extractQuantities, coverageGap, unitInfo, normalizeText1to1, isGenuinePoint, isEmptyInterval, UNIT_DEFS };

// ── 単体実行時のデモ・テスト出力 ──
if (require.main === module) {
  console.log('########## 1. HVACサンプルでの抽出結果 ##########');
  const hvacSamples = [
    ['PDF 2.1', '空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。'],
    ['PDF 2.2', '周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。'],
    ['PDF 2.3', '定格電源は三相AC 220 V、50 Hzとすること。'],
    ['PDF 2.4', '定格運転時の装置正面1 mにおける騒音値は60 dB(A)以下とすること。'],
    ['Excel 使用温度範囲/標準', '0 °C～40 °C'],
    ['Excel 使用温度範囲/検討結果', '0 °C～50 °Cで使用可能'],
    ['Excel 冷房能力/標準', '周囲温度40 °Cで10 kW'],
    ['Excel 冷房能力/検討結果', '周囲温度50 °Cで12.5 kW'],
    ['Excel 電源電圧・周波数/標準', '三相AC 200 V、50/60 Hz'],
    ['Excel 電源電圧・周波数/検討結果', '三相AC 220 V、50 Hzに対応'],
    ['Excel 運転騒音/標準', '装置正面1 mで65 dB(A)'],
    ['Excel 運転騒音/検討結果', '定格運転時、装置正面1 mで58 dB(A)'],
    ['Excel 保守作業スペース/標準', '前面600 mm'],
    ['Excel 保守作業スペース/検討結果', '前面600 mmを確保'],
  ];
  for (const [label, text] of hvacSamples) {
    console.log(`\n--- ${label} ---`);
    console.log('原文:', text);
    console.log(JSON.stringify(extractQuantities(text), null, 1));
  }

  console.log('\n\n########## 2. 工程5デモ: 使用温度範囲の充足判定 ##########');
  const rangeOf = text => extractQuantities(text).find(q => q.quantity.kind === 'interval');
  const reqRange = rangeOf('空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。');
  const stdRange = rangeOf('0 °C～40 °C');
  const resultRange = rangeOf('0 °C～50 °Cで使用可能');
  // v2.6: 温度は要求・実仕様の両方とも「対応可能領域」を表すことが分かっているため、
  // comparisonMode: 'actual_covers_requirement' を明示する(この判断自体は本来、工程3の
  // interval_semantics候補生成が担うべきものであり、ここでは既知の前提として仮に固定している)。
  console.log('要求 vs 標準機種:', coverageGap(reqRange, stdRange, { comparisonMode: 'actual_covers_requirement' }));
  console.log('要求 vs 検討結果:', coverageGap(reqRange, resultRange, { comparisonMode: 'actual_covers_requirement' }));

  console.log('\n\n########## 3. レビュー提示テストケース(正常系・境界系・失敗系) ##########');
  const reviewCases = [
    '-10～50℃', '－10℃以上', '0℃以上50℃以下', '0℃以上50℃未満', '0°Cから50℃', '0℃から50°C',
    '50±2℃', '約50℃', '最大50℃', '50℃を超える', '50℃以下で運転し、220Vを使用する',
    '50℃で停止する。電源は220Vとする', 'AC 220V', 'DC 24V', '三相AC 200V', '1 m', '1m',
    '1,500 mm', '５０℃～６０℃', '50～0℃', '50/60 Hz',
  ];
  for (const c of reviewCases) {
    console.log(`\n--- "${c}" ---`);
    console.log(JSON.stringify(extractQuantities(c), null, 1));
  }

  console.log('\n\n########## 4. 完了条件チェック(自動アサーション) ##########');
  const assertions = [];
  const check = (name, cond) => assertions.push({ name, pass: !!cond });

  check('符号付き数値: -10~50℃ の下限が-10',
    extractQuantities('-10～50℃')[0]?.quantity.lower.value === -10);
  check('全角マイナス: -10℃以上 の下限が-10',
    extractQuantities('－10℃以上')[0]?.quantity.lower.value === -10);
  {
    const rs = extractQuantities('0℃以上50℃以下');
    check('区間統合: 0℃以上50℃以下 が1件のintervalになる',
      rs.length === 1 && rs[0].quantity.lower.value === 0 && rs[0].quantity.upper.value === 50);
  }
  {
    const r = extractQuantities('0℃以上50℃未満')[0];
    check('境界包含: 以上=inclusive true', r.quantity.lower.inclusive === true);
    check('境界非包含: 未満=inclusive false', r.quantity.upper.inclusive === false);
  }
  {
    const r = extractQuantities('５０℃～６０℃')[0];
    check('原文保持: source_textは全角のまま', r.source_text === '５０℃～６０℃');
    check('正規化文字列: normalized_textは半角', r.normalized_text === '50℃~60℃');
  }
  {
    const merged = extractQuantities('0°Cから50℃').find(q => q.quantity.lower && q.quantity.upper);
    check('単位混在でも範囲として認識される(0°Cから50℃)',
      !!merged && merged.quantity.lower.value === 0 && merged.quantity.upper.value === 50);
  }
  {
    const v220 = extractQuantities('50℃で停止する。電源は220Vとする').find(q => q.unit.canonical === 'V');
    check('条件誤伝播防止: 文をまたいだ220Vにconditionが付かない', v220 && !v220.condition_candidates);
  }
  {
    const kw = extractQuantities('周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。').find(q => q.unit.canonical === 'kW');
    check('条件伝播: 同一文内の条件は正しく付く',
      kw?.condition_candidates?.[0]?.quantity.lower.value === 50);
  }
  check('逆転範囲: warningsに逆転の指摘がある',
    extractQuantities('50～0℃')[0]?.extraction.warnings.some(w => w.includes('逆転')));
  {
    const r = extractQuantities('三相AC 200V')[0];
    check('周辺語保持: 三相・ACがcontext.tokensに入る',
      r.context.tokens.includes('三相') && r.context.tokens.includes('AC'));
  }
  check('過検出防止: "1 m"を抽出しない(既知の保留事項)', extractQuantities('1 m').length === 0);
  check('過検出防止: "1m"を抽出しない(既知の保留事項)', extractQuantities('1m').length === 0);
  check('カンマ区切り: 1,500 mmが1500として抽出される',
    extractQuantities('1,500 mm')[0]?.quantity.lower.value === 1500);
  {
    const r = extractQuantities('50±2℃')[0];
    check('公差表記: 50±2℃が[48,52]の区間になる',
      r?.quantity.lower.value === 48 && r?.quantity.upper.value === 52);
  }
  {
    // v2.3: 小数点が文区切りと誤認識され数値が破損する不具合の回帰テスト
    // （工程3プロトタイプでの実データ検証で発見。"周囲温度50 °Cで12.5 kW"の".5"以降が
    //   独立した「新しい文」として扱われ、"12.5 kW"が"5 kW"に破損していた）
    const r = extractQuantities('周囲温度50 °Cで12.5 kW').find(q => q.unit.canonical === 'kW');
    check('小数点の文区切り誤認識防止: 12.5 kWが破損せず抽出される',
      r?.source_text === '12.5 kW' && r?.quantity.lower.value === 12.5);
    check('小数点の文区切り誤認識防止: 条件(50°C)も正しく紐づく',
      r?.condition_candidates?.[0]?.quantity.lower.value === 50);
  }
  check('スラッシュ: selection_semanticsがunknown',
    extractQuantities('50/60 Hz')[0]?.quantity.selection_semantics === 'unknown');
  {
    const r = extractQuantities('約50℃')[0];
    check('修飾語保持: 約50℃のsource_textに「約」を含む',
      r?.source_text === '約50℃' && r?.qualifiers?.[0]?.type === 'approximate');
  }
  {
    const r = extractQuantities('最大50℃')[0];
    check('最大値候補: 最大50℃を上限50の片側区間として保持',
      r?.source_text === '最大50℃' && r?.quantity.lower === null &&
      r?.quantity.upper?.value === 50 && r?.qualifiers?.[0]?.type === 'maximum');
  }
  {
    const r = extractQuantities('最小10kW')[0];
    check('最小値候補: 最小10kWを下限10の片側区間として保持',
      r?.source_text === '最小10kW' && r?.quantity.lower?.value === 10 &&
      r?.quantity.upper === null && r?.qualifiers?.[0]?.type === 'minimum');
  }
  {
    // v2.9: 「最高・最低」を「最大・最小」の同義語として認識する回帰テスト。
    // 工程3のinterval_semantics対照テスト作成中に、「最低」が全く認識されず
    // 単なる点(15kW)として抽出されてしまう不具合を発見した。
    const rMax = extractQuantities('最高58dB(A)')[0];
    check('最高値候補: 最高58dB(A)を上限58の片側区間として保持(最大の同義語)',
      rMax?.source_text === '最高58dB(A)' && rMax?.quantity.lower === null &&
      rMax?.quantity.upper?.value === 58 && rMax?.qualifiers?.[0]?.type === 'maximum' &&
      rMax?.qualifiers?.[0]?.source_text === '最高');
    const rMin = extractQuantities('最低15kW')[0];
    check('最低値候補: 最低15kWを下限15の片側区間として保持(最小の同義語)',
      rMin?.source_text === '最低15kW' && rMin?.quantity.lower?.value === 15 &&
      rMin?.quantity.upper === null && rMin?.qualifiers?.[0]?.type === 'minimum' &&
      rMin?.qualifiers?.[0]?.source_text === '最低');
  }
  {
    // v2.2: 最大/最小由来の隣接した片側境界も、以上/以下と同様に1つの区間へ統合する
    const rs = extractQuantities('最小0℃最大50℃');
    check('最大/最小の統合: 隣接する最小・最大が1件のintervalになる',
      rs.length === 1 && rs[0].quantity.lower?.value === 0 && rs[0].quantity.upper?.value === 50);
    check('最大/最小の統合: 統合後も確信度は低いまま(qualifiers由来のwarningsが残る)',
      rs[0]?.extraction.confidence === 0.6 && rs[0]?.extraction.warnings.length === 2);
  }
  {
    const reqClosed = extractQuantities('0℃以上50℃以下')[0];
    const actualOpen = extractQuantities('0℃以上50℃未満')[0];
    const g = coverageGap(reqClosed, actualOpen, { comparisonMode: 'actual_covers_requirement' });
    check('境界被覆: 要求上限を含み実仕様が含まない場合は未充足',
      g.satisfied === false && g.boundaryMismatch.upper === true);
  }
  {
    const reqOpen = extractQuantities('0℃以上50℃未満')[0];
    const actualClosed = extractQuantities('0℃以上50℃以下')[0];
    check('境界被覆: 実仕様が要求より広い包含境界なら充足',
      coverageGap(reqOpen, actualClosed, { comparisonMode: 'actual_covers_requirement' }).satisfied === true);
  }
  {
    // v2.4: 片側閾値要求(Xkg以上) vs 単一の達成値の比較方向修正の回帰テスト。
    // 「12kW以上」の要求に対し、要求を大幅に超える999kWは充足のはずが、
    // 旧実装は範囲比較の方向を固定していたため誤って未充足と判定していた。
    const req = extractQuantities('冷房能力12 kW以上を確保すること')[0];
    const farExceeding = extractQuantities('冷房能力999 kW')[0];
    const shortfall = extractQuantities('冷房能力10 kW')[0];
    const g1 = coverageGap(req, farExceeding);
    const g2 = coverageGap(req, shortfall);
    check('閾値vs達成値: 999kWは「12kW以上」を充足する(点in区間モード)',
      g1.comparison_mode === 'point_in_region' && g1.satisfied === true);
    check('閾値vs達成値: 10kWは「12kW以上」を充足しない',
      g2.comparison_mode === 'point_in_region' && g2.satisfied === false);
  }
  {
    // v2.6: 範囲vs範囲(温度)は、comparisonMode: 'actual_covers_requirement'を明示すれば
    // 従来通り動くことを確認する回帰テスト。
    const g = coverageGap(reqRange, stdRange, { comparisonMode: 'actual_covers_requirement' });
    check('範囲vs範囲: comparisonMode指定でcomparison_modeがactual_covers_requirementになる',
      g.comparison_mode === 'actual_covers_requirement');
  }
  {
    const g = coverageGap(reqRange, stdRange, { comparisonMode: 'actual_covers_requirement' });
    check('比較結果: provisional=trueが明示される', g.provisional === true && Array.isArray(g.assumptions));
  }
  {
    // v2.5: レビュー指摘(actualの形だけでは片側の意味を一意に決められない)への対応の回帰テスト。
    // 「Xkg以上」「X以下」のような要求に対し、実仕様が片側区間(最大/最小由来)の場合、
    // v2.4は誤ってrange_covers_range方向で比較し「未充足」を返していた。
    // 恒久対応(工程3のinterval_semantics)が入るまでは、自動で比較方向を決めず比較不能を返す。
    const reqNoise = extractQuantities('騒音値は60 dB(A)以下とすること')[0];
    const actNoiseMax = extractQuantities('騒音は最大58 dB(A)')[0];
    const g1 = coverageGap(reqNoise, actNoiseMax);
    check('片側区間(安全策): 要求60dB以下×実仕様最大58dB(片側)は自動判定せず比較不能を返す',
      g1.comparable === false && typeof g1.reason === 'string');

    const reqCooling = extractQuantities('冷房能力12 kW以上を確保すること')[0];
    const actCoolingMin = extractQuantities('冷房能力は最小15 kW')[0];
    const g2 = coverageGap(reqCooling, actCoolingMin);
    check('片側区間(安全策): 要求12kW以上×実仕様最小15kW(片側)は自動判定せず比較不能を返す',
      g2.comparable === false && typeof g2.reason === 'string');
  }
  {
    // v2.6: 要求が実質1点(220V)でも、実仕様が両側区間で actual_covers_requirement を
    // 明示すれば正しく動くことの確認。
    const reqVoltage = extractQuantities('定格電圧は220 Vとすること')[0];
    const actVoltageRange = extractQuantities('電源電圧は200 Vから240 Vまで対応')[0];
    const g = coverageGap(reqVoltage, actVoltageRange, { comparisonMode: 'actual_covers_requirement' });
    check('両側区間vs実質1点の要求: 220V要求は200〜240Vの実仕様範囲に含まれるため充足する',
      g.comparison_mode === 'actual_covers_requirement' && g.satisfied === true);
  }
  {
    // v2.5: 境界包含区分の食い違い(要求は50を含む閉区間、実仕様は50を含まない半開区間)の確認。
    const reqClosed = extractQuantities('温度は0 ℃から50 ℃まで対応すること')[0];
    const actHalfOpen = extractQuantities('温度は0 ℃以上50 ℃未満で使用可能')[0];
    const g = coverageGap(reqClosed, actHalfOpen, { comparisonMode: 'actual_covers_requirement' });
    check('境界包含区分: 要求[0,50](閉)×実仕様[0,50)(半開)は上限側で未充足になる',
      g.satisfied === false && g.boundaryMismatch.upper === true);
  }
  {
    // v2.5: 空区間([50,50)、50以上50未満)を「点50」と誤認しないことの回帰テスト。
    const reqRange2 = extractQuantities('温度は40 ℃以上60 ℃以下とすること')[0];
    const actEmpty = extractQuantities('温度は50 ℃以上50 ℃未満で使用可能')[0];
    const g = coverageGap(reqRange2, actEmpty);
    check('空区間: 50℃以上50℃未満([50,50))は点として扱われず比較不能を返す',
      g.comparable === false);
  }
  {
    // v2.6: 外部レビュー指摘への対応の回帰テスト。actualが両側区間でも、その意味
    // (対応可能領域か変動範囲か)が未確定なままでは自動で比較方向を決めない。
    const reqVoltageRange = extractQuantities('電源電圧は200 Vから240 Vまで対応すること')[0];
    const actTolerance = extractQuantities('電源電圧は220±10 Vとする')[0];
    const gNoMode = coverageGap(reqVoltageRange, actTolerance);
    check('両側区間(安全策): 要求200〜240V×実仕様220±10V(公差)はmode未指定では比較不能を返す',
      gNoMode.comparable === false && typeof gNoMode.reason === 'string');

    // v2.4までは「actualが範囲なら常にactual ⊇ requirement」の1方向しかなく、
    // 公差表記(変動範囲)のように実仕様全体が要求の許容範囲に収まるかを問うケースを
    // 表現できなかった(要求範囲を覆っていないという理由で誤って未充足になっていた)。
    const gReqCoversAct = coverageGap(reqVoltageRange, actTolerance, { comparisonMode: 'requirement_covers_actual' });
    check('両側区間: requirement_covers_actualを明示すれば220±10V(210〜230V)は200〜240Vの許容範囲内で充足する',
      gReqCoversAct.comparable === true && gReqCoversAct.satisfied === true);
    check('警告伝播: 公差表記由来の警告がextractionWarningsへ伝播する(comparable=trueの場合)',
      gReqCoversAct.extractionWarnings.some(w => w.side === 'actual' && w.warning.includes('公差表記')));
  }
  {
    // v2.6: 要求が厳密な1点(220V)で、実仕様が変動範囲(220±10V)の場合、
    // actual_covers_requirement方向では「充足」に見えるが、requirement_covers_actual方向
    // (実仕様が変動する可能性を要求が許容するか)では「未充足」になり、解釈次第で結果が
    // 変わることを確認する(どちらが正しいかは工程3のinterval_semantics候補が決めるべき問題)。
    const reqVoltagePoint = extractQuantities('定格電圧は220 Vとすること')[0];
    const actTolerance = extractQuantities('電源電圧は220±10 Vとする')[0];
    const gActualCovers = coverageGap(reqVoltagePoint, actTolerance, { comparisonMode: 'actual_covers_requirement' });
    const gReqCovers = coverageGap(reqVoltagePoint, actTolerance, { comparisonMode: 'requirement_covers_actual' });
    check('解釈依存: 220V要求×220±10V実仕様は、actual_covers_requirementでは充足になる',
      gActualCovers.satisfied === true);
    check('解釈依存: 同じ組み合わせでも、requirement_covers_actualでは未充足になる',
      gReqCovers.satisfied === false);
  }
  {
    // v2.6: 単位不一致で早期returnする経路でも、extractionWarningsが失われないことの確認。
    const reqTemp = extractQuantities('温度は0 ℃以上50 ℃以下とすること')[0];
    const actNoiseMax = extractQuantities('騒音は最大58 dB(A)')[0]; // 単位がdegCと不一致、かつwarningsあり
    const g = coverageGap(reqTemp, actNoiseMax);
    check('警告伝播: 単位不一致でcomparable:falseでもextractionWarningsは保持される',
      g.comparable === false && g.reason === '単位不一致' &&
      g.extractionWarnings.some(w => w.side === 'actual' && w.warning.includes('最大')));
  }
  {
    // v2.7: 外部レビュー指摘の回帰テスト。無限境界(下限/上限なし)の包含判定が逆だった不具合。
    // 要求[12,+∞)(12kW以上)は「20kWを超える領域」も要求しているのに、実仕様[0,20]は
    // そこまで対応していない。旧実装はinner(要求)側の上限がnullなら無条件でtrueを返しており、
    // 実仕様が要求の無限に広がる部分を覆えていないことを見逃し、誤ってsatisfied:trueにしていた。
    const req1 = extractQuantities('冷房能力12 kW以上を確保すること')[0]; // [12, +∞)
    const act1 = extractQuantities('冷房能力は0 kWから20 kWまで')[0]; // [0, 20]
    const g1 = coverageGap(req1, act1, { comparisonMode: 'actual_covers_requirement' });
    check('無限境界: 要求[12,+∞)を実仕様[0,20]は覆えないため未充足',
      g1.satisfied === false);

    const req2 = extractQuantities('冷房能力は60 kW以下とすること')[0]; // (-∞, 60]
    const act2 = extractQuantities('冷房能力は0 kWから100 kWまで')[0]; // [0, 100]
    const g2 = coverageGap(req2, act2, { comparisonMode: 'actual_covers_requirement' });
    check('無限境界: 要求(-∞,60]を実仕様[0,100]は覆えないため未充足',
      g2.satisfied === false);

    const req3 = extractQuantities('冷房能力12 kW以上を確保すること')[0]; // [12, +∞)
    const act3 = extractQuantities('冷房能力は12 kW以上を実現')[0]; // [12, +∞)
    const g3 = coverageGap(req3, act3, { comparisonMode: 'actual_covers_requirement' });
    check('無限境界: 要求[12,+∞)を同じ[12,+∞)の実仕様なら充足(片側区間でもmode指定で比較できる)',
      g3.satisfied === true);

    const req4 = extractQuantities('冷房能力は60 kW以下とすること')[0]; // (-∞, 60]
    const act4 = extractQuantities('冷房能力は58 kW以下で運転')[0]; // (-∞, 58]
    const g4 = coverageGap(req4, act4, { comparisonMode: 'requirement_covers_actual' });
    check('無限境界: 要求(-∞,60]は実仕様(-∞,58]をrequirement_covers_actualで充足と判定する',
      g4.satisfied === true);
  }
  {
    // v2.8: 外部レビュー指摘の回帰テスト。actualが真の点でも、comparisonModeが明示された場合は
    // それを優先する(v2.7まではmode指定を無視して常にpoint_in_regionへ入っていた)。
    // 「要求0~50℃×実仕様25℃」は、25℃を「試験で確認した1点」と見るか「対応可能領域が
    // 25℃だけ」と見るかで結果が逆転する典型例。
    const req = extractQuantities('温度は0 ℃から50 ℃まで対応すること')[0]; // [0, 50]
    const act = extractQuantities('使用温度は25 ℃')[0]; // 点25

    const gPoint = coverageGap(req, act, { comparisonMode: 'point_in_region' });
    check('点+mode明示: point_in_regionを明示すれば25℃は0~50℃の範囲内で充足する',
      gPoint.satisfied === true && gPoint.comparison_mode === 'point_in_region');

    const gActualCovers = coverageGap(req, act, { comparisonMode: 'actual_covers_requirement' });
    check('点+mode明示: actual_covers_requirementを明示すれば、点25℃は0~50℃全体を覆えず未充足になる',
      gActualCovers.satisfied === false && gActualCovers.comparison_mode === 'actual_covers_requirement');

    const gReqCovers = coverageGap(req, act, { comparisonMode: 'requirement_covers_actual' });
    check('点+mode明示: requirement_covers_actualを明示すれば、点25℃は0~50℃に収まるため充足する',
      gReqCovers.satisfied === true && gReqCovers.comparison_mode === 'requirement_covers_actual');

    check('点+mode明示: comparison_modeが指定したmodeと一致する(黙ってpoint_in_regionへ落ちない)',
      gPoint.comparison_mode === 'point_in_region' &&
      gActualCovers.comparison_mode === 'actual_covers_requirement' &&
      gReqCovers.comparison_mode === 'requirement_covers_actual');
  }

  // ── 実データ検証(国土交通省「公共建築工事標準仕様書」)で発見した必須修正の回帰テスト ──
  // 見出し番号と値がPDF由来のテキストで区切りなく結合している場合(「表2.1.9200V・400V…」)、
  // 修正前はNUMが数字列の途中から一致し、「1.9200V」という無意味な数量を誤って抽出していた。
  {
    const rs = extractQuantities('表2.1.9200V・400V三相誘導電動機の始動方式');
    check('実データ回帰: 「表2.1.9200V・400V」から無意味な「1.9200V」を抽出しない',
      !rs.some(r => r.source_text === '1.9200V'));
    check('実データ回帰: 「表2.1.9200V・400V」から正しく「400V」は抽出できる',
      rs.some(r => r.source_text === '400V' && r.quantity.lower.value === 400));
    // 数字が直前にあっても、単位が直後になければ元々マッチしない(境界チェックのしすぎで
    // 正当な数量を潰していないことの確認)
    const normal = extractQuantities('周囲温度50 °Cで12.5 kW')[0];
    check('回帰防止: 通常の小数点付き数量(12.5 kW)は境界チェック追加後も正しく抽出される',
      !!normal);
  }

  // ── v2.11: 実データ検証で発見した全角単位の不具合、および新規単位追加の回帰テスト ──
  {
    check('全角英字単位(v2.11): 「２００Ｖ」が半角と同じく200Vの数量として抽出される',
      extractQuantities('２００Ｖ')[0]?.quantity.lower.value === 200);
    check('全角英字単位(v2.11): 全角の「３００ｍｍ以上」も修正後は300mmとして抽出される(mmは全角小文字でも認識)',
      extractQuantities('呼び径は３００ｍｍ以上とする')[0]?.quantity.lower.value === 300);
    const mpa = extractQuantities('40℃における貯蔵容器内圧力値4.4MPaとする')
      .find(r => r.unit.canonical === 'MPa');
    check('新規単位(v2.11): 「4.4MPa」がMPa(圧力)として抽出される', mpa && mpa.quantity.lower.value === 4.4);
    const kva = extractQuantities('その電動機の出力１kW当たり4.8kVA未満にするもの')
      .find(r => r.unit.canonical === 'kVA');
    check('新規単位(v2.11): 「4.8kVA」がkVA(皮相電力)として抽出される(kWと誤認しない)',
      kva && kva.quantity.upper.value === 4.8);
    // A/Lは実データ検証で誤検出(鋼種型番SUS304L等との衝突)が確認されたため、意図的に
    // 追加を見送っている。この意図的な非対応を回帰的に確認する(将来誤って追加され、
    // 再び型番との衝突が起きることを防ぐ検出ではなく、少なくとも現状の非対応を記録する)。
    check('単位辞書からの意図的な除外(v2.11): 「SUS304L」から数量304+Lを抽出しない(鋼種型番のため)',
      extractQuantities('JISG4305によるSUS304L又はSUS316Lとする').length === 0);
  }

  // ── v2.12(5.15節、再レビュー必須修正): 単位マスターデータ(standard_ref)がコメントではなく
  // 実際のフィールドとしてコード・実行時から参照・検証できることを確認する ──
  {
    check('単位マスターデータ(v2.12): UNIT_DEFSの全エントリがstandard_refを持つ',
      UNIT_DEFS.every(u => u.standard_ref && u.standard_ref.standard && u.standard_ref.category));
    check('単位マスターデータ(v2.12): unitInfo(\'MPa\')がJIS Z 8000-4(力学)を実行時に参照できる',
      unitInfo('MPa').standard_ref.standard === 'JIS Z 8000-4' && unitInfo('MPa').standard_ref.category === 'mechanics');
    check('単位マスターデータ(v2.12): 同じdimension(pressure)のMPa/kPa/Paは同じstandard_refを共有する',
      new Set(['MPa', 'kPa', 'Pa'].map(s => unitInfo(s).standard_ref.standard)).size === 1);
    check('単位マスターデータ(v2.12): 未知の単位のstandard_refはnullを返す(存在しない参照をでっち上げない)',
      unitInfo('N').standard_ref === null);
    // v2.13(軽微な将来改善への対応): 外部にエクスポートしたUNIT_DEFSは、本体統合時に
    // 不変マスターとして扱えるよう、配列・各エントリ・各standard_refの3階層を凍結してある。
    // 非strictモードでは変更操作が例外を投げず黙って無視されるため、「変更を試みた後も
    // 元の値のまま」であることを確認する形でテストする。
    const originalDimension = UNIT_DEFS[0].dimension;
    const originalLength = UNIT_DEFS.length;
    // Array.prototype.pushは非拡張オブジェクトに対して、strict/非strictを問わず必ず例外を
    // 投げる(単純な代入と異なり[[DefineOwnProperty]]の失敗が無条件で例外になるため)。
    let pushThrew = false;
    try { UNIT_DEFS.push({ source: 'X', canonical: 'X', dimension: 'tampered' }); }
    catch (e) { pushThrew = true; }
    UNIT_DEFS[0].dimension = 'tampered';
    UNIT_DEFS[0].standard_ref.standard = 'tampered';
    check('単位マスターデータの不変性(v2.13): UNIT_DEFSは配列・エントリ・standard_refの3階層とも凍結されており、変更を試みても元の値のまま',
      pushThrew &&
      UNIT_DEFS[0].dimension === originalDimension &&
      UNIT_DEFS[0].standard_ref.standard !== 'tampered' &&
      UNIT_DEFS.length === originalLength);
  }

  // ── v2.14(trace_comparison_schema_v1.mdへのレビュー): source_spanが原文中の絶対位置を
  // 正しく返し、同じ表記の数量が複数回出現しても出現ごとに異なるspanを持つことを確認する ──
  {
    const single = extractQuantities('周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。')[0];
    check('source_span(v2.14): 単一の数量で、原文をsource_spanのstart/endで切り出すとsource_textと一致する',
      single && single.source_text === '周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。'.slice(single.source_span.start, single.source_span.end));

    // レビュー指摘の再現例: 同一表記("50 ℃")が1文中に2回出現するケース。
    const dup = extractQuantities('入口温度は50 ℃、出口温度は50 ℃とする。');
    check('source_span(v2.14): 同一表記("50 ℃")が2回出現する文で、2件の数量が抽出される',
      dup.length === 2 && dup[0].normalized_text === dup[1].normalized_text);
    check('source_span(v2.14): 同一表記でもsource_spanは出現ごとに異なり、それぞれ元の位置を正しく指す(occurrence_indexという間接的な位置特定に頼らず一意識別できる)',
      dup.length === 2 &&
      (dup[0].source_span.start !== dup[1].source_span.start) &&
      dup.every(q => q.source_text === '入口温度は50 ℃、出口温度は50 ℃とする。'.slice(q.source_span.start, q.source_span.end)));

    // 条件節側(condition_candidates)にもsource_spanが付与されることを確認する。
    const withCond = extractQuantities('周囲温度50 °Cで実測12.5 kW')[0];
    check('source_span(v2.14): condition_candidatesの数量にもsource_spanが付与され、原文の位置を正しく指す',
      withCond && withCond.condition_candidates && withCond.condition_candidates[0].source_span &&
      withCond.condition_candidates[0].source_text === '周囲温度50 °Cで実測12.5 kW'.slice(
        withCond.condition_candidates[0].source_span.start, withCond.condition_candidates[0].source_span.end));
  }

  assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
  const failCount = assertions.filter(a => !a.pass).length;
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);
  // v2.14(レビュー指摘): 失敗時にも終了コードが0のままだとCIで失敗を見逃す。非ゼロで終了する。
  process.exitCode = failCount > 0 ? 1 : 0;
}
