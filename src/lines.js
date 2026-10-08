const lines = {
  // =========================
  // JR East
  // =========================

  'jr-yamanote': {
    name: 'JR 야마노테선',
    japanese: 'JR山手線',
    color: '#9ACD32',
    operator: 'JR East',
  },

  'jr-chuo': {
    name: 'JR 주오선',
    japanese: 'JR中央線',
    color: '#FF4500',
    operator: 'JR East',
  },

  'jr-chuo-sobu': {
    name: 'JR 주오·소부선',
    japanese: 'JR中央・総武線',
    color: '#FFD700',
    operator: 'JR East',
  },

  'jr-keihin-tohoku': {
    name: 'JR 게이힌도호쿠선',
    japanese: 'JR京浜東北線',
    color: '#00BFFF',
    operator: 'JR East',
  },

  'jr-saikyo': {
    name: 'JR 사이쿄선',
    japanese: 'JR埼京線',
    color: '#2E8B57',
    operator: 'JR East',
  },

  'jr-shonan-shinjuku': {
    name: 'JR 쇼난신주쿠라인',
    japanese: 'JR湘南新宿ライン',
    color: '#FF0000',
    operator: 'JR East',
  },

  'jr-yokohama': {
    name: 'JR 요코하마선',
    japanese: 'JR横浜線',
    color: '#9ACD32',
    operator: 'JR East',
  },

  'jr-ueno-tokyo': {
    name: 'JR 우에노도쿄라인',
    japanese: 'JR上野東京ライン',
    color: '#91268F',
    operator: 'JR East',
  },

  // =========================
  // Tokyo Metro
  // =========================

  'tokyo-metro-ginza': {
    name: '도쿄메트로 긴자선',
    japanese: '東京メトロ銀座線',
    color: '#FF9500',
    operator: 'Tokyo Metro',
  },

  'tokyo-metro-marunouchi': {
    name: '도쿄메트로 마루노우치선',
    japanese: '東京メトロ丸ノ内線',
    color: '#F62E36',
    operator: 'Tokyo Metro',
  },

  'tokyo-metro-hibiya': {
    name: '도쿄메트로 히비야선',
    japanese: '東京メトロ日比谷線',
    color: '#B5B5AC',
    operator: 'Tokyo Metro',
  },

  'tokyo-metro-tozai': {
    name: '도쿄메트로 도자이선',
    japanese: '東京メトロ東西線',
    color: '#009BBF',
    operator: 'Tokyo Metro',
  },

  'tokyo-metro-chiyoda': {
    name: '도쿄메트로 치요다선',
    japanese: '東京メトロ千代田線',
    color: '#00BB85',
    operator: 'Tokyo Metro',
  },

  'tokyo-metro-yurakucho': {
    name: '도쿄메트로 유라쿠초선',
    japanese: '東京メトロ有楽町線',
    color: '#C1A470',
    operator: 'Tokyo Metro',
  },

  'tokyo-metro-hanzomon': {
    name: '도쿄메트로 한조몬선',
    japanese: '東京メトロ半蔵門線',
    color: '#8F76D6',
    operator: 'Tokyo Metro',
  },

  'tokyo-metro-namboku': {
    name: '도쿄메트로 난보쿠선',
    japanese: '東京メトロ南北線',
    color: '#00AC9B',
    operator: 'Tokyo Metro',
  },

  'tokyo-metro-fukutoshin': {
    name: '도쿄메트로 후쿠토신선',
    japanese: '東京メトロ副都心線',
    color: '#9C5E31',
    operator: 'Tokyo Metro',
  },

  // =========================
  // Toei Subway
  // =========================

  'toei-asakusa': {
    name: '도에이 아사쿠사선',
    japanese: '都営浅草線',
    color: '#EC6E65',
    operator: 'Toei',
  },

  'toei-mita': {
    name: '도에이 미타선',
    japanese: '都営三田線',
    color: '#006CB6',
    operator: 'Toei',
  },

  'toei-shinjuku': {
    name: '도에이 신주쿠선',
    japanese: '都営新宿線',
    color: '#B0C124',
    operator: 'Toei',
  },

  'toei-oedo': {
    name: '도에이 오에도선',
    japanese: '都営大江戸線',
    color: '#CE045B',
    operator: 'Toei',
  },

  // =========================
  // Tokyu
  // =========================

  'tokyu-toyoko': {
    name: '도큐 도요코선',
    japanese: '東急東横線',
    color: '#DA0042',
    operator: 'Tokyu',
  },

  'tokyu-denentoshi': {
    name: '도큐 덴엔토시선',
    japanese: '東急田園都市線',
    color: '#20A288',
    operator: 'Tokyu',
  },

  'tokyu-ooimachi': {
    name: '도큐 오이마치선',
    japanese: '東急大井町線',
    color: '#F18C43',
    operator: 'Tokyu',
  },

  // =========================
  // Odakyu
  // =========================

  'odakyu-odawara': {
    name: '오다큐 오다와라선',
    japanese: '小田急小田原線',
    color: '#2683CE',
    operator: 'Odakyu',
  },

  'odakyu-tama': {
    name: '오다큐 다마선',
    japanese: '小田急多摩線',
    color: '#2683CE',
    operator: 'Odakyu',
  },

  // =========================
  // Keio
  // =========================

  'keio-main': {
    name: '게이오선',
    japanese: '京王線',
    color: '#E3379F',
    operator: 'Keio',
  },

  'keio-inokashira': {
    name: '게이오 이노카시라선',
    japanese: '京王井の頭線',
    color: '#1A407B',
    operator: 'Keio',
  },

  // =========================
  // Seibu
  // =========================

  'seibu-shinjuku': {
    name: '세이부 신주쿠선',
    japanese: '西武新宿線',
    color: '#00A6BF',
    operator: 'Seibu',
  },

  'seibu-ikebukuro': {
    name: '세이부 이케부쿠로선',
    japanese: '西武池袋線',
    color: '#ED772D',
    operator: 'Seibu',
  },

  // =========================
  // Tobu
  // =========================

  'tobu-tojo': {
    name: '도부 도조선',
    japanese: '東武東上線',
    color: '#004098',
    operator: 'Tobu',
  },

  'tobu-skytree': {
    name: '도부 스카이트리라인',
    japanese: '東武スカイツリーライン',
    color: '#005AAA',
    operator: 'Tobu',
  },

  // =========================
  // Keisei
  // =========================

  'keisei-main': {
    name: '게이세이 본선',
    japanese: '京成本線',
    color: '#005AAA',
    operator: 'Keisei',
  },
}

export default lines