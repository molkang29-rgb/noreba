import fs from 'fs'
import path from 'path'

const dataDir = path.resolve('data/processed')

function readJson(filename) {
  const filePath = path.join(dataDir, filename)

  if (!fs.existsSync(filePath)) {
    console.log(`❌ ${filename} 없음`)
    return null
  }

  return JSON.parse(
    fs.readFileSync(filePath, 'utf8')
  )
}

function show(filename, data) {
  console.log('')
  console.log('====================================')
  console.log(filename)
  console.log('====================================')

  if (!data) return

  if (Array.isArray(data)) {
    console.log(`총 ${data.length}개`)
    console.log('')
    console.log(
      JSON.stringify(data.slice(0, 3), null, 2)
    )
  } else {
    console.log(
      JSON.stringify(data, null, 2).slice(0, 5000)
    )
  }
}

show('stations.json', readJson('stations.json'))
show('lines.json', readJson('lines.json'))

const trips = readJson('trips.json')

console.log('')
console.log('====================================')
console.log('trips.json')
console.log('====================================')

if (trips) {
  console.log(`총 ${trips.length}개`)
  console.log('')

  for (const trip of trips.slice(0, 2)) {
    console.log(
      JSON.stringify(trip, null, 2).slice(0, 6000)
    )
    console.log('')
  }
}

show('fares.json', readJson('fares.json'))
show('services.json', readJson('services.json'))