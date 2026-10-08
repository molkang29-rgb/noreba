import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import { parse } from 'csv-parse/sync'

const inputDir = path.resolve('data/raw')
const outputDir = path.resolve('data/processed')

fs.mkdirSync(outputDir, { recursive: true })

const zipFiles = fs
  .readdirSync(inputDir)
  .filter((file) => file.toLowerCase().endsWith('.zip'))

if (zipFiles.length === 0) {
  console.log('GTFS ZIP 파일을 찾지 못했습니다.')
  console.log('data/raw 폴더에 GTFS ZIP 파일을 넣어주세요.')
  process.exit(0)
}

const zipPath = path.join(inputDir, zipFiles[0])

console.log(`GTFS 파일: ${zipFiles[0]}`)

const zip = new AdmZip(zipPath)

function readCsv(filename) {
  const entry = zip.getEntry(filename)

  if (!entry) {
    console.log(`${filename} 없음`)
    return []
  }

  const text = entry.getData().toString('utf8')

  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  })
}

const stops = readCsv('stops.txt')
const routes = readCsv('routes.txt')
const trips = readCsv('trips.txt')
const stopTimes = readCsv('stop_times.txt')
const transfers = readCsv('transfers.txt')

console.log('')
console.log(`역/정류장: ${stops.length}`)
console.log(`노선: ${routes.length}`)
console.log(`운행편: ${trips.length}`)
console.log(`정차 정보: ${stopTimes.length}`)
console.log(`환승 정보: ${transfers.length}`)

const result = {
  meta: {
    source: zipFiles[0],
    generatedAt: new Date().toISOString(),
  },

  stops,
  routes,
  trips,
  stopTimes,
  transfers,
}

const outputPath = path.join(
  outputDir,
  'gtfs-raw.json'
)

fs.writeFileSync(
  outputPath,
  JSON.stringify(result, null, 2),
  'utf8'
)

console.log('')
console.log('변환 완료!')
console.log(`저장 위치: ${outputPath}`)