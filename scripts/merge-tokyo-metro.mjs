import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { parse } from 'csv-parse/sync'

const root = process.cwd()
const rawDir = path.join(root, 'data/raw')
const outDir = path.join(root, 'data/processed')
const metroZipPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(rawDir, 'TokyoMetro-Train-GTFS.zip')
const odptStationsPath = path.join(rawDir, 'odpt_Station.json')
const odptRailwaysPath = path.join(rawDir, 'odpt_Railway.json')
const odptTrainTimetablePath = path.join(rawDir, 'odpt_TrainTimetable.json')
const odptStationTimetablePath = path.join(rawDir, 'odpt_StationTimetable.json')
const odptRailwayFarePath = path.join(rawDir, 'odpt_RailwayFare.json')
const stationKoreanPath = path.join(root, 'data/station-korean.json')

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(outDir, filename), 'utf8'))
}
function writeJson(filename, value) {
  fs.writeFileSync(path.join(outDir, filename), JSON.stringify(value), 'utf8')
}
function readGtfsZip(zipPath) {
  const zip = new AdmZip(zipPath)
  const readCsv = (filename) => {
    const entry = zip.getEntry(filename)
    if (!entry) return []
    return parse(entry.getData().toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    })
  }
  return { zip, readCsv }
}
function normalizeLatin(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}
function toSeconds(value) {
  const parts = String(value || '').split(':').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}
function secondsBetween(departure, arrival) {
  const dep = toSeconds(departure)
  let arr = toSeconds(arrival)
  if (dep == null || arr == null) return null
  if (arr < dep) arr += 86400
  return Math.max(0, Math.round((arr - dep) / 60))
}
function linePresentation(route) {
  const byId = {
    '1': { name: '도쿄메트로 긴자선', code: 'G' },
    '2': { name: '도쿄메트로 마루노우치선', code: 'M' },
    '3': { name: '도쿄메트로 히비야선', code: 'H' },
    '4': { name: '도쿄메트로 도자이선', code: 'T' },
    '5': { name: '도쿄메트로 치요다선', code: 'C' },
    '6': { name: '도쿄메트로 유라쿠초선', code: 'Y' },
    '7': { name: '도쿄메트로 한조몬선', code: 'Z' },
    '8': { name: '도쿄메트로 난보쿠선', code: 'N' },
    '9': { name: '도쿄메트로 후쿠토신선', code: 'F' },
  }
  return byId[String(route.route_id)] || { name: route.route_long_name || '도쿄메트로', code: '●' }
}

if (!fs.existsSync(metroZipPath)) throw new Error(`도쿄메트로 GTFS ZIP을 찾을 수 없습니다: ${metroZipPath}`)
if (!fs.existsSync(odptStationsPath)) throw new Error('data/raw/odpt_Station.json이 없습니다.')

const metro = readGtfsZip(metroZipPath)
const agency = metro.readCsv('agency.txt')
const calendar = metro.readCsv('calendar.txt')
const calendarDates = metro.readCsv('calendar_dates.txt')
const fareAttributes = metro.readCsv('fare_attributes.txt')
const fareRules = metro.readCsv('fare_rules.txt')
const feedInfo = metro.readCsv('feed_info.txt')
const routes = metro.readCsv('routes.txt')
const stops = metro.readCsv('stops.txt')
const stopTimes = metro.readCsv('stop_times.txt')
const trips = metro.readCsv('trips.txt')
const translations = metro.readCsv('translations.txt')

const metroStopById = new Map(stops.map((stop) => [stop.stop_id, stop]))
const metroTripIds = new Set(trips.map((trip) => trip.trip_id))
const metroRouteIds = new Set(routes.map((route) => route.route_id))
const metroServiceIds = new Set([
  ...calendar.map((item) => item.service_id),
  ...calendarDates.map((item) => item.service_id),
])
const invalidStopTimeRefs = stopTimes.filter((item) =>
  !metroTripIds.has(item.trip_id) || !metroStopById.has(item.stop_id)
)
const untimedServiceableStops = stopTimes.filter((item) =>
  (!item.arrival_time || !item.departure_time) &&
  (item.pickup_type !== '1' || item.drop_off_type !== '1')
)
const tripsMissingRouteOrCalendar = trips.filter((trip) =>
  !metroRouteIds.has(trip.route_id) || !metroServiceIds.has(trip.service_id)
)
if (invalidStopTimeRefs.length) {
  throw new Error(`GTFS stop_times에 존재하지 않는 trip/stop 참조가 ${invalidStopTimeRefs.length}건 있습니다.`)
}
if (untimedServiceableStops.length) {
  throw new Error(`승차 또는 하차가 허용되지만 시각이 비어 있는 정차 기록이 ${untimedServiceableStops.length}건 있습니다. 보간/원본 검증이 필요합니다.`)
}
if (tripsMissingRouteOrCalendar.length) {
  throw new Error(`GTFS trip의 route/calendar 참조가 잘못된 기록이 ${tripsMissingRouteOrCalendar.length}건 있습니다.`)
}

const existingStationsRaw = readJson('stations.json')
const existingLinesRaw = readJson('lines.json')
const existingConnectionsRaw = readJson('connections.json')
const existingTripsRaw = readJson('trips.json')
const existingServicesRaw = readJson('services.json')
const existingFaresRaw = readJson('fares.json')
const existingTransfersRaw = readJson('transfers.json')
const odptStations = JSON.parse(fs.readFileSync(odptStationsPath, 'utf8'))
const odptRailways = JSON.parse(fs.readFileSync(odptRailwaysPath, 'utf8'))
const odptTrainTimetable = fs.existsSync(odptTrainTimetablePath)
  ? JSON.parse(fs.readFileSync(odptTrainTimetablePath, 'utf8'))
  : []
const odptStationTimetable = fs.existsSync(odptStationTimetablePath)
  ? JSON.parse(fs.readFileSync(odptStationTimetablePath, 'utf8'))
  : []
const odptRailwayFare = fs.existsSync(odptRailwayFarePath)
  ? JSON.parse(fs.readFileSync(odptRailwayFarePath, 'utf8'))
  : []
const stationKorean = fs.existsSync(stationKoreanPath)
  ? JSON.parse(fs.readFileSync(stationKoreanPath, 'utf8'))
  : {}

// Add Toei fare zones and coordinates from the original GTFS source; the
// previous converter dropped zone_id and coordinates, preventing exact fare
// lookup and evidence-based Toei transfer matching.
const toeiStationCoordinates = new Map()
const toeiZipPath = path.join(rawDir, 'Toei-Train-GTFS.zip')
let toeiUntimedPassThroughStops = 0
let toeiUntimedServiceableStops = 0
if (fs.existsSync(toeiZipPath)) {
  const toei = readGtfsZip(toeiZipPath)
  const toeiStops = toei.readCsv('stops.txt')
  const toeiStopTimes = toei.readCsv('stop_times.txt')
  const toeiUntimed = toeiStopTimes.filter((item) => !item.arrival_time || !item.departure_time)
  toeiUntimedPassThroughStops = toeiUntimed.length
  toeiUntimedServiceableStops = toeiUntimed.filter((item) =>
    (item.pickup_type || '0') !== '1' || (item.drop_off_type || '0') !== '1'
  ).length
  if (toeiUntimedServiceableStops) {
    throw new Error(`Toei GTFS에 승차 또는 하차가 허용되지만 시각이 비어 있는 기록이 ${toeiUntimedServiceableStops}건 있습니다.`)
  }
  const zoneByStation = new Map()
  for (const stop of toeiStops) {
    const stationId = stop.parent_station || stop.stop_id
    if (stationId && stop.zone_id && !zoneByStation.has(stationId)) {
      zoneByStation.set(stationId, stop.zone_id)
    }
    if (stationId && !toeiStationCoordinates.has(stationId)) {
      toeiStationCoordinates.set(stationId, {
        lat: Number(stop.stop_lat) || null,
        lon: Number(stop.stop_lon) || null,
      })
    }
  }
  for (const station of existingStationsRaw) {
    if (!String(station.id).startsWith('TM-') && zoneByStation.has(station.id)) {
      station.zoneId = zoneByStation.get(station.id)
    }
    if (!String(station.id).startsWith('TM-')) {
      station.korean = station.korean || stationKorean[station.name] || ''
      station.operator = 'toei'
      const coordinates = toeiStationCoordinates.get(station.id)
      if (coordinates?.lat != null) station.lat = coordinates.lat
      if (coordinates?.lon != null) station.lon = coordinates.lon
    }
  }
}

// Prefix existing Toei fare IDs and rules exactly once so both agencies can
// coexist even when their fare_id values overlap.
const baseFareAttributes = (existingFaresRaw.attributes || [])
  .filter((item) => item.agency_id !== 'tokyometro')
  .map((item) => ({
    ...item,
    fare_id: String(item.fare_id).startsWith('TE-') ? item.fare_id : `TE-${item.fare_id}`,
  }))
const baseFareRules = (existingFaresRaw.rules || [])
  .filter((item) => !String(item.fare_id).startsWith('TM-'))
  .map((item) => ({
    ...item,
    fare_id: String(item.fare_id).startsWith('TE-') ? item.fare_id : `TE-${item.fare_id}`,
  }))

const englishByJapanese = new Map()
for (const translation of translations) {
  if (
    translation.table_name === 'stops' &&
    translation.field_name === 'stop_name' &&
    translation.language === 'en' &&
    !englishByJapanese.has(translation.field_value)
  ) {
    englishByJapanese.set(translation.field_value, translation.translation)
  }
}

const odptByCode = new Map()
for (const station of odptStations) {
  const code = station['odpt:stationCode']
  if (code) {
    if (!odptByCode.has(code)) odptByCode.set(code, [])
    odptByCode.get(code).push(station)
  }
}

const stationIdByOdptRef = new Map()
const metroStations = []
for (const stop of stops) {
  const code = stop.stop_code || ''
  const odptMatches = odptByCode.get(code) || []
  const odpt = odptMatches[0]
  if (!odpt) throw new Error(`GTFS 역 코드 ${code} (${stop.stop_name})에 대응하는 ODPT 역이 없습니다.`)
  const id = `TM-${stop.stop_id}`
  const japanese = stop.stop_name || odpt['dc:title'] || ''
  const romanized = englishByJapanese.get(japanese) || odpt['odpt:stationTitle']?.en || ''
  const korean = odptMatches.find((item) => item['odpt:stationTitle']?.ko)?.['odpt:stationTitle']?.ko || stationKorean[japanese] || ''
  const station = {
    id,
    name: japanese,
    japanese,
    romanized,
    korean,
    lat: Number(stop.stop_lat) || odpt['geo:lat'] || null,
    lon: Number(stop.stop_lon) || odpt['geo:long'] || null,
    zoneId: stop.zone_id || '',
    stationCode: code,
    operator: 'tokyometro',
    lines: [],
  }
  metroStations.push(station)
  for (const matchedOdptStation of odptMatches) {
    stationIdByOdptRef.set(matchedOdptStation['owl:sameAs'], id)
  }
}

const metroLines = routes.map((route) => {
  const presentation = linePresentation(route)
  return {
    id: `TM-${route.route_id}`,
    sourceId: route.route_id,
    shortName: presentation.code,
    code: presentation.code,
    name: presentation.name,
    longName: route.route_long_name || presentation.name,
    color: route.route_color ? `#${route.route_color}` : '#666666',
    textColor: route.route_text_color ? `#${route.route_text_color}` : '#ffffff',
    type: route.route_type || '1',
    operator: 'tokyometro',
  }
})

const tripMetaByNumber = new Map()
for (const item of odptTrainTimetable) {
  const number = item['odpt:trainNumber']
  if (!number) continue
  tripMetaByNumber.set(number, {
    trainType: item['odpt:trainType'] || '',
    destinationStations: item['odpt:destinationStation'] || [],
    railDirection: item['odpt:railDirection'] || '',
  })
}
function inferMetroTrainNumber(tripId) {
  const candidates = [...tripMetaByNumber.keys()].sort((a, b) => b.length - a.length)
  return candidates.find((number) => String(tripId).endsWith(`${number}0`)) || ''
}

const metroTrips = []
const stopTimesByTrip = new Map()
for (const stopTime of stopTimes) {
  if (!stopTimesByTrip.has(stopTime.trip_id)) stopTimesByTrip.set(stopTime.trip_id, [])
  stopTimesByTrip.get(stopTime.trip_id).push({
    stopId: `TM-${stopTime.stop_id}`,
    stopSequence: Number(stopTime.stop_sequence) || 0,
    arrivalTime: stopTime.arrival_time || '',
    departureTime: stopTime.departure_time || '',
    pickupType: stopTime.pickup_type || '',
    dropOffType: stopTime.drop_off_type || '',
  })
}
for (const stopList of stopTimesByTrip.values()) {
  stopList.sort((a, b) => a.stopSequence - b.stopSequence)
}
for (const trip of trips) {
  const trainNumber = trip.trip_short_name || inferMetroTrainNumber(trip.trip_id)
  const processed = {
    id: `TM-${trip.trip_id}`,
    routeId: `TM-${trip.route_id}`,
    serviceId: `TM-${trip.service_id}`,
    headsign: trip.trip_headsign || '',
    tripShortName: trainNumber,
    directionId: trip.direction_id || '',
    blockId: trip.block_id || '',
    stops: stopTimesByTrip.get(trip.trip_id) || [],
  }
  metroTrips.push(processed)
}

const metroConnectionMap = new Map()
for (const trip of metroTrips) {
  // Some Tokyo Metro GTFS trips list pass-through stations with blank times and
  // pickup_type=1/drop_off_type=1 (for example, limited-stop services). Build
  // passenger-usable ride edges between boardable origins and alightable stops
  // instead of dropping the whole train when an intermediate time is blank.
  // If a stop is both boardable and alightable, it becomes the next origin so
  // ordinary local services remain adjacent-stop connections.
  const activeOrigins = []
  for (const [stopIndex, stop] of trip.stops.entries()) {
    const pickupAllowed = stop.pickupType !== '1'
    const dropOffAllowed = stop.dropOffType !== '1'
    const hasArrival = Boolean(stop.arrivalTime)
    const hasDeparture = Boolean(stop.departureTime)

    if (dropOffAllowed && hasArrival) {
      for (const origin of activeOrigins) {
        if (!origin.stopId || !stop.stopId || origin.stopId === stop.stopId || !origin.departureTime) continue
        const key = `${trip.routeId}|${origin.stopId}|${stop.stopId}`
        if (!metroConnectionMap.has(key)) {
          metroConnectionMap.set(key, {
            id: key,
            from: origin.stopId,
            to: stop.stopId,
            lineId: trip.routeId,
            duration: null,
            services: [],
          })
        }
        const connection = metroConnectionMap.get(key)
        const duration = secondsBetween(origin.departureTime, stop.arrivalTime)
        if (duration == null) continue
        if (connection.duration == null) connection.duration = duration
        connection.services.push({
          tripId: trip.id,
          serviceId: trip.serviceId,
          departure: origin.departureTime,
          arrival: stop.arrivalTime,
          headsign: trip.headsign,
          tripShortName: trip.tripShortName,
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
const metroConnections = [...metroConnectionMap.values()]

const stationLineMap = new Map()
for (const connection of metroConnections) {
  if (!stationLineMap.has(connection.from)) stationLineMap.set(connection.from, new Set())
  if (!stationLineMap.has(connection.to)) stationLineMap.set(connection.to, new Set())
  stationLineMap.get(connection.from).add(connection.lineId)
  stationLineMap.get(connection.to).add(connection.lineId)
}
for (const station of metroStations) station.lines = [...(stationLineMap.get(station.id) || [])]

// Build transfer links only from explicit ODPT connectingStation relationships.
// All edges are bidirectional; the 300-second duration is a fallback because
// these source files do not include walking-time values.
const toeiLineByOdptName = {
  Asakusa: '1',
  Mita: '2',
  Shinjuku: '3',
  Oedo: '4',
  NipporiToneri: '5',
  Arakawa: '6',
}
const toeiStations = existingStationsRaw.filter((station) => !String(station.id).startsWith('TM-'))
const toeiCandidates = toeiStations.map((station) => ({
  ...station,
  lines: (station.lines || []).map(String),
  normalizedRomanized: normalizeLatin(station.romanized),
}))
function resolveToeiStation(ref) {
  const match = String(ref).match(/^odpt\.Station:Toei\.([^.]+)\.(.+)$/)
  if (!match) return null
  const [, odptLine, suffix] = match
  const lineId = toeiLineByOdptName[odptLine]
  if (!lineId) return null
  const normalized = normalizeLatin(suffix)
  const candidates = toeiCandidates.filter((station) =>
    station.lines.includes(lineId) && station.normalizedRomanized === normalized
  )
  return candidates.length === 1 ? candidates[0].id : null
}
const transferMap = new Map()
function addTransfer(a, b, source, sourceRef = '', duration = 300) {
  if (!a || !b || a === b) return
  const addOne = (from, to) => {
    const key = `${from}>>${to}`
    if (!transferMap.has(key)) {
      transferMap.set(key, { from, to, duration, source, sourceRef })
    }
  }
  addOne(a, b)
  addOne(b, a)
}
const unresolvedTransferRefs = []
const externalConnectionsNotIntegrated = []
for (const station of odptStations) {
  const fromId = stationIdByOdptRef.get(station['owl:sameAs'])
  if (!fromId) continue
  for (const targetRef of station['odpt:connectingStation'] || []) {
    if (stationIdByOdptRef.has(targetRef)) {
      addTransfer(fromId, stationIdByOdptRef.get(targetRef), 'odpt', targetRef, 300)
      continue
    }
    if (targetRef.startsWith('odpt.Station:Toei.')) {
      const toeiId = resolveToeiStation(targetRef)
      if (toeiId) addTransfer(fromId, toeiId, 'odpt', targetRef, 300)
      else unresolvedTransferRefs.push({ from: fromId, targetRef, reason: 'Toei station could not be matched by line and romanized name' })
    } else {
      externalConnectionsNotIntegrated.push({ from: fromId, targetRef })
    }
  }
}

// Toei's supplied GTFS does not include transfers.txt. Add only duplicate-name
// station pairs on different Toei lines whose GTFS coordinates are within 350m.
// This is an auditable inference, not an official walking-time measurement.
const existingManualTransfers = (existingTransfersRaw || []).filter((transfer) =>
  !['odpt', 'gtfs-name-coordinate-inference'].includes(transfer.source)
)
const existingManualTransferPairs = new Set(existingManualTransfers.map((transfer) =>
  [String(transfer.from), String(transfer.to)].sort().join('::')
))
const toeiByName = new Map()
for (const station of toeiStations) {
  if (!toeiByName.has(station.name)) toeiByName.set(station.name, [])
  toeiByName.get(station.name).push(station)
}
function distanceMeters(a, b) {
  if (a?.lat == null || a?.lon == null || b?.lat == null || b?.lon == null) return Infinity
  const rad = (value) => value * Math.PI / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const lat1 = rad(a.lat)
  const lat2 = rad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
for (const [japaneseName, group] of toeiByName) {
  if (group.length < 2) continue
  for (let i = 0; i < group.length; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      const a = group[i]
      const b = group[j]
      const lineA = new Set((a.lines || []).map(String))
      const lineB = new Set((b.lines || []).map(String))
      if (![...lineA].some((lineId) => !lineB.has(lineId))) continue
      const distance = distanceMeters(a, b)
      if (distance > 350) continue
      const pairKey = [String(a.id), String(b.id)].sort().join('::')
      if (existingManualTransferPairs.has(pairKey)) continue
      addTransfer(a.id, b.id, 'gtfs-name-coordinate-inference', `${japaneseName}; ${Math.round(distance)}m`, 300)
    }
  }
}

// Add line codes/names to the existing Toei line metadata while preserving IDs.
const toeiLinePresentation = {
  '1': { name: '도에이 아사쿠사선', code: 'A' },
  '2': { name: '도에이 미타선', code: 'I' },
  '3': { name: '도에이 신주쿠선', code: 'S' },
  '4': { name: '도에이 오에도선', code: 'E' },
  '5': { name: '닛포리·도네리 라이너', code: 'NT' },
  '6': { name: '도쿄 사쿠라 트램(도덴 아라카와선)', code: 'SA' },
}
const baseLines = existingLinesRaw.filter((line) => !String(line.id).startsWith('TM-')).map((line) => {
  const p = toeiLinePresentation[String(line.id)] || { name: line.longName || '도에이 교통', code: '●' }
  return { ...line, name: p.name, code: p.code, operator: 'toei' }
})

// Merge schedules without changing original Toei IDs.
const baseCalendar = (existingServicesRaw.calendar || []).filter((item) => !String(item.service_id).startsWith('TM-'))
const baseCalendarDates = (existingServicesRaw.calendarDates || []).filter((item) => !String(item.service_id).startsWith('TM-'))
const metroCalendar = calendar.map((item) => ({ ...item, service_id: `TM-${item.service_id}` }))
const metroCalendarDates = calendarDates.map((item) => ({ ...item, service_id: `TM-${item.service_id}` }))

const metroFareAttributes = fareAttributes.map((item) => ({
  ...item,
  fare_id: `TM-${item.fare_id}`,
  agency_id: 'tokyometro',
}))
const metroFareRules = fareRules.map((item) => ({
  ...item,
  fare_id: `TM-${item.fare_id}`,
  route_id: item.route_id ? `TM-${item.route_id}` : '',
}))

const allStations = [...toeiStations, ...metroStations]
const allLines = [...baseLines, ...metroLines]
const allConnections = [
  ...existingConnectionsRaw.filter((connection) => !String(connection.id).startsWith('TM-')),
  ...metroConnections,
]
const allTrips = [
  ...existingTripsRaw.filter((trip) => !String(trip.id).startsWith('TM-')),
  ...metroTrips,
]
const existingTransfers = existingManualTransfers
const allTransfers = [...existingTransfers, ...transferMap.values()]
const allFares = {
  attributes: [...baseFareAttributes, ...metroFareAttributes],
  rules: [...baseFareRules, ...metroFareRules],
}

// Audit the Metro station-code mapping and directed graph reachability. A
// connected undirected graph is not enough: routes need a usable directed path.
const stationNameMismatches = []
for (const stop of stops) {
  const matches = odptByCode.get(stop.stop_code || '') || []
  if (!matches.some((item) => item['dc:title'] === stop.stop_name || item['odpt:stationTitle']?.ja === stop.stop_name)) {
    stationNameMismatches.push({ stopCode: stop.stop_code || '', gtfsName: stop.stop_name || '', odptNames: matches.map((item) => item['dc:title'] || item['odpt:stationTitle']?.ja || '') })
  }
}
const metroStationIds = new Set(metroStations.map((station) => station.id))
const metroAdjacency = new Map([...metroStationIds].map((id) => [id, new Set()]))
const metroReverseAdjacency = new Map([...metroStationIds].map((id) => [id, new Set()]))
for (const edge of metroConnections) {
  if (!metroStationIds.has(edge.from) || !metroStationIds.has(edge.to)) continue
  metroAdjacency.get(edge.from).add(edge.to)
  metroReverseAdjacency.get(edge.to).add(edge.from)
}
for (const edge of transferMap.values()) {
  if (!metroStationIds.has(edge.from) || !metroStationIds.has(edge.to)) continue
  metroAdjacency.get(edge.from).add(edge.to)
  metroReverseAdjacency.get(edge.to).add(edge.from)
}
function reachableCount(adjacency, startId) {
  const visited = new Set([startId])
  const queue = [startId]
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of adjacency.get(queue[index]) || []) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }
  return visited.size
}
const metroGraphAudit = {
  stationCount: metroStationIds.size,
  stationsReachableFromFirstNode: metroStationIds.size ? reachableCount(metroAdjacency, metroStationIds.values().next().value) : 0,
  stationsThatCanReachFirstNode: metroStationIds.size ? reachableCount(metroReverseAdjacency, metroStationIds.values().next().value) : 0,
  stationsWithoutRideEdges: metroStations.filter((station) => !metroConnections.some((edge) => edge.from === station.id || edge.to === station.id)).map((station) => station.id),
  directedRideConnections: metroConnections.length,
  directedMetroTransferEdges: [...transferMap.values()].filter((edge) => metroStationIds.has(edge.from) && metroStationIds.has(edge.to)).length,
}

// Merge metadata for the subset of ODPT train types available; missing train
// metadata does not affect route timing or path finding.
const trainMetaPath = path.join(outDir, 'trainMeta.json')
const trainMeta = fs.existsSync(trainMetaPath) ? JSON.parse(fs.readFileSync(trainMetaPath, 'utf8')) : {}
for (const [number, metadata] of tripMetaByNumber) trainMeta[number] = metadata

writeJson('stations.json', allStations)
writeJson('lines.json', allLines)
writeJson('connections.json', allConnections)
writeJson('trips.json', allTrips)
writeJson('services.json', { calendar: [...baseCalendar, ...metroCalendar], calendarDates: [...baseCalendarDates, ...metroCalendarDates] })
writeJson('fares.json', allFares)
writeJson('transfers.json', allTransfers)
writeJson('trainMeta.json', trainMeta)

const metaPath = path.join(outDir, 'meta.json')
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {}
meta.sources = {
  ...(meta.sources || {}),
  tokyoMetroGtfs: {
    file: path.basename(metroZipPath),
    feedInfo,
    agency,
    routes: routes.length,
    stations: stops.length,
    trips: trips.length,
    stopTimes: stopTimes.length,
  },
  odpt: {
    railwayRecords: odptRailways.length,
    stationRecords: odptStations.length,
    trainTimetableRecordsUsedForMetadataOnly: odptTrainTimetable.length,
    transferDurationFallbackSeconds: 300,
  },
}
meta.generatedAt = new Date().toISOString()
fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8')

const audit = {
  generatedAt: new Date().toISOString(),
  metroFeed: {
    ...((feedInfo && feedInfo[0]) || {}),
    calendarServiceCount: calendar.length,
    calendarExceptionCount: calendarDates.length,
    firstServiceDate: (feedInfo && feedInfo[0] && feedInfo[0].feed_start_date) || null,
    lastServiceDate: (feedInfo && feedInfo[0] && feedInfo[0].feed_end_date) || null,
  },
  sourceCounts: {
    metroGtfsStations: stops.length,
    metroGtfsRoutes: routes.length,
    metroGtfsTrips: trips.length,
    metroGtfsStopTimes: stopTimes.length,
    odptStations: odptStations.length,
    odptRailways: odptRailways.length,
    odptUniqueStationCodes: new Set(odptStations.map((station) => station['odpt:stationCode'])).size,
    odptDuplicateStationCodes: odptStations.length - new Set(odptStations.map((station) => station['odpt:stationCode'])).size,
    odptStationTimetables: odptStationTimetable.length,
    odptTrainTimetables: odptTrainTimetable.length,
    odptRailwayFares: odptRailwayFare.length,
    metroUntimedPassThroughStops: stopTimes.filter((item) => !item.arrival_time || !item.departure_time).length,
    metroUntimedServiceableStops: untimedServiceableStops.length,
    toeiUntimedPassThroughStops,
    toeiUntimedServiceableStops,
    invalidStopTimeReferences: invalidStopTimeRefs.length,
    tripsMissingRouteOrCalendar: tripsMissingRouteOrCalendar.length,
  },
  outputCounts: {
    stations: allStations.length,
    lines: allLines.length,
    trips: allTrips.length,
    connections: allConnections.length,
    transfers: allTransfers.length,
    metroRideConnections: metroConnections.length,
    toeiRideConnections: allConnections.length - metroConnections.length,
    metroPassThroughConnections: metroConnections.filter((connection) => connection.services.some((service) => service.skippedStopCount > 0)).length,
    metroPassThroughServiceSegments: metroConnections.reduce((count, connection) => count + connection.services.filter((service) => service.skippedStopCount > 0).length, 0),
    toeiPassThroughConnections: allConnections.filter((connection) => !String(connection.lineId).startsWith('TM-') && (connection.services || []).some((service) => service.skippedStopCount > 0)).length,
    toeiPassThroughServiceSegments: allConnections.filter((connection) => !String(connection.lineId).startsWith('TM-')).reduce((count, connection) => count + (connection.services || []).filter((service) => service.skippedStopCount > 0).length, 0),
    generatedTransferEdges: transferMap.size,
    odptTransferEdges: [...transferMap.values()].filter((transfer) => transfer.source === 'odpt').length,
    inferredToeiTransferEdges: [...transferMap.values()].filter((transfer) => transfer.source === 'gtfs-name-coordinate-inference').length,
    fareAttributes: allFares.attributes.length,
    fareRules: allFares.rules.length,
  },
  farePolicy: {
    calculatedSingleOperatorFares: ['tokyometro', 'toei'],
    supportedCrossOperatorCombination: ['tokyometro', 'toei'],
    metroToeiAdultTransferDiscountYen: 70,
    metroToeiDiscountApplication: 'once per entire itinerary, even if the route alternates between Tokyo Metro and Toei multiple times; official materials confirm the ¥70 Metro↔Toei through-fare discount, while this multi-alternation application is the app policy validated by regression fixtures',
    otherCrossOperatorFares: 'not combined; returned as unknown until an explicit official fare model is supported. This is an app support boundary, not a claim that other operators never offer through-fare discounts',
    farePriceInterpretation: 'GTFS fare_attributes.payment_method means payment timing (0=on board, 1=before boarding), not IC/paper medium. Included fare prices are treated as IC fares based on matching official operator IC fare tables; paper fare remains unknown because a separate paper amount is not encoded.',
    fareGateTransferLimit: 'Official IC-card guidance requires transfers that pass through an exit/re-entry fare gate to be completed within 60 minutes at specified transfer stations; the app does not track gate exit/re-entry or stopovers, so fare estimates assume a continuous eligible transfer.',
    externalOperatorsIntegratedIntoRouting: false,
  },
  stationMappingAudit: {
    gtfsStations: stops.length,
    uniqueOdptStationCodes: new Set(odptStations.map((station) => station['odpt:stationCode'])).size,
    nameMismatchCount: stationNameMismatches.length,
    nameMismatches: stationNameMismatches,
  },
  stationLocalizationAudit: {
    totalStations: allStations.length,
    stationsMissingKorean: allStations.filter((station) => !String(station.korean || '').trim()).map((station) => ({ id: station.id, name: station.name, operator: station.operator })),
    koreanMappingSource: 'data/station-korean.json with station-provided Korean names preferred when present',
  },
  metroGraphAudit,
  routeSearch: {
    maxDistinctRoutePatterns: 60,
    maxDisplayedRoutes: 3,
    maxExpandedStates: 80000,
    note: 'Matches src/routeEngine.js limits. Candidate search retains at most 60 route patterns, then displays at most three useful routes (and fewer when there are fewer meaningful alternatives). Bounded search is not an exhaustive optimality proof.', 
  },
  transferAudit: {
    matchedDirectedTransferEdges: [...transferMap.values()].filter((transfer) => transfer.source === 'odpt').length,
    unresolvedTransferRefs,
    inferredToeiTransferPairs: [...transferMap.values()].filter((transfer) => transfer.source === 'gtfs-name-coordinate-inference').length / 2,
    inferredToeiTransferEdges: [...transferMap.values()].filter((transfer) => transfer.source === 'gtfs-name-coordinate-inference').length,
    externalConnectionsNotIntegratedCount: externalConnectionsNotIntegrated.length,
    stationTimetableCoverage: {
      records: odptStationTimetable.length,
      uniqueStations: new Set(odptStationTimetable.map((item) => item['odpt:station'])).size,
      byRailway: Object.fromEntries([...odptStationTimetable.reduce((counts, item) => {
        const railway = String(item['odpt:railway'] || '').split('.').pop()
        counts.set(railway, (counts.get(railway) || 0) + 1)
        return counts
      }, new Map())]),
    },
    trainTimetableCoverage: {
      records: odptTrainTimetable.length,
      byRailway: Object.fromEntries([...odptTrainTimetable.reduce((counts, item) => {
        const railway = String(item['odpt:railway'] || '').split('.').pop()
        counts.set(railway, (counts.get(railway) || 0) + 1)
        return counts
      }, new Map())]),
      uniqueCalendars: [...new Set(odptTrainTimetable.map((item) => item['odpt:calendar']))],
    },
    railwayFareCoverage: {
      records: odptRailwayFare.length,
      uniqueFromStations: new Set(odptRailwayFare.map((item) => item['odpt:fromStation'])).size,
      uniqueToStations: new Set(odptRailwayFare.map((item) => item['odpt:toStation'])).size,
      usedForRouteFareCalculation: false,
    },
    externalConnectionsNotIntegrated: externalConnectionsNotIntegrated.slice(0, 100),
    note: 'ODPT connectingStation relationships only; 300 seconds is a fallback, not an observed walking time. External operators other than Toei/Tokyo Metro are not routed yet.',
  },
  warnings: [
    'ODPT TrainTimetable contains a partial sample; it is used only to enrich train metadata, never as the route timetable source.',
    'Untimed GTFS rows are only retained as non-boardable/non-alightable pass-through points; passenger ride edges are built between usable stops. Any untimed serviceable row causes the merge to fail.',
    'ODPT has 186 station records but 185 unique station codes because the Marunouchi main line and branch both expose Nakano-sakaue code M06; both ODPT IDs are mapped to the single GTFS station node.',
    'GTFS times at or after 24:00 belong to their service date. For searches before 06:00, the route engine also considers eligible late-night trips from the previous service date and shifts their displayed times to the selected calendar date.',
    'Route search now considers a larger, estimated-time-ordered candidate pool before timetable scheduling, but bounded candidate search is not a mathematical guarantee of global optimality.',
    'Fare policy: calculate Toei-only and Tokyo Metro-only journeys from their own GTFS fare rules. Tokyo Metro + Toei is the sole supported cross-operator exception: sum each continuous operator leg and apply the adult 70-yen discount once per entire itinerary, even if the route alternates between them multiple times. Do not combine fares with any other operator until an explicit official fare model is supported; this is an app support boundary, not a claim that other operators have no discounts.',
    'IC fare-gate transfer window: at specified Metro/Toei transfers requiring exit/re-entry through a fare gate, the official rule requires the transfer within 60 minutes; the app does not model passenger gate exit/re-entry or stopovers and assumes a continuous eligible transfer.',
    'Toei GTFS contains untimed pass-through stop rows. The converter now builds passenger-usable connection edges across those rows, just as the Metro merge does; untimed rows where pickup/drop-off is allowed cause conversion to fail.',
    'Toei-to-Toei links missing from GTFS transfers.txt are inferred only for duplicate Japanese station names with different line IDs and GTFS coordinates within 350m; their 300-second duration is a fallback, not an official walking-time value.',
    'ODPT RailwayFare is retained as raw source material but not used for fares because its 1,000-record sample is incomplete; the full GTFS fare rules are used instead.',
  ],
}
fs.writeFileSync(path.join(outDir, 'metro-integration-audit.json'), JSON.stringify(audit, null, 2), 'utf8')

console.log('Tokyo Metro GTFS merged into processed data.')
console.log(JSON.stringify(audit.outputCounts, null, 2))
console.log(`Unresolved Toei transfer refs: ${unresolvedTransferRefs.length}`)
console.log(`Other-operator transfer refs not routed: ${externalConnectionsNotIntegrated.length}`)
