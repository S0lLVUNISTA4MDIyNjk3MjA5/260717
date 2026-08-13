#!/usr/bin/env node
/* Knowledge Data Builder alpha 0.1.1 - 中規模評価サンプル生成スクリプト（指示書§10-14）。
 *
 * 目的は性能ストレステストではなく、Node/Relation Candidateが増えたときに
 * 検索・フィルタ・未処理表示・一括操作で「人が実際に触る件数」を減らせるかを
 * 評価すること。単純な行数水増し(同一文のコピー)は行わず、カテゴリごとに
 * 意図的なケース(同義語・略語・表現違い・似た文章で対象部品が異なるNode・
 * タグ不足・タグ未設定・1要求→複数設計項目・複数要求→1設計項目)を作り込む。
 *
 * 出力:
 *   JSON_A_medium_customer_requirements_trace.json (pdf producer, requirement側)
 *   JSON_B_medium_design_review_trace.json          (excel producer, design側)
 *   expected_relations.json                          (ground truth。通常実行の入力ではない)
 *
 * 実行: node samples/knowledge_builder_alpha01/medium/generate_medium_sample.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

// 各カテゴリ: tag(=Knowledge Builder上のtags値)、章/シート内での小節分割(hierarchy深さ確認用)、
// requirement側item、design側item、true relation(1req→複数design、複数req→1designを含む)。
const CATEGORIES = [
  {
    tag: '温度', code: 'temp', sectionTitle: '使用温度条件', sectionNumber: '2.1',
    subs: { use: '使用時温度条件', storage: '保管時温度条件' },
    req: [
      ['use-range', 'use', '空調ユニットは、周囲温度0℃から50℃の環境で正常に運転できること。', ['温度']],
      ['startup', 'use', '低温始動時（0℃以下）でも5分以内に定格能力へ到達すること。', ['温度']],
      ['overheat', 'use', '内部温度が90℃を超えた場合、自動的に運転を停止する保護機能を備えること。', ['温度']],
      ['ambient-derate', 'use', '使用外気温度が45℃を超える場合は能力を段階的に低減してよい。', ['温度']],
      ['sensor-accuracy', 'use', '温度センサの計測精度は±0.5℃以内とすること。', ['温度']],
      ['condensation', 'use', '高温高湿環境（40℃・相対湿度90%）でも結露による誤動作が発生しないこと。', ['温度']],
      ['display', 'use', '運転パネルに現在の周囲温度を表示すること。', ['温度']],
      ['storage-range', 'storage', '未使用時の保管温度は-20℃から60℃の範囲を許容すること。', ['温度']],
    ],
    design: [
      ['use-range', 'use', '使用温度範囲を0℃~50℃に拡張して設計する。上限45℃相当の負荷試験で動作確認済み。', ['温度']],
      ['startup', 'use', '低温起動対策としてクランクケースヒータを追加し、始動後4分で定格能力に到達する設計とする。', ['温度']],
      ['overheat', 'use', '内部温度85℃で警報、95℃で強制停止するサーモスタットを実装する。', ['温度']],
      ['ambient-derate', 'use', '外気温45℃超過時は圧縮機回転数を段階的に絞る出力ディレーティング制御を実装する。', ['温度']],
      ['sensor-accuracy', 'use', '温度センサは精度±0.3℃品を採用し、要求精度に対し十分な余裕を持たせる。', ['温度']],
      ['fin-corrosion', 'use', '熱交換器フィンの表面処理を変更し、温度サイクルによる腐食進行を抑制する。', ['温度']],
      ['log-interval', 'use', '温度ログの記録間隔を10分から1分へ短縮する。', ['温度']],
      ['transport', 'storage', '輸送時温度条件を-30℃~70℃相当まで耐える梱包仕様とする。', ['温度']],
      ['storage-range', 'storage', '保管温度条件は-25℃~65℃とし、輸送時の温度変動を考慮したマージンを確保する。', ['温度']],
      ['notag', 'storage', '外気温センサの配線ルートを見直し、ノイズ耐性を向上する。', []],
    ],
    truePairs: [
      ['use-range', 'use-range'], ['startup', 'startup'], ['overheat', 'overheat'],
      ['ambient-derate', 'ambient-derate'], ['sensor-accuracy', 'sensor-accuracy'], ['storage-range', 'storage-range'],
    ],
  },
  {
    tag: '圧力', code: 'press', sectionTitle: '圧力条件', sectionNumber: '2.2',
    subs: { single: '圧力条件' },
    req: [
      ['water-min', 'single', '給水圧力は0.3MPa以上を確保すること。', ['圧力']],
      ['water-max', 'single', '給水圧力の上限は1.0MPaとし、これを超える場合は減圧弁を設けること。', ['圧力']],
      ['refrigerant-high', 'single', '冷媒高圧側の設計圧力は4.2MPa以上とすること。', ['圧力']],
      ['test-hydro', 'single', '配管の耐圧試験は使用圧力の1.5倍で実施すること。', ['圧力']],
      ['sensor', 'single', '圧力センサの応答時間は100ms以内とすること。', ['圧力']],
      ['relief-valve', 'single', '冷媒回路には設計圧力を超えた場合に作動する安全弁を備えること。', ['圧力']],
      ['drop-alarm', 'single', '圧力低下を検知した場合、5秒以内に警報を出すこと。', ['圧力']],
      ['notag', 'single', '配管接続部からの圧力漏れがないこと。', []],
    ],
    design: [
      ['water-min', 'single', '給水圧力0.3MPa以上で安定動作するようポンプ仕様を選定する。', ['圧力']],
      ['water-max', 'single', '給水圧力1.0MPa超過時に作動する減圧弁をユニット入口に設置する。', ['圧力']],
      ['refrigerant-high', 'single', '冷媒回路の設計圧力を4.5MPaとし、安全率を確保する。', ['圧力']],
      ['test-hydro', 'single', '配管耐圧試験は使用圧力の1.5倍(最大2.25MPa)で実施し、30分間保持する。', ['圧力']],
      ['sensor', 'single', '圧力センサに応答時間80msの高速品を採用する。', ['圧力']],
      ['relief-valve', 'single', '冷媒回路出口に設定圧4.3MPaで開放する安全弁を追加する。', ['圧力']],
      ['gauge-display', 'single', '現地圧力計の表示を従来のアナログからデジタルへ変更する。', ['圧力']],
      ['fitting-torque', 'single', '配管接続部の締付トルク管理値を見直す。', ['圧力']],
      ['pipe-material', 'single', '配管材質をSUS304へ変更する。', ['圧力']],
      ['notag', 'single', '圧力容器の刻印表示レイアウトを変更する。', []],
    ],
    truePairs: [
      ['water-min', 'water-min'], ['water-max', 'water-max'], ['refrigerant-high', 'refrigerant-high'],
      ['test-hydro', 'test-hydro'], ['sensor', 'sensor'], ['relief-valve', 'relief-valve'], ['notag', 'notag'],
    ],
  },
  {
    tag: '電源', code: 'power', sectionTitle: '電源仕様', sectionNumber: '2.3',
    subs: { spec: '電源仕様', protect: '電源保護' },
    req: [
      ['voltage', 'spec', '電源電圧は三相AC200V、周波数50/60Hzに対応すること。', ['電源']],
      ['inrush', 'spec', '始動時の突入電流は定格電流の6倍以内とすること。', ['電源']],
      ['standby', 'spec', '待機時消費電力は5W以下とすること。', ['電源']],
      ['restart', 'spec', '停電復帰後は手動操作なしで自動的に運転を再開すること。', ['電源']],
      // 電源保護のsub: 感電保護とも重なる内容だが本サンプルでは意図的に「電源」タグのみを付与し、
      // 「タグ不足(本来は安全タグも付くべきだが未付与)」の例として扱う(README参照)。
      ['earth', 'protect', '本体は接地端子を備え、D種接地に対応すること。', ['電源']],
      ['leak-breaker', 'protect', '漏電時に0.1秒以内に電源を遮断する漏電遮断器を備えること。', ['電源']],
      ['notag', 'protect', '電源コードの長さは2m以上とすること。', []],
      ['surge', 'protect', '落雷等によるサージから内部回路を保護すること。', ['電源']],
    ],
    design: [
      ['voltage', 'spec', '電源部を三相AC200V/220V、50Hz/60Hz両対応の設計とする。', ['電源']],
      ['inrush', 'spec', '始動回路にソフトスタータを追加し、突入電流を定格の5倍以下に抑制する。', ['電源']],
      ['standby', 'spec', '待機時は制御基板を低消費電力モードへ移行させ、消費電力4.2Wを実測する。', ['電源']],
      ['restart', 'spec', '停電復帰検知後、自己診断を経て自動的に運転を再開するシーケンスを実装する。', ['電源']],
      ['earth', 'protect', '筐体にD種接地端子を設け、接地線は最短経路で配線する。', ['電源']],
      ['leak-breaker', 'protect', '漏電遮断器(定格感度電流30mA、動作時間0.1秒)を電源入力部に実装する。', ['電源']],
      ['notag', 'protect', '電源コードをJIS規格品(長さ2.5m)へ変更する。', []],
      ['cable-length', 'spec', '電源コードの結束方法を見直し、施工性を改善する。', ['電源']],
      ['connector-type', 'protect', '電源コネクタ形状をIEC規格準拠品に統一する。', ['電源']],
      ['fuse-rating', 'protect', '内部ヒューズの定格をB種からC種へ変更する。', ['電源']],
    ],
    truePairs: [
      ['voltage', 'voltage'], ['inrush', 'inrush'], ['standby', 'standby'], ['restart', 'restart'],
      ['earth', 'earth'], ['leak-breaker', 'leak-breaker'], ['notag', 'notag'],
    ],
  },
  {
    tag: '冷房能力', code: 'cooling', sectionTitle: '冷房性能', sectionNumber: '2.4',
    subs: { single: '冷房性能' },
    req: [
      ['capacity', 'single', '定格冷房能力は10kW以上とすること。', ['冷房能力']],
      ['derate', 'single', '周囲温度40℃時でも冷房能力の低下を10%以内に抑えること。', ['冷房能力']],
      ['eer', 'single', 'エネルギー消費効率は3.0以上とすること。', ['冷房能力']],
      ['startup-time', 'single', '起動から定格能力到達までの時間は10分以内とすること。', ['冷房能力']],
      ['airflow', 'single', '冷房運転時の吹出風量は仕様書記載値の±10%以内とすること。', []],
      ['restart', 'single', 'サーモオフ後の再起動までの最小待機時間は3分とすること。', ['冷房能力']],
      ['uniformity', 'single', '吹出し温度分布のばらつきを±2℃以内とすること。', ['冷房能力']],
      ['mode-select', 'single', '除湿優先運転と冷房優先運転を選択できること。', ['冷房能力']],
    ],
    design: [
      ['capacity', 'single', '冷房能力12.5kWを確保する熱交換器・圧縮機構成とする。', ['冷房能力']],
      ['derate', 'single', '周囲温度40℃条件での能力低下を熱交換器大型化により7%に抑制する。', ['冷房能力']],
      // 略語ケース: 要求側は「エネルギー消費効率」と明記するが、設計側は略語(EER)のみを使う。
      ['eer', 'single', '圧縮機効率改善によりEER3.4を達成する設計とする。', ['冷房能力']],
      ['startup-time', 'single', '起動シーケンスを最適化し、定格到達時間8分を実測する。', ['冷房能力']],
      ['airflow', 'single', '吹出風量を仕様値±8%以内に収める送風機設計とする。', []],
      ['restart', 'single', 'サーモオフ復帰後の再起動待機時間を3分に設定する制御とする。', ['冷房能力']],
      ['filter-clog', 'single', 'フィルタ目詰まりによる能力低下を検知する機能を追加する。', ['冷房能力']],
      ['fan-speed', 'single', '室外機ファン回転数の制御ロジックを変更する。', ['冷房能力']],
      ['defrost', 'single', '着霜時の能力低下を制御ロジックで補正する。', ['冷房能力']],
      ['oil-return', 'single', '冷媒油戻り制御ロジックを改善する。', ['冷房能力']],
    ],
    truePairs: [
      ['capacity', 'capacity'], ['derate', 'derate'], ['eer', 'eer'], ['startup-time', 'startup-time'],
      ['airflow', 'airflow'], ['restart', 'restart'],
    ],
  },
  {
    tag: '騒音', code: 'acoustic', sectionTitle: '騒音条件', sectionNumber: '2.5',
    subs: { single: '騒音条件' },
    req: [
      ['overall', 'single', '定格運転時の騒音値は50dB(A)以下とすること。', ['騒音']],
      // 似た文章だが対象部品が異なる2件: bearing / fanmotor。安易な文字列類似度だけでは
      // 取り違えないかを確認する狙い。
      ['bearing', 'single', '軸受部から異音が発生しないこと。', ['騒音']],
      ['fanmotor', 'single', 'ファンモーターから異音が発生しないこと。', ['騒音']],
      ['lowspeed', 'single', '低速運転時の騒音値は40dB(A)以下とすること。', ['騒音']],
      ['notag', 'single', '夜間運転モードでは騒音をさらに抑制すること。', []],
      ['vibration-mount', 'single', '設置架台への振動伝達を抑制し、共振による異音を防止すること。', ['騒音']],
      ['compressor', 'single', '圧縮機本体からの振動起因騒音を抑制すること。', ['騒音']],
      ['duct', 'single', 'ダクト接続部からの風切り音が発生しないこと。', ['騒音']],
    ],
    design: [
      ['overall', 'single', '遮音材の追加により定格運転時騒音48dB(A)を実測する。', ['騒音']],
      ['bearing', 'single', '軸受部にセラミックベアリングを採用し、異音発生を防止する。', ['騒音']],
      ['fanmotor', 'single', 'ファンモーターをDCブラシレス化し、異音発生を防止する。', ['騒音']],
      ['lowspeed', 'single', '低速運転モードでの騒音を37dB(A)に低減する制御を追加する。', ['騒音']],
      ['notag', 'single', '夜間静音モードでファン回転数を20%低減する制御を追加する。', []],
      ['vibration-mount', 'single', '防振ゴムマウントを追加し、架台への振動伝達を抑制する。', ['騒音']],
      ['enclosure', 'single', '防音カバーの形状を最適化する。', ['騒音']],
      ['motor-brand', 'single', 'ファンモーターのメーカーを変更する。', ['騒音']],
      ['test-method', 'single', '騒音測定方法をJIS B 8616準拠に統一する。', ['騒音']],
      ['panel-thickness', 'single', '外装パネル厚みを1.2mmへ変更する。', ['騒音']],
    ],
    truePairs: [
      ['overall', 'overall'], ['bearing', 'bearing'], ['fanmotor', 'fanmotor'],
      ['lowspeed', 'lowspeed'], ['notag', 'notag'], ['vibration-mount', 'vibration-mount'],
    ],
  },
  {
    tag: '質量', code: 'mass', sectionTitle: '質量条件', sectionNumber: '2.6',
    subs: { single: '質量条件' },
    req: [
      ['total', 'single', '本体質量は120kg以下とすること。', ['質量']],
      ['notag', 'single', '梱包時の総質量は140kg以下とすること。', []],
      ['component-split', 'single', '設置作業性のため、主要ユニットを2分割搬入可能な構造とすること。', ['質量']],
      ['frame-material', 'single', '強度を確保しつつ質量を抑えるため、主要フレームにアルミ合金を採用してよい。', ['質量']],
      ['label', 'single', '製品質量を銘板に明記すること。', ['質量']],
      ['per-person-lift', 'single', '50kgを超える部品は2人以上での運搬を前提とした形状とすること。', ['質量']],
      ['transport-limit', 'single', '輸送車両の積載制限を考慮し、最大質量は200kgを超えないこと。', ['質量']],
      ['pallet', 'single', 'パレット梱包時の総質量は180kg以下とすること。', ['質量']],
    ],
    design: [
      ['total', 'single', '軽量化設計により本体質量115kgを実現する。', ['質量']],
      ['notag', 'single', '梱包時総質量135kgを実測する。', []],
      ['component-split', 'single', '本体を室内機・室外機の2分割搬入構造とする。', ['質量']],
      ['frame-material', 'single', '主要フレーム材質をスチールからアルミ合金へ変更し軽量化する。', ['質量']],
      ['label', 'single', '銘板表示項目に製品質量(kg)を追加する。', ['質量']],
      ['packaging', 'single', '梱包材をダンボールから発泡材へ変更する。', ['質量']],
      ['bracket', 'single', '取付ブラケットの板厚を変更する。', ['質量']],
      ['caster', 'single', '移動用キャスターを追加する。', ['質量']],
      ['balance', 'single', '重心バランスを見直し転倒しにくい形状とする。', ['質量']],
      ['spec-sheet', 'single', '質量値の仕様書記載単位をkgからlbへ換算併記する。', ['質量']],
    ],
    truePairs: [
      ['total', 'total'], ['notag', 'notag'], ['component-split', 'component-split'],
      ['frame-material', 'frame-material'], ['label', 'label'],
    ],
  },
  {
    tag: '寸法', code: 'dims', sectionTitle: '外形寸法', sectionNumber: '2.7',
    subs: { outer: '外形寸法', connect: '接続部寸法' },
    req: [
      ['envelope', 'outer', '設置スペースは幅800mm×奥行600mm×高さ1200mm以内とすること。', ['寸法']],
      ['height-limit', 'outer', '天井高2400mm以下の部屋にも設置可能な高さとすること。', ['寸法']],
      ['weight-per-area', 'outer', '床への荷重は500kg/m²以下とすること。', ['寸法']],
      ['service-space', 'outer', '保守点検のための前面クリアランス600mm以上を確保すること。', ['寸法']],
      ['notag', 'connect', '配管接続口の位置は背面下部とすること。', []],
      ['duct-connect', 'connect', 'ダクト接続口の寸法は規格化された角形ダクトサイズに適合すること。', ['寸法']],
      ['door-clear', 'connect', '点検扉の開閉に必要な前面クリアランスを500mm以上確保すること。', ['寸法']],
      ['cable-entry', 'connect', '電源ケーブル引込口の寸法はφ30mm以上とすること。', ['寸法']],
    ],
    design: [
      ['envelope', 'outer', '外形寸法を幅780mm×奥行590mm×高さ1180mmに収める設計とする。', ['寸法']],
      ['clearance', 'outer', '背面保守スペースを500mmに変更する。', ['寸法']],
      ['panel-gap', 'outer', '外装パネルの合わせ目隙間を1mm以下に管理する。', ['寸法']],
      ['base-frame', 'outer', '基礎ボルト穴ピッチを変更する。', ['寸法']],
      ['tolerance', 'outer', '外形寸法公差を±5mmから±3mmへ厳格化する。', ['寸法']],
      ['notag', 'connect', '配管接続口を背面下部に配置する。', []],
      ['duct-connect', 'connect', 'ダクト接続口を角形ダクト規格(JIS準拠)寸法に合わせる。', ['寸法']],
      ['door-clear', 'connect', '点検扉開閉クリアランスを520mmとする配置設計とする。', ['寸法']],
      ['cable-entry', 'connect', 'ケーブル引込口をφ34mmに拡大する。', ['寸法']],
      ['label-position', 'connect', '銘板取付位置を側面上部に変更する。', ['寸法']],
    ],
    truePairs: [
      ['envelope', 'envelope'], ['notag', 'notag'], ['duct-connect', 'duct-connect'],
      ['door-clear', 'door-clear'], ['cable-entry', 'cable-entry'],
    ],
  },
  {
    tag: '保守', code: 'maint', sectionTitle: '保守性', sectionNumber: '2.8',
    subs: { single: '保守性' },
    req: [
      ['interval', 'single', '定期保守の推奨間隔は6か月とすること。', ['保守']],
      ['filter-access', 'single', 'フィルタ交換は工具なしで実施できること。', ['保守']],
      // 同義語ケース: 「保守」と「メンテナンス」。
      ['tool-free', 'single', 'メンテナンス時、主要消耗部品の交換に特殊工具を必要としないこと。', ['保守']],
      ['notag', 'single', '点検口には施錠機構を設けること。', []],
      ['spare-parts', 'single', '主要消耗部品は市販工具で入手可能な標準品を使用すること。', ['保守']],
      ['log', 'single', '保守履歴を機器内に記録・保持できること。', ['保守']],
      ['training', 'single', '保守員向けの標準作業手順書を整備すること。', ['保守']],
      ['warranty', 'single', '初回保守は無償点検として実施すること。', ['保守']],
    ],
    design: [
      ['interval', 'single', '推奨定期メンテナンス間隔を6か月に設定し、取扱説明書へ明記する。', ['保守']],
      ['filter-access', 'single', 'フィルタを工具レスで着脱できるスライド構造とする。', ['保守']],
      ['tool-free', 'single', '主要消耗部品(フィルタ・ベルト)をすべて工具レスで交換できる構造に統一する。', ['保守']],
      ['notag', 'single', '点検口カバーにシリンダー錠を追加する。', []],
      ['spare-parts', 'single', '消耗部品を市販標準品(ベルト・フィルタ)へ統一する。', ['保守']],
      ['log', 'single', '制御基板に保守履歴(実施日・作業内容)を記録するログ機能を追加する。', ['保守']],
      ['checklist', 'single', '定期点検チェックリストの様式を改訂する。', ['保守']],
      ['manual-format', 'single', '取扱説明書のページ構成を刷新する。', ['保守']],
      ['remote-diag', 'single', 'リモート診断機能を追加する。', ['保守']],
      ['color-code', 'single', '保守用配線の色分けルールを統一する。', ['保守']],
    ],
    truePairs: [
      ['interval', 'interval'], ['filter-access', 'filter-access'], ['tool-free', 'tool-free'],
      ['notag', 'notag'], ['spare-parts', 'spare-parts'], ['log', 'log'],
    ],
  },
  {
    tag: '安全', code: 'safety', sectionTitle: '安全対策', sectionNumber: '2.9',
    subs: { shock: '感電・火災対策', physical: '物理安全' },
    req: [
      // 1要求→複数設計項目の例: electric-shockは2つの設計項目(接地・漏電遮断器)で満たされる。
      ['electric-shock', 'shock', '感電保護のため、充電部への接触を防止すること。', ['安全']],
      ['fire-retardant', 'shock', '主要樹脂部品は難燃性材料(UL94 V-0相当)を使用すること。', ['安全']],
      ['warning-label', 'shock', '感電・高温部に対する警告表示を視認しやすい位置に設けること。', ['安全']],
      ['notag', 'shock', '非常停止操作後、再起動には手動操作を要すること。', []],
      ['sharp-edge', 'physical', '外装に鋭利な突起・エッジがないこと。', ['安全']],
      ['tipping', 'physical', '転倒防止のため、重心位置及び設置面積から転倒しにくい構造とすること。', ['安全']],
      ['lockout', 'physical', '保守作業時に電源を確実に遮断できるロックアウト機構を備えること。', ['安全']],
      ['ip-rating', 'physical', '屋外設置部は保護等級IP24相当を満たすこと。', ['安全']],
    ],
    design: [
      ['enclosure-grounding', 'shock', '充電部を樹脂カバーで隔離し、金属筐体は全てD種接地する。', ['安全']],
      ['leak-current-breaker', 'shock', '漏電時に遮断する専用ブレーカーを電源入力部に追加する。', ['安全']],
      ['material-v0', 'shock', '主要樹脂部品をUL94 V-0認証材料へ変更する。', ['安全']],
      ['label', 'shock', '警告ラベルのデザインを国際規格ピクトグラムへ統一する。', ['安全']],
      ['restart-lock', 'shock', '非常停止解除後は手動リセットボタンを押すまで再起動しない回路とする。', ['安全']],
      ['edge-radius', 'physical', '外装パネルの角部を全てR2以上の面取り形状とする。', ['安全']],
      ['tipping-stability', 'physical', '設置脚の配置を見直し転倒に対する安定性を向上する。', ['安全']],
      ['interlock', 'physical', '扉開放時に運転を停止するインターロックスイッチを追加する。', ['安全']],
      ['color', 'physical', '非常停止ボタンの色を規格色(赤/黄)に統一する。', ['安全']],
      ['cover-material', 'shock', '充電部カバーの材質を金属から樹脂へ変更する。', ['安全']],
    ],
    truePairs: [
      ['electric-shock', 'enclosure-grounding'], ['electric-shock', 'leak-current-breaker'],
      ['fire-retardant', 'material-v0'], ['warning-label', 'label'], ['notag', 'restart-lock'],
      ['sharp-edge', 'edge-radius'], ['tipping', 'tipping-stability'], ['lockout', 'interlock'],
    ],
  },
  {
    tag: '試験', code: 'test', sectionTitle: '検査・試験', sectionNumber: '2.10',
    subs: { shipping: '出荷検査', durability: '環境・耐久試験' },
    req: [
      // 複数要求→1設計項目の例: final-inspection-electric/leakはどちらも同じ設計項目(出荷前全数検査手順)で満たされる。
      ['final-inspection-electric', 'shipping', '出荷前検査として、絶縁抵抗試験を全数実施すること。', ['試験']],
      ['final-inspection-leak', 'shipping', '出荷前検査として、気密試験（冷媒回路）を全数実施すること。', ['試験']],
      ['notag', 'shipping', '試験成績書を出荷時に添付すること。', []],
      ['vibration', 'durability', '輸送を想定した振動試験を実施すること。', ['試験']],
      ['emc', 'durability', '電磁両立性(EMC)試験（放射妨害波・イミュニティ）を実施すること。', ['試験']],
      ['durability', 'durability', '10年相当の耐久性を想定した加速寿命試験を実施すること。', ['試験']],
      ['humidity', 'durability', '高湿度環境での絶縁性能試験を実施すること。', ['試験']],
      ['drop', 'durability', '梱包状態での落下試験を実施すること。', ['試験']],
    ],
    design: [
      ['final-inspection-procedure', 'shipping', '出荷前全数検査手順に絶縁抵抗測定と冷媒回路気密試験を組み込む。', ['試験']],
      ['notag', 'shipping', '出荷時に試験成績書PDFを同梱する。', []],
      ['vibration', 'durability', 'JIS Z 0232準拠の振動試験を量産初号機で実施する。', ['試験']],
      ['emc', 'durability', 'EMC試験(CISPR規格準拠)を型式ごとに実施する。', ['試験']],
      ['durability', 'durability', '圧縮機の加速寿命試験により10年相当の耐久性を確認する。', ['試験']],
      ['report-template', 'shipping', '試験成績書のフォーマットをデジタル化する。', ['試験']],
      ['sample-size', 'shipping', '抜取検査のサンプルサイズを見直す。', ['試験']],
      ['jig', 'durability', '試験治具を新規製作する。', ['試験']],
      ['record-retention', 'shipping', '試験記録の保管期間を5年から7年へ延長する。', ['試験']],
      ['calibration', 'durability', '測定器の校正周期を1年から6か月へ短縮する。', ['試験']],
    ],
    truePairs: [
      ['final-inspection-electric', 'final-inspection-procedure'], ['final-inspection-leak', 'final-inspection-procedure'],
      ['notag', 'notag'], ['vibration', 'vibration'], ['emc', 'emc'], ['durability', 'durability'],
    ],
  },
];

function buildTraceA() {
  const records = [];
  for (const cat of CATEGORIES) {
    for (const [slug, sub, text, tags] of cat.req) {
      const traceId = `req-${cat.code}-${slug}`;
      const sectionId = `sec-${cat.code}-${sub}`;
      const sectionTitle = cat.subs[sub] || cat.sectionTitle;
      records.push({
        trace_id: traceId,
        parent_id: sectionId,
        trace_title: sectionTitle,
        trace_text: text,
        trace_content: [text],
        trace_category: cat.tag,
        trace_key_text: `要求仕様 ${cat.sectionNumber} ${sectionTitle} ${text}`,
        chapter_number: '第2章',
        chapter_title: '要求仕様',
        section_number: cat.sectionNumber,
        section_title: sectionTitle,
        block_type: 'text',
        source_file: 'customer_requirements_medium.pdf',
        source_page: 1,
        source_path: `$.sections[?(@.id=='${sectionId}')].content[?(@.id=='${traceId}')]`,
        source_kind: 'section_text',
        source_section_id: sectionId,
        source_section_title: sectionTitle,
        source_block_id: `block-${traceId}`,
        source_raw_text: text,
        review_status: 'reviewed',
        tags: tags,
        unregistered_tags: [],
      });
    }
  }
  return {
    file_name: 'customer_requirements_medium.pdf',
    trace_format: 'chapter-section-trace-v1',
    schema_version: '2.0-work',
    chapter_number: '第2章',
    chapter_title: '要求仕様（中規模評価サンプル）',
    source: { profile_name: 'knowledge-builder-medium-sample' },
    tag_policy: { vocabulary_id: 'knowledge-builder-medium-sample', tag_vocabulary_version: '1.0.0' },
    _trace_records: records,
  };
}

function buildTraceB() {
  const records = [];
  for (const cat of CATEGORIES) {
    for (const [slug, sub, text, tags] of cat.design) {
      const traceId = `design-${cat.code}-${slug}`;
      const sectionId = `sheet-${cat.code}-${sub}`;
      const sectionTitle = cat.subs[sub] || cat.sectionTitle;
      records.push({
        trace_id: traceId,
        parent_id: sectionId,
        trace_title: sectionTitle,
        trace_text: text,
        trace_content: [text],
        trace_category: cat.tag,
        trace_key_text: `設計検討表 ${sectionTitle} ${text}`,
        source_file: 'design_review_medium.xlsx',
        source_sheet: sectionTitle,
        source_row: records.length + 2,
        source_path: `$._trace_records[${records.length}]`,
        source_section_id: sectionId,
        source_section_title: sectionTitle,
        block_type: 'excel_row',
        review_status: 'reviewed',
        tags: tags,
        unregistered_tags: [],
        source_record: {
          No: records.length + 1,
          分類: cat.tag,
          項目: sectionTitle,
          内容: text,
          備考: '',
          review_status: 'reviewed',
          tags: tags,
          unregistered_tags: [],
          ai_reviewed: false,
          ai_reviewed_at: '',
          ai_review_method: '',
          ai_review_model: '',
          ai_review_comment: '',
          _source: { file_name: 'design_review_medium.xlsx', sheet_name: sectionTitle, excel_row: records.length + 2 },
        },
      });
    }
  }
  return {
    file_name: 'design_review_medium.xlsx',
    trace_format: 'chapter-section-trace-v1',
    schema_version: '2.0-work',
    chapter_number: 'TRACE',
    chapter_title: '設計検討表（中規模評価サンプル）',
    source: { profile_name: 'knowledge-builder-medium-sample' },
    tag_policy: { vocabulary_id: 'knowledge-builder-medium-sample', tag_vocabulary_version: '1.0.0' },
    _trace_records: records,
  };
}

function buildExpectedRelations() {
  const relations = [];
  for (const cat of CATEGORIES) {
    for (const [reqSlug, designSlug] of cat.truePairs) {
      relations.push({
        category: cat.tag,
        requirement_trace_id: `req-${cat.code}-${reqSlug}`,
        design_trace_id: `design-${cat.code}-${designSlug}`,
        note: reqSlug === 'notag' || designSlug === 'notag' ? 'tags未設定同士の関連(タグに頼らない一致確認用)' : undefined,
      });
    }
  }
  return {
    schema: 'knowledge-builder-expected-relations/1.0',
    purpose:
      '評価終了後にCandidate生成結果・採用Edgeと照合するためのground truth。通常のKnowledge Builder ' +
      '実行に必須の入力ファイルではない(読み込ませる必要はない)。False Positive/False Negativeの確認に用いる。',
    generated_by: 'samples/knowledge_builder_alpha01/medium/generate_medium_sample.js',
    total_true_relations: relations.length,
    relations,
  };
}

function main() {
  const outDir = __dirname;
  const traceA = buildTraceA();
  const traceB = buildTraceB();
  const expected = buildExpectedRelations();

  fs.writeFileSync(path.join(outDir, 'JSON_A_medium_customer_requirements_trace.json'), JSON.stringify(traceA, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'JSON_B_medium_design_review_trace.json'), JSON.stringify(traceB, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'expected_relations.json'), JSON.stringify(expected, null, 2) + '\n', 'utf8');

  console.log(`JSON_A requirement nodes: ${traceA._trace_records.length}`);
  console.log(`JSON_B design nodes: ${traceB._trace_records.length}`);
  console.log(`expected true relations: ${expected.relations.length}`);
  console.log(`unique JSON_A sections: ${new Set(traceA._trace_records.map(r => r.source_section_id)).size}`);
  console.log(`unique JSON_B sections: ${new Set(traceB._trace_records.map(r => r.source_section_id)).size}`);
}

main();
