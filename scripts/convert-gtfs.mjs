import fs from 'fs'
import path from 'path'
import stationKorean from '../data/station-korean.json' with { type: 'json' }
const trainMetaPath = path.resolve(
  'data/processed/trainMeta.json'
)

const trainMeta = fs.existsSync(trainMetaPath)
  ? JSON.parse(
      fs.readFileSync(trainMetaPath, 'utf8')
    )
  : {}
import AdmZip from 'adm-zip'
import { parse } from 'csv-parse/sync'

const inputDir = path.resolve('data/raw')
const outputDir = path.resolve('data/processed')

fs.mkdirSync(outputDir, { recursive: true })

const zipFiles = fs
  .readdirSync(inputDir)
  .filter((file) => file.toLowerCase().endsWith('.zip'))
  .sort()

if (zipFiles.length === 0) {
  console.log('GTFS ZIP 파일을 찾지 못했습니다.')
  console.log('data/raw 폴더에 GTFS ZIP 파일을 넣어주세요.')
  process.exit(0)
}

const requestedZip = process.env.GTFS_ZIP
const preferredZip = requestedZip
  ? path.resolve(requestedZip)
  : path.join(inputDir, zipFiles.find((file) => /^Toei-Train-GTFS\.zip$/i.test(file)) || zipFiles[0])
const zipPath = preferredZip

if (!fs.existsSync(zipPath)) {
  throw new Error(`GTFS ZIP 파일을 찾지 못했습니다: ${zipPath}`)
}

console.log(`GTFS 파일: ${path.basename(zipPath)}`)

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

const agency = readCsv('agency.txt')
const calendar = readCsv('calendar.txt')
const calendarDates = readCsv('calendar_dates.txt')
const fareAttributes = readCsv('fare_attributes.txt')
const fareRules = readCsv('fare_rules.txt')
const feedInfo = readCsv('feed_info.txt')
const routes = readCsv('routes.txt')
const stops = readCsv('stops.txt')
const stopTimes = readCsv('stop_times.txt')
const trips = readCsv('trips.txt')
const untimedStopTimes = stopTimes.filter((item) => !item.arrival_time || !item.departure_time)
const untimedServiceableStops = untimedStopTimes.filter((item) =>
  (item.pickup_type || '0') !== '1' || (item.drop_off_type || '0') !== '1'
)
if (untimedServiceableStops.length) {
  throw new Error(`GTFS stop_times에 승차 또는 하차가 허용되지만 시각이 비어 있는 기록이 ${untimedServiceableStops.length}건 있습니다.`)
}
const translations = readCsv('translations.txt')

console.log('')
console.log(`역/정류장: ${stops.length}`)
console.log(`노선: ${routes.length}`)
console.log(`운행편: ${trips.length}`)
console.log(`정차 정보: ${stopTimes.length}`)
console.log(`운임 속성: ${fareAttributes.length}`)
console.log(`운임 규칙: ${fareRules.length}`)
console.log(`번역 데이터: ${translations.length}`)

/*
 * ------------------------------------------------------------
 * 1. 역 데이터
 * ------------------------------------------------------------
 */

const stationMap = new Map()

for (const stop of stops) {
  // parent_station이 있으면 실제 역 단위를 우선 사용
  const stationId = stop.parent_station || stop.stop_id

  if (!stationMap.has(stationId)) {
    stationMap.set(stationId, {
      id: stationId,
      name: stop.stop_name || '',
      code: stop.stop_code || '',
      lat: Number(stop.stop_lat) || null,
      lon: Number(stop.stop_lon) || null,
      parentStation: stop.parent_station || '',
      platformCount: 0,
    })
  }

  const station = stationMap.get(stationId)

  if (stop.parent_station) {
    station.platformCount += 1
  }
}
const stationEnglishMap = new Map()

for (const translation of translations) {
  if (
    translation.table_name === 'stops' &&
    translation.field_name === 'stop_name' &&
    translation.language === 'en'
  ) {
    stationEnglishMap.set(
      translation.field_value,
      translation.translation
    )
  }
}
const processedStations =
  [...stationMap.values()].map(
    (station) => ({
      ...station,

      japanese:
        station.name || '',

      romanized:
        stationEnglishMap.get(
          station.name
        ) || '',

      korean: '',
    })
  )
/*
 * ------------------------------------------------------------
 * 2. 노선 데이터
 * ------------------------------------------------------------
 */

const processedLines = routes.map((route) => ({
  id: route.route_id,
  shortName: route.route_short_name || '',
  longName: route.route_long_name || '',
  color: route.route_color
    ? `#${route.route_color}`
    : '#666666',
  textColor: route.route_text_color
    ? `#${route.route_text_color}`
    : '#ffffff',
  type: route.route_type || '',
}))

/*
 * ------------------------------------------------------------
 * 3. 운행편 기본 정보
 * ------------------------------------------------------------
 */
function getTrainNumberFromTripId(tripId) {
  if (!tripId) {
    return ''
  }

  const trainNumbers =
    Object.keys(trainMeta)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)

  for (const trainNumber of trainNumbers) {
    if (
      tripId.endsWith(
        `${trainNumber}0`
      )
    ) {
      return trainNumber
    }
  }

  return ''
}
const tripMap = new Map()

for (const trip of trips) {
  const inferredTrainNumber =
    getTrainNumberFromTripId(
      trip.trip_id
    )

  tripMap.set(trip.trip_id, {
    id: trip.trip_id,
    routeId: trip.route_id,
    serviceId: trip.service_id,

    // 실제 행선지
    headsign: trip.trip_headsign || '',

    // GTFS trip_short_name이 비어 있으므로
    // trip_id에서 ODPT 열차번호를 추출
    tripShortName:
      trip.trip_short_name ||
      inferredTrainNumber,

    directionId: trip.direction_id || '',
    blockId: trip.block_id || '',
  })
}

/*
 * ------------------------------------------------------------
 * 4. 정차 시간
 *
 * 앱에서 바로 쓰기 쉽게 trip 단위로 묶는다.
 * ------------------------------------------------------------
 */

const stopTimesByTrip = new Map()

for (const stopTime of stopTimes) {
  if (!stopTimesByTrip.has(stopTime.trip_id)) {
    stopTimesByTrip.set(stopTime.trip_id, [])
  }

  stopTimesByTrip.get(stopTime.trip_id).push({
    stopId: stopTime.stop_id,
    stopSequence: Number(stopTime.stop_sequence) || 0,
    arrivalTime: stopTime.arrival_time || '',
    departureTime: stopTime.departure_time || '',
    pickupType: stopTime.pickup_type || '',
    dropOffType: stopTime.drop_off_type || '',
  })
}

for (const times of stopTimesByTrip.values()) {
  times.sort((a, b) => a.stopSequence - b.stopSequence)
}

/*
 * ------------------------------------------------------------
 * 5. NOREBA용 운행 데이터
 *
 * 원본 GTFS의 12만 개 stop_times를 그대로 앱에 넣지 않고
 * trip별 정차 정보를 묶어서 저장한다.
 * ------------------------------------------------------------
 */

const processedTrips = []

for (const trip of trips) {
  const times = stopTimesByTrip.get(trip.trip_id) || []

const inferredTrainNumber =
  getTrainNumberFromTripId(
    trip.trip_id
  )

processedTrips.push({
  id: trip.trip_id,
  routeId: trip.route_id,
  serviceId: trip.service_id,
  headsign: trip.trip_headsign || '',

  tripShortName:
    trip.trip_short_name ||
    inferredTrainNumber,

  directionId: trip.direction_id || '',
  stops: times,
})
}
/*
 * ------------------------------------------------------------
 * 6. 역별 검색용 이름
 *
 * 현재 GTFS에서 확보되는 일본어 이름을 기본으로 사용.
 * 한국어/로마자 이름은 이후 NOREBA 자체 매핑 데이터에서 추가.
 * ------------------------------------------------------------
 */

// 역 이름 영문 표기


const processedStationSearch =
  processedStations.map((station) => ({
    id: station.id,
    name: station.name,
    japanese: station.name,

    romanized:
      stationEnglishMap.get(
        station.name
      ) || '',

    korean:
  stationKorean[station.name] || '',
  }))

/*
 * ------------------------------------------------------------
 * 7. 운임 데이터
 * ------------------------------------------------------------
 */

const processedFares = {
  attributes: fareAttributes,
  rules: fareRules,
}

/*
 * ------------------------------------------------------------
 * 8. 서비스 날짜
 * ------------------------------------------------------------
 */

const processedServices = {
  calendar,
  calendarDates,
}

/*
 * ------------------------------------------------------------
 * 9. NOREBA 데이터 저장
 * ------------------------------------------------------------
 */

function writeJson(filename, data) {
  const outputPath = path.join(outputDir, filename)

  fs.writeFileSync(
    outputPath,
    JSON.stringify(data),
    'utf8'
  )

  console.log(`생성: ${filename}`)
}
/*
 * ------------------------------------------------------------
 * 10. 역간 연결 데이터
 *
 * 각 운행편의 연속된 역을 연결한다.
 *
 * 예:
 * A → B → C
 *
 *      ↓
 *
 * A → B
 * B → C
 *
 * 같은 역간 연결을 여러 운행편이 공유할 수 있으므로
 * 하나의 connection 안에 여러 운행 정보를 저장한다.
 * ------------------------------------------------------------
 */

const connectionMap = new Map()

function connectionDurationMinutes(departure, arrival) {
  if (!departure || !arrival) return null
  const [dh, dm, ds] = departure.split(':').map(Number)
  const [ah, am, as] = arrival.split(':').map(Number)
  if ([dh, dm, ds, ah, am, as].some((value) => !Number.isFinite(value))) return null
  let departureSeconds = dh * 3600 + dm * 60 + ds
  let arrivalSeconds = ah * 3600 + am * 60 + as
  if (arrivalSeconds < departureSeconds) arrivalSeconds += 24 * 60 * 60
  return Math.max(0, Math.round((arrivalSeconds - departureSeconds) / 60))
}

for (const trip of processedTrips) {
  // Skip GTFS pass-through rows where both pickup and drop-off are prohibited
  // and times are blank. Connect a boardable origin directly to the next
  // timed, alightable stop. Otherwise a limited-stop train would be lost at
  // each untimed intermediate row even though the train continues running.
  const activeOrigins = []
  for (const [stopIndex, stop] of trip.stops.entries()) {
    const pickupAllowed = stop.pickupType !== '1'
    const dropOffAllowed = stop.dropOffType !== '1'
    const hasArrival = Boolean(stop.arrivalTime)
    const hasDeparture = Boolean(stop.departureTime)

    if (dropOffAllowed && hasArrival) {
      for (const origin of activeOrigins) {
        if (!origin.stopId || !stop.stopId || origin.stopId === stop.stopId || !origin.departureTime) continue
        const key = [trip.routeId, origin.stopId, stop.stopId].join('|')
        if (!connectionMap.has(key)) {
          connectionMap.set(key, {
            id: key,
            from: origin.stopId,
            to: stop.stopId,
            lineId: trip.routeId,
            duration: null,
            services: [],
          })
        }
        const connection = connectionMap.get(key)
        const duration = connectionDurationMinutes(origin.departureTime, stop.arrivalTime)
        if (duration == null) continue
        if (connection.duration === null) connection.duration = duration
        connection.services.push({
          tripId: trip.id,
          serviceId: trip.serviceId,
          departure: origin.departureTime,
          arrival: stop.arrivalTime,
          headsign: trip.headsign,
          tripShortName: trip.tripShortName || '',
          directionId: trip.directionId,
          pickupType: origin.pickupType,
          dropOffType: stop.dropOffType,
          skippedStopCount: Math.max(0, stopIndex - origin.sourceIndex - 1),
        })
      }
    }

    if (pickupAllowed && hasDeparture) {
      if (dropOffAllowed && hasArrival) {
        activeOrigins.splice(0, activeOrigins.length, { ...stop, sourceIndex: stopIndex })
      } else {
        activeOrigins.push({ ...stop, sourceIndex: stopIndex })
      }
    }
  }
}

const processedConnections = [
  ...connectionMap.values(),
]

/*
 * ------------------------------------------------------------
 * 11. 역별 운행 노선 정보
 * ------------------------------------------------------------
 */

const stationLineMap = new Map()

for (const connection of processedConnections) {
  if (!stationLineMap.has(connection.from)) {
    stationLineMap.set(connection.from, new Set())
  }

  if (!stationLineMap.has(connection.to)) {
    stationLineMap.set(connection.to, new Set())
  }

  stationLineMap
    .get(connection.from)
    .add(connection.lineId)

  stationLineMap
    .get(connection.to)
    .add(connection.lineId)
}

const processedStationsWithLines =
  processedStationSearch.map((station) => ({
    ...station,
    lines: [
      ...(stationLineMap.get(station.id) || []),
    ],
  }))

/*
 * ------------------------------------------------------------
 * 12. connections.json 저장
 * ------------------------------------------------------------
 */

writeJson(
  'stations.json',
  processedStationsWithLines
)

writeJson(
  'connections.json',
  processedConnections
)

writeJson(
  'lines.json',
  processedLines
)

writeJson(
  'trips.json',
  processedTrips
)

writeJson(
  'fares.json',
  processedFares
)

writeJson(
  'services.json',
  processedServices
)


/*
 * 메타데이터
 */

writeJson('meta.json', {
  source: zipFiles[0],
  generatedAt: new Date().toISOString(),
  agency,
  feedInfo,
})

console.log('')
console.log('====================================')
console.log('NOREBA GTFS 데이터 변환 완료!')
console.log('====================================')
console.log(`역: ${processedStations.length}`)
console.log(`노선: ${processedLines.length}`)
console.log(`운행편: ${processedTrips.length}`)
console.log(`정차 데이터: ${stopTimes.length}`)
console.log('')
console.log('생성된 파일:')
console.log('- stations.json')
console.log('- lines.json')
console.log('- trips.json')
console.log('- fares.json')
console.log('- services.json')
console.log('- meta.json')