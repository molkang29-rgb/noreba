import fs from 'fs'
import path from 'path'

const inputPath = path.resolve(
  'data/raw/Toei-TrainTimetable.json'
)

const outputPath = path.resolve(
  'data/processed/trainMeta.json'
)

const data = JSON.parse(
  fs.readFileSync(inputPath, 'utf8')
)

const trainMeta = {}

for (const timetable of data) {
  const trainNumber =
    timetable['odpt:trainNumber'] || ''

  if (!trainNumber) {
    continue
  }

  const trainType =
    timetable['odpt:trainType'] || ''

  const destinationStations =
    timetable['odpt:destinationStation'] || []

  const railDirection =
    timetable['odpt:railDirection'] || ''

  trainMeta[trainNumber] = {
    trainType,
    destinationStations,
    railDirection,
  }
}

fs.mkdirSync(
  path.dirname(outputPath),
  { recursive: true }
)

fs.writeFileSync(
  outputPath,
  JSON.stringify(trainMeta, null, 2),
  'utf8'
)

console.log(
  `열차 메타데이터: ${Object.keys(trainMeta).length}개`
)

console.log(
  `저장: ${outputPath}`
)