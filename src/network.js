const network = {
  shinjuku: [
    // 경로 1: 가장 빠른 직통
    {
      to: 'shibuya',
      lineId: 'jr-yamanote',
      duration: 7,
      fare: 180,
    },

    // 경로 2: 우회 경로
    {
      to: 'ikebukuro',
      lineId: 'jr-yamanote',
      duration: 9,
      fare: 100,
    },

    // 경로 3: 다른 노선으로 이동
    {
      to: 'koenji',
      lineId: 'jr-chuo',
      duration: 6,
      fare: 80,
    },
  ],

  ikebukuro: [
    {
      to: 'shibuya',
      lineId: 'jr-yamanote',
      duration: 9,
      fare: 100,
    },
  ],

  koenji: [
    {
      to: 'shibuya',
      lineId: 'tokyu-toyoko',
      duration: 20,
      fare: 70,
    },
  ],

  shibuya: [
    {
      to: 'shinjuku',
      lineId: 'jr-yamanote',
      duration: 7,
      fare: 180,
    },
  ],
}

export default network