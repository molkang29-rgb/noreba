import processedStations from '../data/processed/stations.json'
const lineInfo = {
  '1': {
    name: '도에이 아사쿠사선',
    code: 'A',
    color: '#EC6E65',
  },
  '2': {
    name: '도에이 미타선',
    code: 'I',
    color: '#006CB6',
  },
  '3': {
    name: '도에이 신주쿠선',
    code: 'S',
    color: '#B0C124',
  },
  '4': {
    name: '도에이 오에도선',
    code: 'E',
    color: '#CE045B',
  },
}

const stations = processedStations.map(
  (station) => ({
    id: station.id,

    name:
      station.korean ||
      station.name,

    japanese:
      station.japanese ||
      station.name,

    romanized:
      station.romanized || '',

    korean:
      station.korean || '',

    lines:
  (station.lines || [])
    .map((lineId) => lineInfo[String(lineId)])
    .filter(Boolean),
  })
)

export default stations