import processedStations from '../data/processed/stations.json'
import processedLines from '../data/processed/lines.json'

const lineInfo = new Map(
  processedLines.map((line) => [
    String(line.id),
    {
      name: line.name || line.longName || '철도 노선',
      japanese: line.longName || line.name || '',
      code: line.code || line.shortName || '●',
      color: line.color || '#666666',
    },
  ])
)

const stations = processedStations.map((station) => ({
  id: station.id,
  name: station.korean || station.name,
  japanese: station.japanese || station.name,
  romanized: station.romanized || '',
  korean: station.korean || '',
  lines: (station.lines || [])
    .map((lineId) => lineInfo.get(String(lineId)))
    .filter(Boolean),
}))

export default stations
