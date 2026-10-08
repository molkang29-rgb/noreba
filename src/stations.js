import processedStations from '../data/processed/stations.json'

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
      station.lines || [],
  })
)

export default stations