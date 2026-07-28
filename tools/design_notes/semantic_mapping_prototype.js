// 工程3（意味対応付けの候補生成）たたき台プロトタイプ
// 工程4a(quantity_extraction_prototype.js)の抽出結果に対し、
// 「どの設計特性(concept_id)を表すか」「その文書内でどんな役割(role)を持つか」の
// 候補を生成する。候補は必ず確信度付きであり、確定はしない。
//
// 設計原則(quantity_extraction_prototype_review.md 7章と同じ):
//   数量抽出(工程4a)は、その値が何の設計特性を表すかを確定する工程ではない。
//   意味対応付け(工程3)も、候補提示までであり、最終確定は人間が行う。
//
// 依存ライブラリなし。 `node semantic_mapping_prototype.js` で単体実行できる。
//
// 【対応状況】本プロトタイプで工程4aのcoverageGap()を概念グループ単位に自動適用したところ、
// coverageGap()自体に比較方向の設計上の欠陥が見つかった（片側閾値要求 vs 単一の達成値が
// 誤判定されていた）。工程4a v2.4で、実仕様側の値が「点」か「範囲」かにより比較方向を切り替える
// 修正を行ったが、外部レビューにより「両側区間もその意味(対応可能領域か変動範囲か)が未確定」
// という追加指摘を受け、v2.5〜v2.6でcoverageGap()に第3引数optionsを追加し、明示的なmode指定が
// ない両側区間は自動判定せず比較不能を返すよう変更した。この結果、本プロトタイプの4章の自動
// 橋渡しループは、温度(両側区間どうしの比較)をmodeなしでは比較できなくなっている
// （5章のアサーションでは、既知の前提としてmodeを明示的に渡して数値ロジックを検証している）。
// これは「区間の意味候補(interval_semantics)を工程3が生成しない限り、工程5の自動橋渡しは
// 安全に動かせない」という、レビューの最終的な結論を実データで裏付けている。
// 詳細は quantity_extraction_prototype.md 5.8〜5.9節、quantity_extraction_prototype_review.md
// 0.4〜0.5節を参照。
//
// v2.9でinterval_semantics候補生成に着手した後、外部レビューで2件の必須修正を受けv2.10で対応した。
//   (1) required_capability_domain(要求は対応可能領域全体を求める) × achieved_point(実仕様は
//       単一の達成値)をpoint_in_regionへ対応させていた誤り。1点が範囲内にあることは、その範囲
//       全域への対応を証明しない。この組み合わせは導出規則なしに変更した。
//   (2) 「B側(実仕様側)の点である」ことだけでachieved_pointがほぼ自動確定(確信度0.6)していた
//       問題。設定値・公称値・試験条件・参考値との区別がつかないため、役割根拠の重みを削減し、
//       「設定」「公称」「試験」を否定根拠の語彙へ追加した。
// v2.10の対応は否定語辞書に列挙した語だけを止める対症療法だったため、再レビューで「未知の
// 曖昧語(代表値/中央値/計画値等)には依然として自動適用される」と再指摘され、v2.11で
// source_role重みを0.05まで下げた(無修飾の点は形+役割だけでは閾値に届かない設計へ)。
// v2.12(8.10節)では、レビュー推奨に沿い「列の役割＋セル内の肯定語＋数量形状」を独立根拠として
// 積み上げる設計へ拡張した。列の役割(出典列が'検討結果'かどうか)は弱い根拠(0.05)に留め、
// セル内に達成値であることを積極的に示す語(実測/達成値/検討の結果等)がある場合のみ、閾値を
// 超えられる強い根拠(0.4)を与える。構造的根拠(形・列名)だけでは決して閾値を超えない設計は
// 維持している。v2.13(8.12節)では、実際の客先文書サンプルは用意できなかったため、代わりに
// JIS計測用語(JIS Z 8103)・検査成績書の実務慣行をインターネット調査し、肯定語(検査結果/
// 試験結果/実績値/成績値)と否定語(規格値/基準値/目標値/設計値)を語彙として追加した。
// 代表値・中央値・平均値はJIS統計用語上「複数の測定を要約した値」であり単一の達成値と
// 同一視できないため、意図的にどちらの辞書にも加えていない。v2.14では、キーワード一致を
// セル内の対象数量の節へ限定するlocalClauseText()を追加したが、これに2件の不具合が
// 見つかりv2.15で対応した。(1) 位置特定にnearbyText.indexOf()を使っていたため、同一表記の
// 数量がセル内に複数回現れると常に最初の出現に解決されていた不具合。工程4a側のスキーマ
// (source_span)追加までは行わず、出現番号(occurrenceIndex)を渡す暫定策で対応した。
// (2) 節分割を要求側(A側)にも適用していたため、「電源電圧220V、50Hzとすること」のような
// 複数数量が文末の共通述語を共有する要求文で、後半の述語が節分割により失われていた不具合。
// 節分割を実仕様側(B側、条件節を除く)のみに限定して解決した。詳細は8.8〜8.13節を参照。
//
// v2.15承認後、レビュー推奨の「実文書コーパスでの誤昇格率実測」の代替として、実データを使わず
// 大量の組み合わせで設計原則を機械的に検証する摂動テスト(interval_semantics_fuzz_test.js)を
// 追加した(8.16節)。この延長で、肯定語辞書の語(実測/達成値/使用可能等)が、直後に否定表現
// (「ではない」等)を伴う場合でも構文を無視して一致してしまう問題を、専用の摂動テスト
// (vocabulary_negation_fuzz_test.js)で発見した。「実測ではない25℃」が確信度0.70で
// achieved_pointとして自動適用の閾値を超えてしまうことを実際に確認し、v2.16で肯定語の
// 直後に否定表現が続く場合は一致を無視する簡易的な否定スコープ検出(hasUnnegatedKeywordMatch())
// を追加して対応した。詳細は8.17節を参照。
//
// v2.16の実データ検証(8.18〜8.19節)で、公開の政府調達仕様書コーパスに対しREQUIREMENT_SEMANTICS_
// RULESのkeywordルールが一件も機能しないことが判明した。「〜とすること」のみに対応しており、
// この文書で多用される「〜とする。」（「こと」を伴わない平叙文形）に一致しなかったためである。
// v2.17では、JIS Z 8301:2019(規格票の様式及び作成方法)附属書が要求事項の標準的な表現として
// 「…とする。」「…(し)なければならない。」を規定していることを確認し、この2つを追加した。
// 同じ表に含まれる「…による。」は、実データ調査で「特記による」等の参照表現がほぼ全てであり
// 数量そのものを規定しないため、意図的に追加を見送った。詳細は8.20節を参照。

const { extractQuantities, coverageGap, isGenuinePoint, isEmptyInterval } = require('./quantity_extraction_prototype.js');

// ── interval_semantics 候補生成(v2.9で着手、v2.10〜v2.12で必須修正・拡張を反映) ──
// 区間の「形」(点/片側/両側)だけでは、その区間が何を意味するかを一意に決定できない
// (quantity_extraction_prototype_review.md 0.4〜0.7節のレビュー指摘、および今回のレビューで
// 明示的に依頼された設計条件)。役割(要求/実仕様)・周辺語・数量の形・修飾語・否定語を
// 独立した根拠として積み上げ、複数候補を生成する(最上位候補だけを残さない)。
function isTwoSidedRange(q) {
  return q.kind === 'interval' && !!q.lower && !!q.upper && !isGenuinePoint(q) && !isEmptyInterval(q);
}
function isOneSidedLower(q) { return q.kind === 'interval' && !!q.lower && !q.upper; }
function isOneSidedUpper(q) { return q.kind === 'interval' && !q.lower && !!q.upper; }

// 要求側(PDF=A側、role='requirement')の意味候補。
const REQUIREMENT_SEMANTICS_RULES = [
  { value: 'required_capability_domain', weight: 0.5, evidenceType: 'keyword',
    match: (text) => /運転できること|使用できること|動作できること|対応できること/.test(text) },
  { value: 'required_capability_domain', weight: 0.15, evidenceType: 'quantity_shape',
    match: (text, quantity) => isTwoSidedRange(quantity) },
  { value: 'acceptable_region', weight: 0.45, evidenceType: 'keyword',
    match: (text) => /確保する(?:こと)?|以下とする(?:こと)?|以上とする(?:こと)?/.test(text) },
  // v2.17(8.20節): JIS Z 8301:2019(規格票の様式及び作成方法)附属書は、規格文書における
  // 要求事項の標準的な表現として「…とする。」「…(し)なければならない。」を規定している
  // （「…する。」「…による。」も同じ表に含まれるが、下記の理由で採用していない）。
  // v2.16までは「〜とすること」（「こと」を伴う名詞化表現）のみに一致していたが、実データ
  // 検証(8.18〜8.19節)で、政府調達仕様書ではこの「こと」を伴わない平叙文形「〜とする。」が
  // 圧倒的多数(調査対象文書で355件、「とすること」はわずか2件)を占めることが判明したため、
  // 「こと」を任意にし、あわせて「なければならない」も追加した。「〜する。」は動詞の終止形
  // 一般と区別できず語彙として機能しないため採用せず、「〜による。」はJIS上は同じ要求事項の
  // 表現に分類されるが、実データ調査で「特記による」「次による」のように他文書・他条項への
  // 参照を表す用法がほぼ全て(20件サンプル中20件)であり、数量そのものを規定する表現ではない
  // ため、意図的に追加を見送った。
  { value: 'acceptable_region', weight: 0.3, evidenceType: 'keyword',
    match: (text) => /とする(?:こと)?|なければならない/.test(text) &&
      !/確保する(?:こと)?|以下とする(?:こと)?|以上とする(?:こと)?|運転できること|使用できること|動作できること|対応できること/.test(text) },
  { value: 'acceptable_region', weight: 0.15, evidenceType: 'quantity_shape',
    match: (text, quantity) => isOneSidedLower(quantity) || isOneSidedUpper(quantity) || isGenuinePoint(quantity) },
];

// v2.16: 肯定語(実測/達成値/使用可能等)の正規表現は、直後に否定表現が続く場合でも文字列として
// 一致してしまう(「実測ではない25℃」の"実測"等)。摂動テストで、この場合でもachieved_pointが
// 確信度0.70(構造0.3+肯定語0.4)に達し、auto_applicable閾値(0.4)を超えることを発見した
// (vocabulary_negation_fuzz_test.js参照)。文全体の構文解析は行わず、肯定語の直後
// (助詞等を挟まない直近)に否定表現が続く場合のみ、その一致を無視する簡易策で対応する。
const NEGATION_SUFFIX_PATTERN = /^(?:ではな(?:い|く)|ではありません|ではございません|とは言えない)/;
function hasUnnegatedKeywordMatch(text, keywordPattern) {
  const flags = keywordPattern.flags.includes('g') ? keywordPattern.flags : keywordPattern.flags + 'g';
  const globalPattern = new RegExp(keywordPattern.source, flags);
  let m;
  while ((m = globalPattern.exec(text))) {
    const after = text.slice(m.index + m[0].length);
    if (!NEGATION_SUFFIX_PATTERN.test(after)) return true;
    if (m[0].length === 0) globalPattern.lastIndex++;
  }
  return false;
}
const ACHIEVED_POINT_KEYWORD_PATTERN = /実測|達成値|検討(?:の)?結果|測定した結果|試験(?:の)?結果|検査(?:の)?結果|実績値|成績値/;
const CAPABILITY_KEYWORD_PATTERN = /使用可能|対応可能|運転可能/;

// 実仕様側(Excel=B側、role='baseline_design'/'resolved_design')の意味候補。
const ACTUAL_SEMANTICS_RULES = [
  { value: 'achieved_point', weight: 0.3, evidenceType: 'quantity_shape',
    match: (text, quantity) => isGenuinePoint(quantity) && !text.includes('±') },
  // v2.10で0.3→0.15へ減衰したが、再レビューで「否定語辞書にない未知の曖昧語(代表値/中央値/
  // 計画値等)には依然として無条件に自動適用されてしまう」という指摘を受けた。「点である」
  // (0.3)と合算するとmodeConfidence閾値(0.4)を超えてしまうため、v2.11でさらに0.05へ抑えた。
  // 「B側(実仕様側)である」ことは役割を表すだけで、その点が達成値なのか設定値・公称値・
  // 試験条件・代表値・中央値・計画値なのかを識別する独立根拠にはならない、という指摘を
  // 額面どおり受け止め、未修飾の点は「形+役割」だけでは自動適用の閾値に届かない設計とした
  // (無修飾の点は確信度0.35で候補には残るが、auto_applicableはfalseになる)。
  //
  // v2.12(8.10節): レビュー推奨「列の役割＋セル内の肯定語＋数量形状を独立根拠として積み上げる」
  // に沿って再設計した。単に「B側である」という一律の役割根拠ではなく、出典列の名前そのもの
  // （'検討結果'＝検討の結果値、'標準機種情報'＝規格・公称値の可能性も残る）を弱い根拠として
  // 使う。ただし、この列根拠の重みは意図的に低く抑えている(0.05)。「点である(0.3)」と
  // 合算しても0.35にしかならず、モード確信度閾値(0.4)には届かない。これは、列名という
  // 構造的な手掛かりだけでは「代表値」「中央値」等の未知の曖昧語と同じ強さの根拠にしかならず、
  // 列根拠を強めるとv2.11で塞いだはずの脆弱性（否定語辞書にない曖昧語＋位置的な手掛かりだけで
  // 自動適用してしまう）を再び開けてしまうことを確認したため（8.10節参照）。
  { value: 'achieved_point', weight: 0.05, evidenceType: 'column_role',
    match: (text, quantity, record, ctx) => isGenuinePoint(quantity) && ctx.sourceColumn === '検討結果' },
  // セル内に達成値であることを積極的に示す語がある場合のみ、自動適用の閾値を超えられる
  // 強い根拠を与える。「点である」構造的根拠と組み合わせて初めて高確信度に達する設計とし、
  // 構造的根拠(形・列名)だけでは決して閾値を超えないようにしている。
  // v2.13(8.12節): JIS計測用語・検査成績書の実務用語を調査し、肯定語の語彙を拡張した。
  // 「試験結果」「検査結果」は実施した試験・検査で得た値を指す点で「実測」と同義だが、
  // 「試験」単体（否定根拠の語彙にある）とは意味が異なるため、後述のNEGATIVE_KEYWORD_RULESの
  // 「試験」パターンには「試験結果」を含めないよう除外している。「測定結果」「測定値」は
  // 既存のoutcome_range(変動・ばらつきの意味)の語彙と重複するため、ここには含めない。
  // v2.14: 「試験の結果」「検討の結果」のように「の」を挟む自然な表現も一致するよう、
  // 「試験」「検査」「検討」いずれも(?:の)?を挟めるパターンへ統一した。
  { value: 'achieved_point', weight: 0.4, evidenceType: 'keyword',
    match: (text, quantity) => isGenuinePoint(quantity) &&
      hasUnnegatedKeywordMatch(text, ACHIEVED_POINT_KEYWORD_PATTERN) },
  { value: 'capability_domain', weight: 0.55, evidenceType: 'keyword',
    match: (text, quantity) => isTwoSidedRange(quantity) && hasUnnegatedKeywordMatch(text, CAPABILITY_KEYWORD_PATTERN) },
  { value: 'capability_domain', weight: 0.1, evidenceType: 'quantity_shape',
    match: (text, quantity) => isTwoSidedRange(quantity) },
  // 点であっても、能力キーワードが伴う場合はcapability_domainの可能性も残す
  // (「点だから自動的にachieved_pointにしない」というレビュー指摘への対応。
  //  例:「対応可能温度は25℃のみ」は達成値・能力領域のどちらの解釈もあり得る)
  { value: 'capability_domain', weight: 0.4, evidenceType: 'keyword',
    match: (text, quantity) => isGenuinePoint(quantity) && hasUnnegatedKeywordMatch(text, CAPABILITY_KEYWORD_PATTERN) },
  { value: 'outcome_range', weight: 0.6, evidenceType: 'keyword',
    match: (text) => text.includes('±') },
  { value: 'outcome_range', weight: 0.5, evidenceType: 'keyword',
    match: (text) => /変動|ばらつき|測定結果|測定値/.test(text) },
  { value: 'guaranteed_minimum', weight: 0.55, evidenceType: 'qualifier',
    match: (text, quantity, record) => (record.qualifiers || []).some(q => q.type === 'minimum') },
  { value: 'guaranteed_minimum', weight: 0.1, evidenceType: 'quantity_shape',
    // 片側区間というだけでは弱い根拠に留める(「片側区間だけで保証下限を確定しない」)
    match: (text, quantity) => isOneSidedLower(quantity) },
  { value: 'guaranteed_maximum', weight: 0.55, evidenceType: 'qualifier',
    match: (text, quantity, record) => (record.qualifiers || []).some(q => q.type === 'maximum') },
  { value: 'guaranteed_maximum', weight: 0.1, evidenceType: 'quantity_shape',
    match: (text, quantity) => isOneSidedUpper(quantity) },
  // v2.18(8.21節): 「代表値」「平均値」「中央値」「最頻値」は、JIS Z 8101-1(統計－用語及び記号－
  // 第1部)が定義する統計用語であり、いずれも複数の測定値から算出される要約値(代表値の意味での
  // "measure of location")であって、単一の実測点(achieved_point)ではない。v2.10〜v2.13では
  // これらを意図的にどちらの辞書にも加えず、achieved_point側の構造的根拠(点である、0.3)のみが
  // 残る「未分類」の扱いとしていたが、これは「識別できていない」だけであり「安全に区別できて
  // いる」わけではなかった(v2.13時点の残課題として明記済み)。v2.18では、これらの語を専用の
  // 意味値aggregated_representative_valueとして明示的に識別する。集計値は個々のばらつきを
  // 均してしまうため(平均が規格内でも、個々の実測値は規格外の可能性がある)、COMPARISON_MODE_
  // DERIVATION_TABLEには意図的に追加せず、要求側とのペアからcomparisonModeを一切導出しない
  // (v2.10でrequired_capability_domain×achieved_pointを安全側の理由で除外したのと同じ設計)。
  //
  // v2.19(再レビュー軽微な改善提案への対応): 当初は「点である」という構造的根拠(0.1)を
  // 無条件のquantity_shapeルールとして追加していたが、これだと統計語が一切現れない
  // 通常の点(「実測25℃」等)にまで、無関係なaggregated_representative_value候補(0.1)が
  // 常に付いてしまい、候補配列のノイズになるという指摘を受けた(自動判定の安全性には
  // 影響しないが、候補配列の明瞭さを損なう)。統計語自体が「これは集計値である」ことを
  // 直接示す強い根拠であり、構造的根拠を別立てにする理由(他の値と違いshapeだけでは
  // 閾値を超えさせない、という8.11節の非対称設計)もこの値には当てはまらない
  // (auto_applicableの対象に一切していないため)。キーワードルール1本(重み0.6)へ統合した。
  { value: 'aggregated_representative_value', weight: 0.6, evidenceType: 'keyword',
    match: (text, quantity) => isGenuinePoint(quantity) &&
      hasUnnegatedKeywordMatch(text, /代表値|平均値|中央値|最頻値/) },
];

// 条件節(role='condition')の意味候補。レビュー8節の対照テスト例に基づく最小限の語彙。
const CONDITION_SEMANTICS_RULES = [
  { value: 'test_condition', weight: 0.5, evidenceType: 'keyword',
    match: (text) => /試験|測定/.test(text) },
];

// 否定根拠: どの候補にも一律に確信度を下げる方向で働く(特定候補だけを狙い撃ちしない)。
// v2.10: レビュー指摘により「設定」「公称」「試験」を追加。これらは「実仕様側の点＝達成値」
// という既定の解釈に疑問を投げかける語であり(設定値・公称値・試験条件は、必ずしも
// 実測された達成値ではない)、参考値・目安と同じ性質の否定根拠として扱う。重みも
// -0.3→-0.4へ強化し、「参考値58dB(A)」のようなケースでunknownと確実に差が付くようにした。
// v2.13(8.12節): JIS計測用語・検査成績書の実務用語調査により、「規格値」「基準値」
// 「目標値」「設計値」も、実測値と混同されやすい非達成値の語として追加した(規格値＝要求
// 許容範囲、目標値＝開発時点の目安、設計値＝理論上の理想値であり、いずれも実測結果ではない)。
// 「試験」は「試験結果」「試験の結果」（達成値を示す肯定語、上記ACTUAL_SEMANTICS_RULES参照）を
// 否定しないよう、否定先読みで除外している。v2.13時点では「試験(?!結果)」のみで「試験の結果」
// (「の」を挟む自然な表現)を除外できていなかった不具合を、v2.14で「試験(?!(?:の)?結果)」へ
// 修正した(検査成績書の実務調査は最初の不具合修正の際に参照した二次資料に基づくもので、
// 「試験の結果」という表記自体の見落としはレビューで指摘された)。
const NEGATIVE_KEYWORD_RULES = [
  { pattern: /参考値|目安|概算|設定|公称|試験(?!(?:の)?結果)|規格値|基準値|目標値|設計値/, weight: -0.4, label: '達成値との混同に注意を要する語' },
];

const UNKNOWN_BASELINE_CONFIDENCE = 0.15;

// ルール群を1レコードへ適用し、根拠付きの候補配列(確信度降順)を返す。
// 候補は複数保持する(単一候補にすると代替解釈と曖昧性の情報が失われるというレビュー指摘に対応)。
//
// 【重要】ここでの`confidence`は、ルール重みの単純加算値であり、統計的に校正された確率ではない
// (レビュー推奨修正4)。本プロトタイプでは検証用の相対スコアとして扱い、閾値との比較にのみ使う。
// 本体統合時は、名称を`score`へ改める、または`{score, score_model, calibrated:false}`のような
// 構造へ分離することを検討する(詳細はsemantic_mapping_prototype.md 8.8節参照)。
function scoreSemantics(rules, text, record, ctx) {
  const quantity = record.quantity;
  const shortText = text.length > 80 ? text.slice(0, 80) + '…' : text;
  const scores = new Map();
  const bump = (value, weight, evidenceType, effect) => {
    if (!scores.has(value)) scores.set(value, { score: 0, evidence: [] });
    const s = scores.get(value);
    s.score += weight;
    s.evidence.push({ type: evidenceType, value, source_text: shortText, effect, weight });
  };
  for (const rule of rules) {
    if (rule.match(text, quantity, record, ctx)) bump(rule.value, rule.weight, rule.evidenceType, 'supports');
  }
  // 否定根拠(達成値との混同注意語)は、実仕様側(side='B')のachieved_point等の解釈に疑問を
  // 投げかけるための語彙であり、要求側(side='A')の候補(acceptable_region等)には元々
  // 対応する「既定の達成値解釈」が無いため適用対象ではない。条件節(role='condition')では
  // 「試験」「測定」がtest_conditionの正の根拠として使われるため、ここでも適用しない。
  if (ctx.side === 'B' && !ctx.isConditionValue) {
    for (const neg of NEGATIVE_KEYWORD_RULES) {
      if (neg.pattern.test(text)) {
        for (const value of [...scores.keys()]) bump(value, neg.weight, 'negative_keyword', 'opposes');
      }
    }
  }
  if (!scores.has('unknown')) {
    scores.set('unknown', {
      score: UNKNOWN_BASELINE_CONFIDENCE,
      evidence: [{ type: 'baseline', value: 'unknown', source_text: '(既定の受け皿。他候補が弱い場合の下限)', effect: 'supports', weight: UNKNOWN_BASELINE_CONFIDENCE }],
    });
  }
  return [...scores.entries()]
    .map(([value, s]) => ({ value, confidence: Math.max(0, Math.min(0.99, s.score)), evidence: s.evidence }))
    .filter(c => c.confidence > 0.02)
    .sort((a, b) => b.confidence - a.confidence);
}

// ── 1レコード分のinterval_semantics候補を生成する ──
// v2.14(レビュー必須修正1): セル内に複数の数量が含まれる場合、キーワード一致を数量ごとに
// 同じ節(文の一部)に限定する。以前はctx.nearbyText全体に対して正規表現を適用していたため、
// 「規格値12kW、試験結果12.5kW」のようなセルで、別の数量に付いた語（否定語・肯定語問わず）が
// 誤って伝播していた（レビューで実際に再現・確認）。恒久的な構文解析までは行わず、句読点・
// 読点・全角カンマで区切った「節」を、対象数量の位置を含む区間として簡易的に切り出す
// 暫定策を採用した（桁区切りカンマ「1,500」を誤って区切らないよう、数字に挟まれたカンマは
// 除外している）。record.source_textがnearbyText内に見つからない場合は、安全側として
// nearbyText全体にフォールバックする(呼び出し側がnearbyTextに数量の原文を含めない
// テストケース等、位置特定できない場合を壊さないため)。
//
// v2.15(再レビュー必須修正1): 工程4aの抽出結果(quantity_extraction_prototype.jsの出力)は
// 数量の原文内オフセット(source_span)を公開していないため、v2.14では`nearbyText.indexOf(
// sourceText)`で位置を復元していた。これは同じ表記の数量が同一セルに複数回現れる場合
// (「規格値12kW、試験結果12kW」等)、常に最初の出現位置に解決されてしまう不具合があった
// (レビューで再現・確認)。工程4a側のスキーマ変更(source_spanの追加)は、v2.8で一旦固定と
// 評価された比較エンジンの前提を再び動かすことになり影響範囲が大きいため見送り、レビューが
// 提示した暫定策（同一文字列の出現番号を渡す）を採用した。呼び出し側(buildPropertyCandidateRecords)
// が、同じsource_textを持つ数量が何番目の出現かを数え、ctx.occurrenceIndexとして渡す。
const CLAUSE_DELIMITER_PATTERN = /、|。|，|(?<!\d),(?!\d)/g;

// nearbyText内で、sourceTextのn番目(0始まり)の出現位置を返す。見つからなければ-1。
function findNthIndexOf(haystack, needle, n) {
  let idx = -1;
  for (let i = 0; i <= n; i++) {
    idx = haystack.indexOf(needle, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

function localClauseText(nearbyText, sourceText, occurrenceIndex = 0) {
  if (!nearbyText || !sourceText) return nearbyText || '';
  const idx = findNthIndexOf(nearbyText, sourceText, occurrenceIndex);
  if (idx === -1) return nearbyText;
  const boundaries = [0];
  let m;
  CLAUSE_DELIMITER_PATTERN.lastIndex = 0;
  while ((m = CLAUSE_DELIMITER_PATTERN.exec(nearbyText))) {
    boundaries.push(m.index + m[0].length);
  }
  boundaries.push(nearbyText.length);
  for (let i = 0; i < boundaries.length - 1; i++) {
    let segStart = boundaries[i];
    const segEnd = boundaries[i + 1];
    if (idx < segStart || idx >= segEnd) continue;
    // 「試験の結果、58 dB(A)」のように、数量そのものを含まない前置きの節（「〜の結果、」等）は
    // 対象数量の節へ連結する。前の節に数字が一切含まれない場合に限り連結することで、
    // 「規格値12kW、試験結果12.5kW」のように前の節が別の数量を持つ場合は連結しない
    // (それぞれの数量が別の語を誤って受け取らないようにする)。
    let j = i - 1;
    while (j >= 0) {
      const prevStart = boundaries[j], prevEnd = boundaries[j + 1];
      const prevSeg = nearbyText.slice(prevStart, prevEnd);
      if (/\d/.test(prevSeg)) break; // 前の節に数字(別の数量)があれば連結しない
      segStart = prevStart;
      j--;
    }
    return nearbyText.slice(segStart, segEnd);
  }
  return nearbyText;
}

// v2.15(再レビュー必須修正2): 節への分割は、要求側(側A)では「電源電圧220V、50Hzとすること」
// のように、複数の数量が文末の共通述語(「〜とすること」)を共有する構造を壊す
// (実際に220Vの局所節が「定格電源は三相AC 220V、」となり、「とすること」を失うことを確認)。
// 今回解決すべき誤伝播は主に実仕様側(側B)の達成値・否定語判定であるため、節分割は側Bかつ
// 条件節でない場合のみに限定し、要求側は従来どおり全文を判定対象にする(安全側の暫定対応。
// 要求側で複数数量が異なる述語を持つケースへの対応は将来課題とする)。
function generateIntervalSemanticsCandidates(record, ctx) {
  const fullText = ctx.nearbyText || record.source_text || '';
  const text = (ctx.side === 'B' && !ctx.isConditionValue)
    ? localClauseText(fullText, record.source_text || '', ctx.occurrenceIndex || 0)
    : fullText;
  if (ctx.isConditionValue) return scoreSemantics(CONDITION_SEMANTICS_RULES, text, record, ctx);
  if (ctx.side === 'A') return scoreSemantics(REQUIREMENT_SEMANTICS_RULES, text, record, ctx);
  if (ctx.side === 'B') return scoreSemantics(ACTUAL_SEMANTICS_RULES, text, record, ctx);
  return scoreSemantics([], text, record, ctx);
}

// ── 要求側semanticsと実仕様側semanticsの組み合わせから、comparisonMode候補を導出する ──
// 単一レコードだけからcomparisonModeを決めない(レビュー指摘)。未定義の組み合わせや
// 片方でもunknownの場合は導出しない(推測しない)。
//
// v2.10: レビュー指摘により、required_capability_domain × achieved_point の対応
// (point_in_region)を削除した。要求が「対応可能領域全体」を求めている(例:「0〜50℃で
// 運転できること」)のに対し、実仕様が単一の達成値(例:「25℃」)しかない場合、その1点が
// 要求範囲内にあっても、要求範囲全域に対応できることの証明にはならない。この組み合わせは
// 当面「導出規則なし」とし、comparisonMode候補を返さない(comparable:falseのまま要確認とする)。
// acceptable_region × achieved_point (「騒音60dB以下」に対する「58dB」等、達成値が
// 許容範囲内かを問う関係)は、この問題を持たないため引き続きpoint_in_regionを対応させる。
const COMPARISON_MODE_DERIVATION_TABLE = [
  { requirement: 'acceptable_region', actual: 'achieved_point', mode: 'point_in_region' },
  { requirement: 'required_capability_domain', actual: 'capability_domain', mode: 'actual_covers_requirement' },
  { requirement: 'acceptable_region', actual: 'outcome_range', mode: 'requirement_covers_actual' },
  { requirement: 'acceptable_region', actual: 'guaranteed_minimum', mode: 'requirement_covers_actual' },
  { requirement: 'acceptable_region', actual: 'guaranteed_maximum', mode: 'requirement_covers_actual' },
];

function deriveComparisonModeCandidate(requirementCandidates, actualCandidates) {
  const reqTop = requirementCandidates?.[0];
  const actTop = actualCandidates?.[0];
  if (!reqTop || !actTop || reqTop.value === 'unknown' || actTop.value === 'unknown') return null;
  const entry = COMPARISON_MODE_DERIVATION_TABLE.find(e => e.requirement === reqTop.value && e.actual === actTop.value);
  if (!entry) return null;
  return {
    value: entry.mode,
    confidence: Math.min(reqTop.confidence, actTop.confidence), // たたき台: 保守的にminを採用。要調整
    derived_from: { requirement_semantics: reqTop.value, actual_semantics: actTop.value },
    confirmed: false,
  };
}

// ── 高確信度候補を暫定比較へ自動利用してよいかを判定する ──
// confirmed(人間が確定したか)とauto_applicable(暫定比較へ自動利用してよいか)は分離する。
// 自動適用しても、人間が確定したことにはならない。閾値は検証用パラメータであり、
// 本体統合前に実データでの再調整を要する(たたき台)。
const AUTO_APPLICABLE_THRESHOLDS = {
  modeConfidence: 0.4,
  margin: 0.2,
  propertyConfidence: 0.7,
};

function marginOf(candidates) {
  if (!candidates || candidates.length === 0) return 0;
  if (candidates.length === 1) return candidates[0].confidence;
  return candidates[0].confidence - candidates[1].confidence;
}
function hasOpposingEvidence(candidates) {
  const top = candidates?.[0];
  return !!(top && top.evidence.some(e => e.effect === 'opposes'));
}

function evaluateAutoApplicable({ modeCandidate, requirementCandidates, actualCandidates, propertyConfidence, extractionWarningsCount }) {
  const th = AUTO_APPLICABLE_THRESHOLDS;
  const reasons = [];
  const failReasons = [];
  if (!modeCandidate) {
    failReasons.push('comparison_mode候補を導出できない(片方がunknown、または未定義の組み合わせ)');
  } else if (modeCandidate.confidence >= th.modeConfidence) {
    reasons.push(`comparison_mode確信度${modeCandidate.confidence.toFixed(2)}が閾値${th.modeConfidence}以上`);
  } else {
    failReasons.push(`comparison_mode確信度${modeCandidate.confidence.toFixed(2)}が閾値${th.modeConfidence}未満`);
  }
  const reqMargin = marginOf(requirementCandidates);
  const actMargin = marginOf(actualCandidates);
  if (reqMargin >= th.margin) reasons.push(`要求側候補の差${reqMargin.toFixed(2)}が閾値${th.margin}以上`);
  else failReasons.push(`要求側候補の差${reqMargin.toFixed(2)}が閾値${th.margin}未満`);
  if (actMargin >= th.margin) reasons.push(`実仕様側候補の差${actMargin.toFixed(2)}が閾値${th.margin}以上`);
  else failReasons.push(`実仕様側候補の差${actMargin.toFixed(2)}が閾値${th.margin}未満`);
  if (!hasOpposingEvidence(requirementCandidates) && !hasOpposingEvidence(actualCandidates)) reasons.push('否定根拠なし');
  else failReasons.push('否定根拠あり');
  if (extractionWarningsCount === 0) reasons.push('抽出警告なし');
  else failReasons.push(`抽出警告${extractionWarningsCount}件`);
  if (propertyConfidence >= th.propertyConfidence) reasons.push(`設計特性の対応確信度${propertyConfidence.toFixed(2)}が閾値${th.propertyConfidence}以上`);
  else failReasons.push(`設計特性の対応確信度${(propertyConfidence || 0).toFixed(2)}が閾値${th.propertyConfidence}未満`);

  return { applicable: failReasons.length === 0, reasons, fail_reasons: failReasons };
}

// ── 概念辞書(たたき台)。案件の共通タグ辞書と同じ語彙をここでも利用する ──
const CONCEPT_DICTIONARY = [
  {
    concept_id: 'environment.ambient_operating_temperature',
    label: '周囲使用温度',
    expected_dimension: 'temperature',
    keywords: ['周囲温度', '使用温度', '運転温度'],
    tags: ['使用温度'],
  },
  {
    concept_id: 'performance.cooling_capacity',
    label: '冷房能力',
    expected_dimension: 'power',
    keywords: ['冷房能力', '冷却能力'],
    tags: ['冷房能力'],
  },
  {
    concept_id: 'power_supply.voltage',
    label: '電源電圧',
    expected_dimension: 'voltage',
    keywords: ['電源電圧', '定格電圧', '電源'],
    tags: ['電源電圧'],
  },
  {
    concept_id: 'power_supply.frequency',
    label: '周波数',
    expected_dimension: 'frequency',
    keywords: ['周波数'],
    tags: ['周波数'],
  },
  {
    concept_id: 'acoustics.operating_noise',
    label: '運転騒音',
    expected_dimension: 'sound_pressure_level',
    keywords: ['騒音値', '運転騒音', '騒音'],
    tags: ['騒音'],
  },
  {
    concept_id: 'maintenance.access_space',
    label: '保守作業スペース',
    expected_dimension: 'length',
    keywords: ['保守作業スペース', '保守スペース', '保守'],
    tags: ['保守性'],
  },
];

// ── 概念候補の生成: unit.dimension一致 + 周辺語一致 + タグ一致を独立した根拠として積み上げる ──
function generatePropertyCandidates(quantity, ctx) {
  const nearbyText = ctx.nearbyText || '';
  const tags = ctx.tags || [];
  const candidates = [];
  for (const concept of CONCEPT_DICTIONARY) {
    let score = 0;
    const evidence = [];
    if (quantity.unit.dimension === concept.expected_dimension) {
      score += 0.4;
      evidence.push(`単位次元一致: ${quantity.unit.dimension}`);
    }
    const kwHit = concept.keywords.find(k => nearbyText.includes(k));
    if (kwHit) {
      score += 0.35;
      evidence.push(`周辺語: ${kwHit}`);
    }
    const tagHit = concept.tags.find(t => tags.includes(t));
    if (tagHit) {
      score += 0.25;
      evidence.push(`タグ: ${tagHit}`);
    }
    if (score > 0) {
      candidates.push({ concept_id: concept.concept_id, label: concept.label, confidence: Math.min(0.99, score), evidence });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

// ── 役割候補の生成: 文書側(A/B)と出典列から推定する。確定はしない ──
function inferRole(ctx) {
  // 条件節由来かどうかを、文書側(A/B)より先に判定する。
  // 条件値(例: 「周囲温度40 °Cで10 kW」の40°C)は、どちら側の文書に出てきても
  // 役割としては同じ「条件」であり、A/B・列の違いは条件"値"自体の役割を変えない。
  if (ctx.isConditionValue) {
    return { role: 'condition', confidence: 0.75, evidence: ['条件節(〜において/〜で)由来の値'] };
  }
  if (ctx.side === 'A') {
    return { role: 'requirement', confidence: 0.7, evidence: ['PDF要求文書側(JSON A)からの抽出'] };
  }
  if (ctx.side === 'B') {
    if (ctx.sourceColumn === '標準機種情報') {
      return { role: 'baseline_design', confidence: 0.85, evidence: ['出典列: 標準機種情報'] };
    }
    if (ctx.sourceColumn === '検討結果') {
      return { role: 'resolved_design', confidence: 0.85, evidence: ['出典列: 検討結果'] };
    }
    return { role: 'unknown', confidence: 0.3, evidence: [] };
  }
  return { role: 'unknown', confidence: 0.2, evidence: [] };
}

// 条件候補(工程4aのcondition_candidates要素)を、通常のquantityレコードと同じ形へ整形する。
// cc自体は{source_text, quantity, unit, confidence}であり、工程4aの完全なレコード形
// {source_text, normalized_text, quantity, unit, context, extraction}とは形が異なるため、
// 下流(表示・coverageGap等)で一律に扱えるよう補完する。
function normalizeConditionAsRecord(cc) {
  return {
    source_text: cc.source_text,
    normalized_text: cc.source_text,
    quantity: cc.quantity,
    unit: cc.unit,
    context: { property: null, subject: null, state: null, tokens: [] },
    extraction: { confidence: cc.confidence, warnings: ['工程4aのcondition_candidatesから補完した値'] },
  };
}

// ── 1レコード分の意味対応候補を生成する。quantity_recordは工程4aのオブジェクトをそのまま参照する(文字列化しない) ──
function buildPropertyCandidateRecords(text, ctx) {
  const quantities = extractQuantities(text);
  const out = [];
  // v2.15(再レビュー必須修正1): 同じsource_textの数量がセル内に複数回出現する場合、それぞれが
  // 何番目の出現かを事前に数えておく(nearbyText.indexOf()が常に最初の出現に解決してしまう
  // 不具合への対応。localClauseText()へoccurrenceIndexとして渡す)。
  //
  // 【設計上の制約(レビューで指摘・文書化のみで承認)】この方式は、
  // extractQuantities()(quantity_extraction_prototype.js)の出力順序が原文中の出現順序と
  // 一致していることに依存する。現在の実装はextractFromSentence()内で
  // `raws.sort((a, b) => a.startLocal - b.startLocal)`により文内の出現順を保証しており、
  // 文をまたぐ場合もsplitSentences()の分割順に処理されるため、本プロトタイプの範囲では
  // 出現順序どおりに出力される。ただし、これは`quantities`配列がその順序で並ぶという
  // 暗黙の前提であり、明示的なデータ契約ではない。工程4a側で抽出結果の並べ替えや区間統合
  // 方法を変更すると、この前提が崩れoccurrenceIndexが誤って対応する可能性がある。本体統合を
  // 検討する際は、occurrenceIndexという間接的な位置特定ではなく、工程4aの出力へ
  // source_span(原文内の開始・終了オフセット)を正式なデータ契約として追加し、
  // localClauseText()がそれを直接使う設計へ移行することが望ましい。
  const occurrenceCounts = new Map();
  quantities.forEach((q, idx) => {
    const occurrenceIndex = occurrenceCounts.get(q.source_text) || 0;
    occurrenceCounts.set(q.source_text, occurrenceIndex + 1);
    out.push({
      source: ctx.source,
      quantity_ref: { index: idx, source_text: q.source_text, isCondition: false }, // 参照情報(indexとsource_textで元quantityへ戻れる)
      quantity_record: q, // 工程4aの構造化オブジェクトをそのまま保持(文字列化しない)
      property_candidates: generatePropertyCandidates(q, ctx),
      role_candidate: inferRole({ ...ctx, isConditionValue: false }),
      interval_semantics_candidates: generateIntervalSemanticsCandidates(q, { ...ctx, isConditionValue: false, occurrenceIndex }),
      confirmed: false, // 候補のみ。人間が確認するまでfalseのまま
    });
    // 条件候補(condition_candidates)も、それ自体が別の意味対応付け対象になり得るため候補化する
    (q.condition_candidates || []).forEach(cc => {
      const ccRecord = normalizeConditionAsRecord(cc);
      out.push({
        source: ctx.source + '(条件節)',
        quantity_ref: { index: idx, source_text: cc.source_text, isCondition: true },
        quantity_record: ccRecord,
        property_candidates: generatePropertyCandidates(ccRecord, ctx),
        role_candidate: inferRole({ ...ctx, isConditionValue: true }),
        interval_semantics_candidates: generateIntervalSemanticsCandidates(ccRecord, { ...ctx, isConditionValue: true }),
        confirmed: false,
      });
    });
  });
  return out;
}

// ── 概念候補でグルーピングする(最上位候補のconcept_idが一致するものをまとめる) ──
function groupByTopConcept(records, minConfidence = 0.5) {
  const groups = new Map();
  for (const r of records) {
    const top = r.property_candidates[0];
    if (!top || top.confidence < minConfidence) continue;
    if (!groups.has(top.concept_id)) groups.set(top.concept_id, { concept_id: top.concept_id, label: top.label, members: [] });
    groups.get(top.concept_id).members.push({
      source: r.source,
      role: r.role_candidate.role,
      role_confidence: r.role_candidate.confidence,
      concept_confidence: top.confidence,
      quantity_record: r.quantity_record,
      interval_semantics_candidates: r.interval_semantics_candidates,
    });
  }
  return [...groups.values()];
}

// ── 概念グループ単位で、要求×実仕様(baseline_design/resolved_design)の比較を自動導出する ──
// interval_semantics候補→comparisonMode候補→auto_applicable判定→(適用可能な場合のみ)coverageGap()
// の順で処理する。確信度不足の場合はcoverageGap()を呼ばず「要確認」のまま留める。
function autoCompareGroup(group) {
  const req = group.members.find(m => m.role === 'requirement');
  if (!req) return { concept_id: group.concept_id, label: group.label, comparisons: [] };
  const comparisons = [];
  for (const role of ['baseline_design', 'resolved_design']) {
    const actual = group.members.find(m => m.role === role);
    if (!actual) continue;
    const modeCandidate = deriveComparisonModeCandidate(req.interval_semantics_candidates, actual.interval_semantics_candidates);
    const extractionWarningsCount =
      (req.quantity_record.extraction?.warnings.length || 0) + (actual.quantity_record.extraction?.warnings.length || 0);
    const autoApplicable = evaluateAutoApplicable({
      modeCandidate,
      requirementCandidates: req.interval_semantics_candidates,
      actualCandidates: actual.interval_semantics_candidates,
      propertyConfidence: Math.min(req.concept_confidence, actual.concept_confidence),
      extractionWarningsCount,
    });
    const comparison = autoApplicable.applicable
      ? coverageGap(req.quantity_record, actual.quantity_record, { comparisonMode: modeCandidate.value })
      : { comparable: false, reason: '確信度不足のため自動適用を見送り(要確認)' };
    comparisons.push({ role, requirement_top: req.interval_semantics_candidates[0], actual_top: actual.interval_semantics_candidates[0], modeCandidate, autoApplicable, comparison });
  }
  return { concept_id: group.concept_id, label: group.label, comparisons };
}

module.exports = {
  generatePropertyCandidates, inferRole, buildPropertyCandidateRecords, groupByTopConcept, CONCEPT_DICTIONARY,
  generateIntervalSemanticsCandidates, deriveComparisonModeCandidate, evaluateAutoApplicable, autoCompareGroup,
  COMPARISON_MODE_DERIVATION_TABLE,
};

// ── 単体実行時のデモ・テスト出力 ──
if (require.main === module) {
  // 実データ(samples/hvac_trace_sample_small/)そのまま。PDF要求4件 + Excel設計項目5件(標準機種情報/検討結果)。
  const pdfRequirements = [
    { source: 'PDF 2.1 使用環境', text: '空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。', tags: ['使用温度'] },
    { source: 'PDF 2.2 冷房性能', text: '周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。', tags: ['使用温度', '冷房能力'] },
    { source: 'PDF 2.3 電源仕様', text: '定格電源は三相AC 220 V、50 Hzとすること。', tags: ['電源電圧', '周波数'] },
    { source: 'PDF 2.4 騒音', text: '定格運転時の装置正面1 mにおける騒音値は60 dB(A)以下とすること。', tags: ['騒音'] },
  ];

  const excelRows = [
    { 設計項目: '使用温度範囲', tags: ['使用温度'], 標準機種情報: '0 °C～40 °C', 検討結果: '0 °C～50 °Cで使用可能' },
    { 設計項目: '冷房能力', tags: ['冷房能力', '使用温度'], 標準機種情報: '周囲温度40 °Cで10 kW', 検討結果: '周囲温度50 °Cで12.5 kW' },
    { 設計項目: '電源電圧・周波数', tags: ['電源電圧', '周波数'], 標準機種情報: '三相AC 200 V、50/60 Hz', 検討結果: '三相AC 220 V、50 Hzに対応' },
    { 設計項目: '運転騒音', tags: ['騒音'], 標準機種情報: '装置正面1 mで65 dB(A)', 検討結果: '定格運転時、装置正面1 mで58 dB(A)' },
    { 設計項目: '保守作業スペース', tags: ['保守性'], 標準機種情報: '前面600 mm', 検討結果: '前面600 mmを確保' },
  ];

  console.log('########## 1. PDF側の意味対応候補 ##########');
  let allRecords = [];
  for (const req of pdfRequirements) {
    const recs = buildPropertyCandidateRecords(req.text, { side: 'A', source: req.source, tags: req.tags, nearbyText: req.text });
    allRecords = allRecords.concat(recs);
    console.log(`\n--- ${req.source} ---`);
    recs.forEach(r => console.log(`  [${r.quantity_record.source_text}] top候補: ${r.property_candidates[0]?.concept_id || '(なし)'} (conf ${r.property_candidates[0]?.confidence.toFixed(2) || '-'}) / role: ${r.role_candidate.role}(${r.role_candidate.confidence})`));
  }

  console.log('\n\n########## 2. Excel側の意味対応候補(列ごとに個別抽出) ##########');
  for (const row of excelRows) {
    for (const col of ['標準機種情報', '検討結果']) {
      const text = row[col];
      const recs = buildPropertyCandidateRecords(text, {
        side: 'B', source: `Excel ${row.設計項目}/${col}`, tags: row.tags, nearbyText: `${row.設計項目} ${text}`, sourceColumn: col,
      });
      allRecords = allRecords.concat(recs);
      console.log(`\n--- Excel ${row.設計項目}/${col} ("${text}") ---`);
      recs.forEach(r => console.log(`  [${r.quantity_record.source_text}] top候補: ${r.property_candidates[0]?.concept_id || '(なし)'} (conf ${r.property_candidates[0]?.confidence.toFixed(2) || '-'}) / role: ${r.role_candidate.role}(${r.role_candidate.confidence})`));
    }
  }

  console.log('\n\n########## 3. concept_idでグルーピング ##########');
  const groups = groupByTopConcept(allRecords);
  for (const g of groups) {
    console.log(`\n=== ${g.concept_id} (${g.label}) — ${g.members.length}件 ===`);
    g.members.forEach(m => console.log(`  role=${m.role.padEnd(16)} concept_conf=${m.concept_confidence.toFixed(2)} source=${m.source} quantity=${JSON.stringify(m.quantity_record.quantity)}`));
  }

  console.log('\n\n########## 4. 工程5への自動橋渡し: interval_semantics候補→comparisonMode候補→auto_applicable判定 ##########');
  console.log('区間の形(点/片側/両側)だけでは意味を確定しない。役割・周辺語・修飾語等から');
  console.log('interval_semantics候補を生成し、要求側×実仕様側の組み合わせからcomparisonMode候補を');
  console.log('導出する。確信度・候補間の差・否定根拠・抽出警告・設計特性の対応確信度が全て基準を');
  console.log('満たす場合のみcoverageGap()を自動実行し、そうでなければ「要確認」のまま留める。');
  const autoResults = groups.map(autoCompareGroup);
  for (const gr of autoResults) {
    if (gr.comparisons.length === 0) continue;
    console.log(`\n--- ${gr.label} (${gr.concept_id}) ---`);
    for (const c of gr.comparisons) {
      const roleLabel = c.role === 'baseline_design' ? '要求 vs 標準機種' : '要求 vs 検討結果';
      console.log(`  ${roleLabel}:`);
      console.log(`    要求側top候補: ${c.requirement_top?.value}(${c.requirement_top?.confidence.toFixed(2)}) / 実仕様側top候補: ${c.actual_top?.value}(${c.actual_top?.confidence.toFixed(2)})`);
      console.log(`    comparisonMode候補: ${c.modeCandidate ? `${c.modeCandidate.value}(${c.modeCandidate.confidence.toFixed(2)})` : '(導出不可)'}`);
      console.log(`    auto_applicable: ${c.autoApplicable.applicable} ${c.autoApplicable.applicable ? '['+c.autoApplicable.reasons.join('; ')+']' : '['+c.autoApplicable.fail_reasons.join('; ')+']'}`);
      console.log(`    比較結果: ${JSON.stringify(c.comparison)}`);
    }
  }

  console.log('\n\n########## 5. 完了条件チェック(自動アサーション) ##########');
  const assertions = [];
  const check = (name, cond) => assertions.push({ name, pass: !!cond });

  const tempGroup = groups.find(g => g.concept_id === 'environment.ambient_operating_temperature');
  check('温度概念グループが生成される', !!tempGroup);
  check('温度概念グループにrequirement/baseline_design/resolved_designが揃う',
    tempGroup && ['requirement', 'baseline_design', 'resolved_design'].every(role => tempGroup.members.some(m => m.role === role)));

  const tempReq = tempGroup?.members.find(m => m.role === 'requirement');
  const tempBaseline = tempGroup?.members.find(m => m.role === 'baseline_design');
  const tempResolved = tempGroup?.members.find(m => m.role === 'resolved_design');

  // v2.9: interval_semantics候補生成→comparisonMode自動導出のパイプラインを、温度概念グループで検証する。
  // 標準機種情報「0 °C～40 °C」にはcapability_domainを示す明示的な語(使用可能等)がなく、
  // 実仕様側のtop候補が'unknown'になるため、comparisonModeを導出できず「要確認」のまま
  // 留まる(誤った自動判定より安全)。検討結果「0 °C～50 °Cで使用可能」は「使用可能」という
  // 明示語があるためcapability_domainとして自動導出でき、要求側の「運転できること」と
  // 組み合わさってactual_covers_requirementが導出され、自動適用される。
  const tempAuto = autoCompareGroup(tempGroup);
  const tempBaselineResult = tempAuto.comparisons.find(c => c.role === 'baseline_design');
  const tempResolvedResult = tempAuto.comparisons.find(c => c.role === 'resolved_design');
  check('温度/標準機種: キーワードなしの両側区間はinterval_semanticsがunknownとなり、要確認のまま留まる(自動判定しない)',
    tempBaselineResult && tempBaselineResult.actual_top.value === 'unknown' &&
    tempBaselineResult.modeCandidate === null && tempBaselineResult.comparison.comparable === false);
  check('温度/検討結果: 「使用可能」を根拠にcapability_domainが自動導出され、要求と組み合わせてactual_covers_requirementが自動適用される',
    tempResolvedResult && tempResolvedResult.actual_top.value === 'capability_domain' &&
    tempResolvedResult.modeCandidate?.value === 'actual_covers_requirement' &&
    tempResolvedResult.autoApplicable.applicable === true &&
    tempResolvedResult.comparison.satisfied === true && tempResolvedResult.comparison.highGap === 0);

  // v2.11: 冷房能力・電圧・騒音は、達成値(点)であることの構造的根拠と実仕様側であることの
  // 役割根拠「だけ」では、point_in_regionのcomparisonMode候補自体は導出されるものの、
  // 確信度不足のため自動適用はされない(要確認のまま留まる)ことを確認する。
  // v2.10まではこの「形+役割だけ」の組み合わせでも自動適用されていたが、外部レビューにより
  // 「代表値」「中央値」「計画値」のような、否定語辞書にない曖昧な修飾語を伴う点も
  // 区別なく自動適用されてしまうという指摘を受け、v2.11でachieved_pointのsource_role重みを
  // さらに引き下げた(8.9節参照)。この結果、明示的な肯定根拠(達成値であることを示す
  // 周辺語等)を伴わない裸の点は、候補としては残るが自動適用されないという、より保守的な
  // 挙動になった。
  const coolingAuto = autoCompareGroup(groups.find(g => g.concept_id === 'performance.cooling_capacity'));
  const coolingResolvedResult = coolingAuto.comparisons.find(c => c.role === 'resolved_design');
  check('冷房能力/検討結果: キーワードなしの達成値はpoint_in_region候補は導出されるが、確信度不足のため自動適用されない(要確認)',
    coolingResolvedResult?.modeCandidate?.value === 'point_in_region' &&
    coolingResolvedResult.autoApplicable.applicable === false &&
    coolingResolvedResult.comparison.comparable === false);

  const coolingGroup = groups.find(g => g.concept_id === 'performance.cooling_capacity');
  check('冷房能力の概念グループも生成される', !!coolingGroup);
  const coolingResolved = coolingGroup?.members.find(m => m.role === 'resolved_design');
  check('冷房能力/検討結果が12.5kWのまま破損せず伝わる(工程4a v2.3バグの回帰確認)',
    coolingResolved?.quantity_record.quantity.lower.value === 12.5);

  check('候補は全てconfirmed:falseのまま(自動確定しない)',
    allRecords.every(r => r.confirmed === false));
  check('quantity_recordは文字列でなく工程4aの構造化オブジェクト参照のまま',
    allRecords.every(r => typeof r.quantity_record === 'object' && r.quantity_record.quantity && typeof r.quantity_record.quantity === 'object'));

  // coverageGap()の方向性バグの回帰テスト(v2.4で修正済み)。
  // 「12kW以上」という片側閾値要求に対し、要求を大幅に超える999kWの設計値を比較すると、
  // 達成値が点(point)であるためpoint_in_regionモードで比較され、正しく充足(true)と判定される。
  {
    const req = extractQuantities('冷房能力12 kW以上を確保すること')[0];
    const farExceeding = extractQuantities('冷房能力999 kW')[0];
    const g = coverageGap(req, farExceeding);
    check('【v2.4で修正済み】999kWは12kW以上の要求を満たす(point_in_regionモードで正しく充足と判定される)',
      g.satisfied === true && g.comparison_mode === 'point_in_region');
  }

  // v2.6: 外部レビュー指摘の回帰テスト。両側区間どうしの比較(温度)は、区間の意味候補を
  // 持たないこの工程3プロトタイプ単体では、comparisonModeを明示しない限り自動判定できない
  // ことを、4章の自動橋渡しループと同じ呼び出し方(mode未指定)で確認する。
  if (tempReq && tempBaseline) {
    const g = coverageGap(tempReq.quantity_record, tempBaseline.quantity_record);
    check('【v2.6で追加確認】両側区間(温度)はcomparisonMode未指定では自動橋渡しループも比較不能を返す',
      g.comparable === false);
  }

  // ── v2.9: interval_semantics 対照テスト(同じ数量形状でも文脈が変われば候補が変わることの確認) ──
  function actTop(text) {
    const r = extractQuantities(text)[0];
    return generateIntervalSemanticsCandidates(r, { side: 'B', nearbyText: text })[0];
  }
  function condTop(text) {
    const r = extractQuantities(text)[0];
    return generateIntervalSemanticsCandidates(r, { side: 'B', isConditionValue: true, nearbyText: text })[0];
  }
  check('対照: 「0～50℃で使用可能」→capability_domainが最上位候補になる',
    actTop('0 ℃から50 ℃で使用可能').value === 'capability_domain');
  check('対照: 「試験温度は0～50℃」→test_conditionが最上位候補になる',
    condTop('試験温度は0 ℃から50 ℃')?.value === 'test_condition');
  check('対照: 「測定結果は0～50℃」→outcome_rangeが最上位候補になる',
    actTop('測定結果は0 ℃から50 ℃').value === 'outcome_range');
  check('対照: 「電圧は220±10Vで変動する」→outcome_rangeが最上位候補になる',
    actTop('電圧は220±10Vで変動する').value === 'outcome_range');
  check('対照: 「冷房能力は最低15kW」→guaranteed_minimumが最上位候補になる(最低=最小の同義語、工程4a v2.9対応)',
    actTop('冷房能力は最低15kW').value === 'guaranteed_minimum');
  check('対照: 「騒音は最大58dB(A)」→guaranteed_maximumが最上位候補になる',
    actTop('騒音は最大58dB(A)').value === 'guaranteed_maximum');
  check('対照: 文脈のない「0～50℃」はunknownが最上位候補になる(形だけでcapability_domainを確定しない)',
    actTop('0 ℃から50 ℃').value === 'unknown');

  // ── v2.9: comparisonMode導出の対照テスト(ペアの組み合わせで結果が変わることの確認) ──
  function pairMode(reqText, actText, reqCtx = { side: 'A' }, actCtx = { side: 'B' }) {
    const reqRecord = extractQuantities(reqText)[0];
    const actRecord = extractQuantities(actText)[0];
    const reqC = generateIntervalSemanticsCandidates(reqRecord, { ...reqCtx, nearbyText: reqText });
    const actC = generateIntervalSemanticsCandidates(actRecord, { ...actCtx, nearbyText: actText });
    return deriveComparisonModeCandidate(reqC, actC);
  }
  check('ペア導出: required_capability_domain×capability_domain→actual_covers_requirement',
    pairMode('装置は0 ℃から50 ℃の環境で正常に運転できること。', '0 ℃から50 ℃で使用可能')?.value === 'actual_covers_requirement');
  check('ペア導出: acceptable_region×achieved_point→point_in_region',
    pairMode('冷房能力12 kW以上を確保すること。', '冷房能力は12.5 kW')?.value === 'point_in_region');
  check('ペア導出: acceptable_region×outcome_range→requirement_covers_actual',
    pairMode('電源電圧は200 Vから240 Vの範囲とすること。', '電源電圧は220±10 Vで変動する')?.value === 'requirement_covers_actual');
  check('ペア導出: unknownを含むペアはcomparison_mode候補を導出しない(comparable:falseへ)',
    pairMode('冷房能力12 kW以上を確保すること。', '冷房能力は0 kWから20 kWまで')?.value === undefined ||
    pairMode('冷房能力12 kW以上を確保すること。', '冷房能力は0 kWから20 kWまで') === null);

  // ── v2.9: 誤判定防止テスト(レビュー9節。工程3でも過去の教訓を再発防止として固定する) ──
  check('誤判定防止: 片側区間(15kW以上)だけでは保証下限を確定しない(unknownが最上位のまま)',
    actTop('15 kW以上').value === 'unknown');
  check('誤判定防止: 両側区間(0～50℃)だけでは能力領域を確定しない(unknownが最上位のまま、既出だが明示的に再確認)',
    actTop('0 ℃から50 ℃').value === 'unknown');
  {
    // 点であっても能力キーワードが伴う場合は、achieved_pointだけでなくcapability_domainも
    // 候補として残ることを確認する(「点だから自動的にachieved_pointにしない」)。
    const c = actTop('対応可能温度は25 ℃のみ');
    const c2 = generateIntervalSemanticsCandidates(extractQuantities('対応可能温度は25 ℃のみ')[0], { side: 'B', nearbyText: '対応可能温度は25 ℃のみ' });
    check('誤判定防止: 点+能力キーワードでは、achieved_pointだけでなくcapability_domainも候補として残る',
      c2.some(x => x.value === 'achieved_point') && c2.some(x => x.value === 'capability_domain'));
  }
  {
    // ±があっても、要求側(許容差)と実仕様側(変動・ばらつき)で扱いが分かれることを確認する。
    const reqSide = generateIntervalSemanticsCandidates(extractQuantities('電源電圧は220±10 Vとすること。')[0],
      { side: 'A', nearbyText: '電源電圧は220±10 Vとすること。' });
    check('誤判定防止: ±が要求側にある場合、outcome_range固定ではなくacceptable_region候補が生成される(側によって扱いが分かれる)',
      reqSide[0]?.value === 'acceptable_region');
  }
  {
    // 否定根拠(参考値・目安等)がある場合、確信度が下がりunknownへ寄ることを確認する。
    const c = actTop('参考値として0 ℃から50 ℃');
    check('誤判定防止: 「参考値」等の否定根拠があると、候補の確信度が下がりunknownが最上位のままになる',
      c.value === 'unknown');
  }
  check('誤判定防止: comparison_mode確信度が閾値未満の場合はauto_applicableにならない(冷房能力の閾値vs超過値ペアで確認)',
    (() => {
      const reqRecord = extractQuantities('冷房能力12 kW以上を確保すること。')[0];
      const actRecord = extractQuantities('冷房能力は0 kWから20 kWまで')[0];
      const reqC = generateIntervalSemanticsCandidates(reqRecord, { side: 'A', nearbyText: '冷房能力12 kW以上を確保すること。' });
      const actC = generateIntervalSemanticsCandidates(actRecord, { side: 'B', nearbyText: '冷房能力は0 kWから20 kWまで' });
      const modeCandidate = deriveComparisonModeCandidate(reqC, actC);
      const evalResult = evaluateAutoApplicable({ modeCandidate, requirementCandidates: reqC, actualCandidates: actC, propertyConfidence: 0.99, extractionWarningsCount: 0 });
      return modeCandidate === null && evalResult.applicable === false;
    })());

  // ── v2.10: 外部レビュー必須修正1の回帰テスト ──
  // required_capability_domain(要求が対応可能領域全体を求める) × achieved_point(実仕様は
  // 単一の達成値)は、point_in_regionへ対応させてはいけない。「0~50℃で運転できること」という
  // 要求に対し「25℃」という1点の実仕様は、その1点で運転できることを示すだけで、要求範囲
  // 全域への対応を証明しない。この組み合わせは導出規則なしとし、要確認のまま留める。
  {
    const reqText = '装置は0 ℃から50 ℃の環境で正常に運転できること。';
    const actText = '使用温度は25 ℃';
    const reqRecord = extractQuantities(reqText)[0];
    const actRecord = extractQuantities(actText)[0];
    const reqC = generateIntervalSemanticsCandidates(reqRecord, { side: 'A', nearbyText: reqText });
    const actC = generateIntervalSemanticsCandidates(actRecord, { side: 'B', nearbyText: actText });
    check('必須修正1: 要求側がrequired_capability_domainと判定される(「運転できること」)',
      reqC[0].value === 'required_capability_domain');
    check('必須修正1: 実仕様側がachieved_pointと判定される(単一の点)',
      actC[0].value === 'achieved_point');
    const modeCandidate = deriveComparisonModeCandidate(reqC, actC);
    check('必須修正1: required_capability_domain×achieved_pointはcomparisonMode候補を導出しない(point_in_regionにしない)',
      modeCandidate === null);
    const evalResult = evaluateAutoApplicable({ modeCandidate, requirementCandidates: reqC, actualCandidates: actC, propertyConfidence: 0.99, extractionWarningsCount: 0 });
    check('必須修正1: 上記の組み合わせはauto_applicable:falseになる(capability_domainを示す実仕様が必要)',
      evalResult.applicable === false);
  }

  // ── v2.10: 外部レビュー必須修正2の回帰テスト ──
  // 「B側(実仕様側)の点である」ことだけでは、その点が達成値なのか設定値・公称値・試験条件・
  // 参考値なのかを識別できない。以下4例は、いずれもachieved_pointが自動適用されないことを
  // 確認する(achieved_pointが最上位候補から外れる、またはunknownとの差が閾値未満になる)。
  {
    const disambiguousCases = ['設定温度25 ℃', '試験温度25 ℃', '公称電圧220 V', '参考値58 dB(A)'];
    for (const t of disambiguousCases) {
      const r = extractQuantities(t)[0];
      const c = generateIntervalSemanticsCandidates(r, { side: 'B', nearbyText: t });
      check(`必須修正2: 「${t}」はachieved_pointが自動適用されない(unknownが最上位、またはachieved_pointとの差が閾値未満)`,
        c[0].value === 'unknown' || marginOf(c) < AUTO_APPLICABLE_THRESHOLDS.margin);
    }
  }

  // ── v2.11: 再レビューによる必須修正2(再指摘)の回帰テスト ──
  // 「否定語辞書にない未知の曖昧語(代表値/中央値/計画値等)は、依然としてachieved_pointが
  // 自動適用されてしまう」という再指摘への対応。候補順位だけでなく、evaluateAutoApplicable()
  // まで通して確認する(modeCandidate自体は導出されてよいが、auto_applicable:falseであること)。
  {
    const reqNoise = extractQuantities('騒音は60 dB(A)以下とすること')[0];
    const reqTemp = extractQuantities('装置は0 ℃から50 ℃の環境で正常に運転できること。')[0];
    const reqVoltage = extractQuantities('定格電源は220 Vとすること。')[0];
    const unknownWordCases = [
      { label: '代表値58dB(A)', reqRecord: reqNoise, reqText: '騒音は60 dB(A)以下とすること', actText: '代表値58 dB(A)' },
      { label: '中央値25℃', reqRecord: reqTemp, reqText: '装置は0 ℃から50 ℃の環境で正常に運転できること。', actText: '中央値25 ℃' },
      { label: '計画値220V', reqRecord: reqVoltage, reqText: '定格電源は220 Vとすること。', actText: '計画値220 V' },
    ];
    for (const { label, reqRecord, reqText, actText } of unknownWordCases) {
      const actRecord = extractQuantities(actText)[0];
      const reqC = generateIntervalSemanticsCandidates(reqRecord, { side: 'A', nearbyText: reqText });
      // v2.12(8.10節)の回帰確認: 「検討結果」列に置かれた場合でも(列根拠+形の合算は0.35に
      // 留まるよう設計しているため)、これらの未知の曖昧語は依然として自動適用されないことを
      // 確認する。sourceColumnを明示することで、列の役割根拠込みでも安全であることを検証する。
      const actC = generateIntervalSemanticsCandidates(actRecord, { side: 'B', sourceColumn: '検討結果', nearbyText: actText });
      const modeCandidate = deriveComparisonModeCandidate(reqC, actC);
      const evalResult = evaluateAutoApplicable({ modeCandidate, requirementCandidates: reqC, actualCandidates: actC, propertyConfidence: 0.99, extractionWarningsCount: 0 });
      check(`必須修正2(再指摘): 「${label}」は検討結果列に置かれてもcomparisonMode候補が導出されつつauto_applicable:falseになる`,
        evalResult.applicable === false);
      // v2.11再レビューでの軽微な改善提案: applicable:falseだけでなく、modeCandidateの中身
      // (point_in_region・確信度0.35＝形0.3+列根拠0.05)まで固定しておくと、将来の回帰原因を
      // 判別しやすくなる（要求がacceptable_regionの場合。中央値25℃はrequired_capability_domain
      // 側のため対象外）。
      // v2.18(8.21節): 「代表値」はJIS Z 8101統計用語として明示的に識別されるようになり、
      // actCの最上位候補がachieved_point(0.35)からaggregated_representative_value(0.6)へ
      // 変わった。この値はCOMPARISON_MODE_DERIVATION_TABLEに未登録のため、modeCandidate自体が
      // 導出されなくなる(以前は「導出されるが確信度不足で非適用」、今は「そもそも導出しない」
      // という、より積極的な安全設計に変わった。「計画値」はJIS統計用語ではないため対象外で
      // 従来どおり)。
      if (reqRecord === reqVoltage) {
        check(`必須修正2(再指摘・固定値確認): 「${label}」のmodeCandidateはpoint_in_region・確信度0.35(検討結果列根拠込み)のまま導出される`,
          modeCandidate?.value === 'point_in_region' && modeCandidate?.confidence === 0.35);
      }
      if (reqRecord === reqNoise) {
        check(`統計語の安全設計(v2.18): 「${label}」はaggregated_representative_valueが最上位候補になり、comparisonModeが導出されない`,
          actC[0].value === 'aggregated_representative_value' && (modeCandidate === null || modeCandidate === undefined));
      }
    }
  }

  // ── v2.12(8.10節): 肯定的根拠(列の役割＋セル内の肯定語＋数量形状)の回帰テスト ──
  {
    // セル内に達成値であることを積極的に示す語がある場合は、列を問わず高確信度で
    // achieved_pointが自動適用されることを確認する(「肯定的根拠」の独立性)。
    const reqCooling = extractQuantities('冷房能力12 kW以上を確保すること。')[0];
    const actMeasured = extractQuantities('標準機種情報として実測10 kW')[0];
    const reqC1 = generateIntervalSemanticsCandidates(reqCooling, { side: 'A', nearbyText: '冷房能力12 kW以上を確保すること。' });
    const actC1 = generateIntervalSemanticsCandidates(actMeasured, { side: 'B', sourceColumn: '標準機種情報', nearbyText: '標準機種情報として実測10 kW' });
    check('肯定的根拠: 「実測10kW」は標準機種情報列でもachieved_pointが高確信度で候補になる(セル内の肯定語が列に関係なく機能する)',
      actC1[0].value === 'achieved_point' && actC1[0].confidence >= 0.7);
    const modeCandidate1 = deriveComparisonModeCandidate(reqC1, actC1);
    const evalResult1 = evaluateAutoApplicable({ modeCandidate: modeCandidate1, requirementCandidates: reqC1, actualCandidates: actC1, propertyConfidence: 0.99, extractionWarningsCount: 0 });
    check('肯定的根拠: 「実測10kW」はauto_applicable:trueになる(肯定語による裏付けがある場合は自動適用してよい)',
      evalResult1.applicable === true);
  }
  {
    // 列の役割(出典列が'検討結果'かどうか)は弱い根拠(0.05)として機能し、無修飾の点の確信度に
    // 差をつける(0.30→0.35)。ただし、この差だけでは自動適用の閾値には届かない
    // (「列名という構造的な手掛かりだけでは足りない」という設計意図の確認)。
    const actNoKeywordBaseline = extractQuantities('10 kW')[0];
    const cBaseline = generateIntervalSemanticsCandidates(actNoKeywordBaseline, { side: 'B', sourceColumn: '標準機種情報', nearbyText: '10 kW' });
    const cResolved = generateIntervalSemanticsCandidates(actNoKeywordBaseline, { side: 'B', sourceColumn: '検討結果', nearbyText: '10 kW' });
    check('列の役割: 同じ無修飾の点でも、検討結果列の方が標準機種情報列よりわずかに確信度が高い(0.35 > 0.30)',
      cResolved[0].value === 'achieved_point' && cBaseline[0].value === 'achieved_point' &&
      cResolved[0].confidence === 0.35 && cBaseline[0].confidence === 0.3);
    check('列の役割: 検討結果列という列名だけの根拠(形+列)では、自動適用の閾値(0.4)には届かない',
      cResolved[0].confidence < 0.4);
  }

  // ── v2.13(8.12節): JIS計測用語・検査成績書調査に基づく肯定語・否定語辞書拡張の回帰テスト ──
  {
    // 新規追加した肯定語(検査結果/試験結果/実績値/成績値)は、いずれもachieved_pointを
    // 高確信度(0.7)にし、auto_applicableになることを確認する。
    const positiveKeywordCases = ['検査結果は58 dB(A)', '試験結果は220 V', '実績値は12.5 kW', '成績値は58 dB(A)'];
    for (const t of positiveKeywordCases) {
      const r = extractQuantities(t).find(x => x.quantity.kind === 'interval');
      const c = generateIntervalSemanticsCandidates(r, { side: 'B', nearbyText: t });
      check(`肯定語拡張: 「${t}」はachieved_point:0.70で候補になる`,
        c[0].value === 'achieved_point' && c[0].confidence === 0.7);
    }
    // 「試験結果」は「試験」(否定根拠)に巻き込まれず肯定語として機能することの確認
    // (否定根拠の正規表現に否定先読み`試験(?!結果)`を追加した効果)。
    const testResultRecord = extractQuantities('試験結果は220 V')[0];
    check('肯定語拡張: 「試験結果」は「試験」の否定根拠に巻き込まれない(試験結果≠試験)',
      generateIntervalSemanticsCandidates(testResultRecord, { side: 'B', nearbyText: '試験結果は220 V' })[0].value === 'achieved_point');
  }
  {
    // 新規追加した否定語(規格値/基準値/目標値/設計値)は、いずれもachieved_pointを
    // unknown未満まで抑制することを確認する(実測値と混同されやすい非達成値の語)。
    const negativeKeywordCases = ['規格値は220 V', '基準値は58 dB(A)', '目標値は12 kW', '設計値は220 V'];
    for (const t of negativeKeywordCases) {
      const r = extractQuantities(t).find(x => x.quantity.kind === 'interval');
      const c = generateIntervalSemanticsCandidates(r, { side: 'B', nearbyText: t });
      check(`否定語拡張: 「${t}」はachieved_pointが候補から排除される(unknownのみ残る)`,
        c.length === 1 && c[0].value === 'unknown');
    }
  }
  {
    // v2.18(8.21節): 統計・代表値系の語(代表値/中央値/平均値/最頻値)は、JIS Z 8101-1の統計用語
    // 定義に基づき、achieved_pointとは別のaggregated_representative_value候補として明示的に
    // 識別されるようになった(v2.17までは未分類のまま、achieved_pointの構造的根拠0.3のみが
    // 残っていた)。確信度0.6(構造0.1+キーワード0.5)で最上位候補になることを確認する。
    for (const t of ['代表値58 dB(A)', '中央値25 ℃', '平均値25 ℃', '最頻値25 ℃']) {
      const r = extractQuantities(t).find(x => x.quantity.kind === 'interval');
      const c = generateIntervalSemanticsCandidates(r, { side: 'B', nearbyText: t });
      check(`統計語の明示的識別(v2.18): 「${t}」はaggregated_representative_value:0.60が最上位候補になる`,
        c[0].value === 'aggregated_representative_value' && Math.abs(c[0].confidence - 0.6) < 1e-9);
    }
    // 安全設計の確認: aggregated_representative_valueはCOMPARISON_MODE_DERIVATION_TABLEに
    // 意図的に加えていないため、要求側とペアにしてもcomparisonModeは導出されない
    // (「平均が規格内でも個々の実測値は規格外の可能性がある」という統計的な理由による)。
    {
      const reqText = '装置は0 ℃から50 ℃の環境で正常に運転できること。';
      const reqRecord = extractQuantities(reqText)[0];
      const reqC = generateIntervalSemanticsCandidates(reqRecord, { side: 'A', nearbyText: reqText });
      const actText = '平均値25 ℃';
      const actRecord = extractQuantities(actText).find(x => x.quantity.kind === 'interval');
      const actC = generateIntervalSemanticsCandidates(actRecord, { side: 'B', nearbyText: actText });
      const modeCandidate = deriveComparisonModeCandidate(reqC, actC);
      check('安全設計(v2.18): aggregated_representative_valueは要求側とのペアでcomparisonModeを導出しない',
        modeCandidate === null || modeCandidate === undefined);
    }
  }

  // ── v2.14: 再レビュー必須修正1の回帰テスト(キーワードのセル内誤伝播) ──
  // セル内に複数の数量が含まれる場合、キーワード一致を数量ごとの節(句読点で区切った区間)へ
  // 限定する。以前はctx.nearbyText全体に対して正規表現を適用していたため、別の数量に付いた
  // 語が誤って伝播していた(レビューで再現・確認)。
  {
    const text = '規格値12kW、試験結果12.5kW';
    const records = extractQuantities(text);
    const c12 = generateIntervalSemanticsCandidates(records.find(r => r.source_text === '12kW'), { side: 'B', nearbyText: text });
    const c125 = generateIntervalSemanticsCandidates(records.find(r => r.source_text === '12.5kW'), { side: 'B', nearbyText: text });
    check('必須修正1(再レビュー): 「規格値12kW、試験結果12.5kW」で12kWは否定根拠(規格値)のみを受け取る(unknownが最上位)',
      c12[0].value === 'unknown');
    check('必須修正1(再レビュー): 「規格値12kW、試験結果12.5kW」で12.5kWは肯定根拠(試験結果)のみを受け取る(0.70)',
      c125[0].value === 'achieved_point' && c125[0].confidence === 0.7);
  }
  {
    const text = '試験結果12.5kW、設定温度25℃';
    const records = extractQuantities(text);
    const c125 = generateIntervalSemanticsCandidates(records.find(r => r.source_text === '12.5kW'), { side: 'B', nearbyText: text });
    const c25 = generateIntervalSemanticsCandidates(records.find(r => r.source_text === '25℃'), { side: 'B', nearbyText: text });
    check('必須修正1(再レビュー): 「試験結果12.5kW、設定温度25℃」で12.5kWだけachieved_point(0.70)へ昇格する',
      c125[0].value === 'achieved_point' && c125[0].confidence === 0.7);
    check('必須修正1(再レビュー): 「試験結果12.5kW、設定温度25℃」で25℃には「試験結果」が伝播しない(unknownが最上位)',
      c25[0].value === 'unknown');
  }

  // ── v2.14: 再レビュー必須修正2の回帰テスト(「〜の結果」パターン) ──
  {
    const casesResult = [
      ['試験結果58dB(A)', '試験結果は58 dB(A)'],
      ['試験の結果58dB(A)', '試験の結果、58 dB(A)'],
      ['検査結果58dB(A)', '検査結果は58 dB(A)'],
      ['検査の結果58dB(A)', '検査の結果、58 dB(A)'],
    ];
    for (const [label, text] of casesResult) {
      const r = extractQuantities(text).find(x => x.quantity.kind === 'interval');
      const c = generateIntervalSemanticsCandidates(r, { side: 'B', nearbyText: text });
      check(`必須修正2(再レビュー): 「${label}」はachieved_point:0.70になる(「の」を挟んでも肯定語として機能する)`,
        c[0].value === 'achieved_point' && c[0].confidence === 0.7);
    }
  }

  // ── v2.14: 推奨修正(肯定語拡張4件をevaluateAutoApplicable()まで通す) ──
  {
    const reqCases = [
      ['検査結果は58 dB(A)', '騒音は60 dB(A)以下とすること'],
      ['試験結果は220 V', '定格電源は220 Vとすること。'],
      ['実績値は12.5 kW', '冷房能力12 kW以上を確保すること。'],
      ['成績値は58 dB(A)', '騒音は60 dB(A)以下とすること'],
    ];
    for (const [actText, reqText] of reqCases) {
      const reqRecord = extractQuantities(reqText)[0];
      const actRecord = extractQuantities(actText).find(x => x.quantity.kind === 'interval');
      const reqC = generateIntervalSemanticsCandidates(reqRecord, { side: 'A', nearbyText: reqText });
      const actC = generateIntervalSemanticsCandidates(actRecord, { side: 'B', nearbyText: actText });
      const modeCandidate = deriveComparisonModeCandidate(reqC, actC);
      const evalResult = evaluateAutoApplicable({ modeCandidate, requirementCandidates: reqC, actualCandidates: actC, propertyConfidence: 0.99, extractionWarningsCount: 0 });
      check(`肯定語拡張(推奨修正・pipeline確認): 「${actText}」はauto_applicable:trueまで到達する`,
        evalResult.applicable === true);
    }
  }

  // ── v2.15: 再レビュー必須修正1の回帰テスト(同一表記の数量が複数回出現する場合の位置特定) ──
  {
    const text = '規格値12kW、試験結果12kW';
    const records = extractQuantities(text); // [12kW(1個目), 12kW(2個目)]
    const c1st = generateIntervalSemanticsCandidates(records[0], { side: 'B', nearbyText: text, occurrenceIndex: 0 });
    const c2nd = generateIntervalSemanticsCandidates(records[1], { side: 'B', nearbyText: text, occurrenceIndex: 1 });
    check('必須修正1(v2.15): 「規格値12kW、試験結果12kW」で1個目の12kWは否定根拠(規格値)を受け取る(unknownが最上位)',
      c1st[0].value === 'unknown');
    check('必須修正1(v2.15): 「規格値12kW、試験結果12kW」で2個目の12kWは肯定根拠(試験結果)を受け取る(0.70)',
      c2nd[0].value === 'achieved_point' && c2nd[0].confidence === 0.7);
    // buildPropertyCandidateRecords()経由でも同じ結果になることを確認する(occurrenceIndexが
    // 呼び出し側で正しく自動計算されることの確認)。
    const recs = buildPropertyCandidateRecords(text, { side: 'B', source: 'x', tags: [], nearbyText: text });
    check('必須修正1(v2.15): buildPropertyCandidateRecords()経由でもoccurrenceIndexが正しく計算される',
      recs[0].interval_semantics_candidates[0].value === 'unknown' &&
      recs[1].interval_semantics_candidates[0].value === 'achieved_point' &&
      recs[1].interval_semantics_candidates[0].confidence === 0.7);
  }

  // ── v2.15: 再レビュー必須修正2の回帰テスト(要求側での共有述語の保持) ──
  {
    const reqText = '定格電源は三相AC 220 V、50 Hzとすること。';
    const records = extractQuantities(reqText);
    const c220 = generateIntervalSemanticsCandidates(records.find(r => r.source_text === '220 V'), { side: 'A', nearbyText: reqText });
    const c50hz = generateIntervalSemanticsCandidates(records.find(r => r.source_text === '50 Hz'), { side: 'A', nearbyText: reqText });
    check('必須修正2(v2.15): 「定格電源は三相AC 220V、50Hzとすること」で220Vが文末の共通述語「とすること」を参照できる(acceptable_region:0.45)',
      c220[0].value === 'acceptable_region' && Math.abs(c220[0].confidence - 0.45) < 1e-9);
    check('必須修正2(v2.15): 同じ要求文で50Hzも同じ確信度になる(要求側は節分割しないため、どちらも全文を参照する)',
      c50hz[0].value === 'acceptable_region' && Math.abs(c50hz[0].confidence - 0.45) < 1e-9);
  }

  // ── v2.16: 摂動テスト(vocabulary_negation_fuzz_test.js)で発見した必須修正の回帰テスト ──
  // 「実測ではない25℃」のように、肯定語の直後に否定表現が続く場合、修正前は確信度0.70で
  // achieved_pointが自動適用の閾値を超えてしまっていた(構文を無視した正規表現一致が原因)。
  {
    const negatedCases = [
      { text: 'これは実測ではない25℃', label: '実測ではない' },
      { text: '試験結果ではない25℃', label: '試験結果ではない' },
      { text: '検討結果ではなく25℃', label: '検討結果ではなく' },
      { text: '実測ではありません25℃', label: '実測ではありません' },
    ];
    negatedCases.forEach(({ text, label }) => {
      const records = extractQuantities(text);
      const target = records.find(r => text.endsWith(r.source_text)) || records[records.length - 1];
      const c = generateIntervalSemanticsCandidates(target, { side: 'B', nearbyText: text });
      check(`必須修正(v2.16): 「${label}」はachieved_pointが自動適用閾値(0.4)を超えない(実際: ${c[0].value} ${c[0].confidence.toFixed(2)})`,
        !(c[0].value === 'achieved_point' && c[0].confidence >= 0.4));
    });
    // 能力キーワードも同じ否定スコープ検出を通す(使用可能/対応可能/運転可能)
    const capText = '使用可能ではない0℃から50℃';
    const capRecords = extractQuantities(capText);
    const capTarget = capRecords.find(r => capText.endsWith(r.source_text)) || capRecords[capRecords.length - 1];
    const capCandidates = generateIntervalSemanticsCandidates(capTarget, { side: 'B', nearbyText: capText });
    check(`必須修正(v2.16): 「使用可能ではない0℃から50℃」はcapability_domainが自動適用閾値を超えない(実際: ${capCandidates[0].value} ${capCandidates[0].confidence.toFixed(2)})`,
      !(capCandidates[0].value === 'capability_domain' && capCandidates[0].confidence >= 0.4));
    // 否定を伴わない場合は、引き続き正しく肯定語として機能することを確認する(回帰防止)
    const positiveText = '実測25℃';
    const posRecords = extractQuantities(positiveText);
    const posTarget = posRecords.find(r => positiveText.endsWith(r.source_text)) || posRecords[posRecords.length - 1];
    const posCandidates = generateIntervalSemanticsCandidates(posTarget, { side: 'B', nearbyText: positiveText });
    check('必須修正(v2.16・回帰防止): 否定を伴わない「実測25℃」は引き続きachieved_point:0.70になる',
      posCandidates[0].value === 'achieved_point' && Math.abs(posCandidates[0].confidence - 0.70) < 1e-9);
  }

  // ── v2.17: JIS Z 8301(規格票の様式及び作成方法)に準拠した要求事項語彙の拡張(8.20節) ──
  {
    const t1 = 'ナイロンコーティング鋼管の使用温度は60℃以下とする。';
    const c1 = generateIntervalSemanticsCandidates(extractQuantities(t1)[0], { side: 'A', nearbyText: t1 });
    check('語彙拡張(v2.17): 「〜以下とする。」(こと無し)がacceptable_regionの強い根拠(0.45)として機能する',
      c1[0].value === 'acceptable_region' && Math.abs(c1[0].confidence - 0.60) < 1e-9);

    const t2 = '工事完成後10日以内に登録申請を行わなければならない15kW。'; // 数量を人工的に含める(語彙検証専用)
    const c2 = generateIntervalSemanticsCandidates(extractQuantities(t2)[0], { side: 'A', nearbyText: t2 });
    check('語彙拡張(v2.17): 「〜なければならない。」もacceptable_regionの根拠として機能する',
      c2[0].value === 'acceptable_region' && c2[0].evidence.some(e => e.type === 'keyword'));

    const t3 = '施工条件は特記による15kW。'; // 「による」は意図的に語彙へ加えていないことの確認
    const c3 = generateIntervalSemanticsCandidates(extractQuantities(t3)[0], { side: 'A', nearbyText: t3 });
    check('語彙拡張(v2.17): 「〜による。」は意図的に未対応のまま(参照表現であり値を規定しないため、根拠にならない)',
      !c3[0].evidence.some(e => e.type === 'keyword'));

    const t4 = '定格電源は三相AC 220 V、50 Hzとすること。'; // v2.15の既存回帰: 「とすること」は従来どおり0.45
    const c4v = generateIntervalSemanticsCandidates(extractQuantities(t4)[0], { side: 'A', nearbyText: t4 });
    check('回帰防止(v2.17): 既存の「〜とすること」(こと有り)は引き続き同じ確信度で機能する(二重加点しない)',
      Math.abs(c4v[0].confidence - 0.45) < 1e-9);
  }

  assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
  const failCount = assertions.filter(a => !a.pass).length;
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);
  // レビュー指摘: 失敗時にも終了コードが0のままだとCIで失敗を見逃す。非ゼロで終了する。
  process.exitCode = failCount > 0 ? 1 : 0;
}
