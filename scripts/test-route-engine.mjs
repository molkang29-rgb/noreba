import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { sortRoutes, paretoRoutes, selectUsefulRoutes } from '../src/routeRanking.js'
const root = process.cwd()
const tempEnginePath = path.join(root, 'src/.routeEngine.test.mjs')
let engineSource = fs.readFileSync(path.join(root, 'src/routeEngine.js'), 'utf8')
for (const [name, filename] of Object.entries({
  processedStations: 'stations.json',
  processedConnections: 'connections.json',
  processedLines: 'lines.json',
  trainMeta: 'trainMeta.json',
  processedServices: 'services.json',
  processedFares: 'fares.json',
  processedTransfers: 'transfers.json',
})) {
  const importLine = `import ${name} from '../data/processed/${filename}'`
  const replacement = `const ${name} = JSON.parse(fs.readFileSync(new URL('../data/processed/${filename}', import.meta.url), 'utf8'))`
  assert.ok(engineSource.includes(importLine), `expected source import ${importLine}`)
  engineSource = engineSource.replace(importLine, replacement)
}
// Add a synthetic third-party operator only inside the test module. This lets
// the test prove that unsupported cross-operator routes stay unknown without
// adding a fake operator to the production network or public API.
engineSource = engineSource.replace(
  "const stationMap = new Map(processedStations.map((station) => [String(station.id), station]))",
  "const stationMap = new Map(processedStations.map((station) => [String(station.id), station]))\nstationMap.set('TEST-JR-A', { id: 'TEST-JR-A', operator: 'jr', zoneId: 'JR-A' })\nstationMap.set('TEST-JR-B', { id: 'TEST-JR-B', operator: 'jr', zoneId: 'JR-B' })",
)
engineSource = engineSource.replace(
  "const lineMap = new Map(processedLines.map((line) => [String(line.id), line]))",
  "const lineMap = new Map(processedLines.map((line) => [String(line.id), line]))\nlineMap.set('TEST-JR', { id: 'TEST-JR', operator: 'jr', name: 'Test JR', longName: 'Test JR' })",
)
// Export the private scheduler only in the temporary test module so transfer
// edges can be tested end-to-end without expanding the production API surface.
engineSource = engineSource.replace(
  'function schedulePath(path, startSeconds, targetDate) {',
  'export function schedulePath(path, startSeconds, targetDate) {',
)
engineSource = engineSource.replace(
  'function makeRoute(path, schedule, identity) {',
  'export function makeRoute(path, schedule, identity) {',
)
engineSource = engineSource.replace(
  'function getFareBetweenStations(fromId, toId) {',
  'export function getFareBetweenStations(fromId, toId) {',
)
engineSource = engineSource.replace(
  'function routePatternIdentity(path) {',
  'export function routePatternIdentity(path) {',
)
let calculateRoutes
let findPathsPublic
let schedulePath
let makeRoute
let getFareBetweenStations
let routePatternIdentity
try {
fs.writeFileSync(tempEnginePath, `import fs from 'node:fs'\n${engineSource}`, 'utf8')
;({ calculateRoutes, findPathsPublic, schedulePath, makeRoute, getFareBetweenStations, routePatternIdentity } = await import(`${pathToFileURL(tempEnginePath).href}?test=${Date.now()}`))
const rootPath = root
const readJson = (filename) => JSON.parse(fs.readFileSync(path.join(rootPath, 'data/processed', filename), 'utf8'))
const stations = readJson('stations.json')
const lines = readJson('lines.json')
const trips = readJson('trips.json')
const connections = readJson('connections.json')
const transfers = readJson('transfers.json')
const fares = readJson('fares.json')
const audit = readJson('metro-integration-audit.json')

// Build constrained route fixtures from the real merged graph. This validates
// the graph edges and scheduler without assuming the bounded public candidate
// search will retain every slow-transfer alternative in its top-N pool.
function findRidePathOnLine(fromId, toId, lineId) {
  const adjacency = new Map()
  for (const connection of connections) {
    if (String(connection.lineId) !== String(lineId)) continue
    if (!(connection.services || []).some((service) => service.departure && service.arrival)) continue
    if (!adjacency.has(String(connection.from))) adjacency.set(String(connection.from), [])
    adjacency.get(String(connection.from)).push({ ...connection, transfer: false })
  }
  const queue = [{ stationId: String(fromId), path: [], visited: new Set([String(fromId)]) }]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    if (current.stationId === String(toId)) return current.path
    for (const edge of adjacency.get(current.stationId) || []) {
      if (current.visited.has(String(edge.to))) continue
      const visited = new Set(current.visited)
      visited.add(String(edge.to))
      queue.push({ stationId: String(edge.to), path: [...current.path, edge], visited })
    }
  }
  return null
}
function getTransferEdge(fromId, toId) {
  const edge = transfers.find((item) => String(item.from) === String(fromId) && String(item.to) === String(toId))
  assert.ok(edge, `expected real transfer edge ${fromId} -> ${toId}`)
  return { ...edge, lineId: null, transfer: true, services: [], duration: Number(edge.duration) }
}

const stationIds = new Set(stations.map((station) => station.id))
const lineIds = new Set(lines.map((line) => line.id))
const metroStations = stations.filter((station) => station.operator === 'tokyometro')
assert.ok(metroStations.every((station) => station.korean && station.romanized), 'every Metro station should have Korean and romanized names')
assert.ok(stations.every((station) => String(station.korean || '').trim()), 'every integrated station, including Toei-operated tram/people-mover stops, should have a Korean display name')
assert.ok(metroStations.every((station) => Number.isFinite(station.lat) && Number.isFinite(station.lon)), 'every Metro station should have valid coordinates')
const fareIds = new Set(fares.attributes.map((fare) => fare.fare_id))
assert.ok(fares.rules.every((rule) => fareIds.has(rule.fare_id)), 'every fare rule should reference an existing fare attribute')
assert.deepEqual(getFareBetweenStations('TEST-JR-A', 'TEST-JR-B'), { icFare: null, paperFare: null }, 'unsupported operator fare rules must not accidentally fall through to Toei fares')
assert.equal(getFareBetweenStations('118', '117').icFare, 178, 'Toei 1–4 km IC fare should match the official ¥178 band for Asakusa → Kuramae')
assert.equal(getFareBetweenStations('424', '429').icFare, 220, 'Toei 5–9 km IC fare should match the official ¥220 band for Roppongi → Tochomae')
assert.equal(getFareBetweenStations('501', '502').icFare, 168, 'Nippori-Toneri Liner 1–2 km IC fare should match the official ¥168 band')
assert.equal(getFareBetweenStations('501', '504').icFare, 231, 'Nippori-Toneri Liner 3–4 km IC fare should match the official ¥231 band')
assert.equal(getFareBetweenStations('601', '602').icFare, 168, 'Toden Arakawa fare with payment_method=0 must still use its official ¥168 IC fare')
assert.equal(getFareBetweenStations('601', '602').paperFare, null, 'payment_method=0 must not be misinterpreted as a paper fare')
assert.equal(getFareBetweenStations('TM-314', 'TM-304').icFare, 178, 'Ningyocho ↔ Roppongi Metro IC fare correction should remain scoped to the explicit station pair')
assert.equal(stationIds.size, stations.length, 'station IDs must be unique')
assert.equal(lineIds.size, lines.length, 'line IDs must be unique')
assert.ok(stations.every((station) => (station.lines || []).every((lineId) => lineIds.has(lineId))), 'every station line must exist')
assert.notEqual(
  routePatternIdentity([
    { from: '118', to: '117', lineId: '1', transfer: false },
    { from: '117', to: '115', lineId: '1', transfer: false },
  ]),
  routePatternIdentity([
    { from: '118', to: '117', lineId: '1', transfer: false },
    { from: '117', to: '116', lineId: '1', transfer: false },
    { from: '116', to: '115', lineId: '1', transfer: false },
  ]),
  'route identity must distinguish different stop sequences that share the same line ID and endpoints',
)
assert.ok(connections.every((connection) => stationIds.has(connection.from) && stationIds.has(connection.to)), 'every ride connection endpoint must exist')
assert.ok(connections.every((connection) => lineIds.has(connection.lineId)), 'every ride connection line must exist')
const tripByIdForConnectionAudit = new Map(trips.map((trip) => [String(trip.id), trip]))
assert.ok(connections.every((connection) => (connection.services || []).every((service) => service.departure && service.arrival)), 'passenger ride connections must not contain untimed service entries')
assert.ok(connections.every((connection) => (connection.services || []).every((service) => {
  const trip = tripByIdForConnectionAudit.get(String(service.tripId))
  return trip && String(trip.routeId) === String(connection.lineId) && String(trip.serviceId) === String(service.serviceId)
})), 'ride connection services must resolve to a trip on the same line and service calendar')
assert.ok(connections.some((connection) => !String(connection.lineId).startsWith('TM-') && (connection.services || []).some((service) => service.skippedStopCount > 0)), 'Toei connections must include passenger-usable ride edges across timed-inaccessible pass-through rows')
assert.equal(audit.sourceCounts.toeiUntimedPassThroughStops, 540, 'the Toei source audit should count 540 blank-time pass-through rows')
assert.equal(audit.sourceCounts.toeiUntimedServiceableStops, 0, 'the Toei source must not contain untimed rows that allow boarding or alighting')
assert.ok(transfers.every((transfer) => stationIds.has(transfer.from) && stationIds.has(transfer.to)), 'every transfer endpoint must exist')
assert.ok(transfers.every((transfer) => transfers.some((reverse) => reverse.from === transfer.to && reverse.to === transfer.from)), 'every transfer must be bidirectional')
assert.equal(audit.transferAudit.unresolvedTransferRefs.length, 0, 'ODPT Toei transfer references should all resolve')
assert.equal(audit.sourceCounts.odptUniqueStationCodes, audit.sourceCounts.metroGtfsStations, 'all unique ODPT station codes should map to GTFS stations')
assert.equal(audit.stationMappingAudit.nameMismatchCount, 0, 'all GTFS station codes should map to matching Japanese station names in ODPT')
assert.equal(audit.metroGraphAudit.stationsReachableFromFirstNode, audit.metroGraphAudit.stationCount, 'every Tokyo Metro station should be reachable in the directed ride/transfer graph')
assert.equal(audit.metroGraphAudit.stationsThatCanReachFirstNode, audit.metroGraphAudit.stationCount, 'every Tokyo Metro station should be able to reach the graph root')
assert.deepEqual(audit.metroGraphAudit.stationsWithoutRideEdges, [], 'every Tokyo Metro station should have at least one ride edge')
assert.ok(trips.every((trip) => lineIds.has(trip.routeId)), 'every trip route should exist')
const serviceIds = new Set(audit && readJson('services.json').calendar.map((service) => service.service_id))
const serviceDateIds = new Set(readJson('services.json').calendarDates.map((service) => service.service_id))
assert.ok(trips.every((trip) => serviceIds.has(trip.serviceId) || serviceDateIds.has(trip.serviceId)), 'every trip service should have a calendar or exception')
assert.ok(trips.every((trip) => (trip.stops || []).every((stop) => stationIds.has(stop.stopId))), 'every trip stop should reference a known station')
assert.ok(trips.every((trip) => (trip.stops || []).length >= 1), 'every trip should have stop records')
assert.ok(transfers.every((transfer) => Number.isFinite(Number(transfer.duration)) && Number(transfer.duration) >= 0), 'every transfer should have a non-negative duration')

// Audited minimum transfer/walk allowances. Values are seconds, and both
// directions must match so departure- and arrival-time searches stay coherent.
const auditedTransferDurations = [
  ['117', '412', 14 * 60, 'Kuramae Asakusa Line ↔ Oedo Line'],
  ['TM-116', 'TM-318', 6 * 60, 'Ueno Ginza Line ↔ Hibiya Line'],
  ['TM-115', 'TM-317', 7 * 60, 'Ueno-hirokoji ↔ Naka-okachimachi'],
  ['TM-115', '410', 3 * 60, 'Ueno-hirokoji ↔ Ueno-okachimachi'],
  ['TM-107', 'TM-306', 7 * 60, 'Toranomon ↔ Toranomon Hills'],
  ['TM-109', 'TM-619', 6 * 60, 'Ginza Ginza Line ↔ Ginza-itchome'],
  ['TM-219', 'TM-619', 6 * 60, 'Ginza Marunouchi Line ↔ Ginza-itchome'],
  ['TM-309', 'TM-619', 6 * 60, 'Ginza Hibiya Line ↔ Ginza-itchome'],
  ['TM-311', 'TM-620', 6 * 60, 'Tsukiji ↔ Shintomicho'],
  ['TM-222', 'TM-512', 6 * 60, 'Awajicho ↔ Shin-ochanomizu'],
  ['TM-710', 'TM-314', 5 * 60, 'Suitengumae ↔ Ningyocho'],
  ['TM-221', 'TM-708', 8 * 60, 'Otemachi Marunouchi Line ↔ Hanzomon Line'],
  ['TM-509', 'TM-618', 5 * 60, 'Hibiya ↔ Yurakucho via Hibiya Line station node'],
  ['TM-308', 'TM-618', 5 * 60, 'Hibiya ↔ Yurakucho via Yurakucho Line station node'],
  ['TM-316', '308', 6 * 60, 'Akihabara ↔ Iwamotocho'],
  ['TM-225', '212', 6 * 60, 'Korakuen Marunouchi Line ↔ Kasuga Mita Line'],
  ['TM-225', '408', 6 * 60, 'Korakuen Marunouchi Line ↔ Kasuga Oedo Line'],
  ['TM-811', '212', 6 * 60, 'Korakuen Namboku Line ↔ Kasuga Mita Line'],
  ['TM-811', '408', 6 * 60, 'Korakuen Namboku Line ↔ Kasuga Oedo Line'],
  ['TM-910', '627', 3 * 60, 'Zoshigaya ↔ Kishibojimmae'],
  ['TM-507', 'TM-106', 6 * 60, 'Kokkai-gijidomae Chiyoda ↔ Tameike-sanno Ginza'],
  ['TM-507', 'TM-806', 6 * 60, 'Kokkai-gijidomae ↔ Tameike-sanno Namboku'],
  ['TM-106', 'TM-217', 6 * 60, 'Tameike-sanno Ginza ↔ Kokkai-gijidomae Marunouchi'],
  ['TM-217', 'TM-806', 6 * 60, 'Kokkai-gijidomae Marunouchi ↔ Tameike-sanno Namboku'],
  ['TM-512', '307', 4 * 60, 'Shin-ochanomizu ↔ Ogawamachi'],
  ['TM-222', '307', 3 * 60, 'Awajicho ↔ Ogawamachi'],
  ['TM-517', '606', 2 * 60, 'Tokyo Metro Machiya ↔ Toden Machiya-ekimae'],
  ['TM-317', '410', 4 * 60, 'Naka-okachimachi ↔ Ueno-okachimachi'],
  ['TM-610', '625', 3 * 60, 'Higashi-Ikebukuro ↔ Higashi-Ikebukuro-yonchome'],
  ['TM-228', 'TM-609', 3 * 60, 'Ikebukuro Marunouchi ↔ Yurakucho'],
  ['TM-816', '616', 2 * 60, 'Metro Oji ↔ Toden Oji-ekimae'],
  ['TM-406', '407', 8 * 60, 'Iidabashi Tozai ↔ Oedo'],
  ['TM-613', '407', 8 * 60, 'Iidabashi Yurakucho ↔ Oedo'],
  ['TM-810', '407', 8 * 60, 'Iidabashi Namboku ↔ Oedo'],
  ['TM-706', 'TM-407', 3 * 60, 'Kudanshita Hanzomon ↔ Tozai'],
  ['TM-706', '305', 3 * 60, 'Kudanshita Hanzomon ↔ Toei Shinjuku'],
  ['TM-212', '302', 3 * 60, 'Shinjuku-sanchome Marunouchi ↔ Toei Shinjuku'],
  ['TM-913', '302', 5 * 60, 'Shinjuku-sanchome Fukutoshin ↔ Toei Shinjuku'],
]
for (const [left, right, expectedSeconds, label] of auditedTransferDurations) {
  const forward = transfers.find((transfer) => transfer.from === left && transfer.to === right)
  const reverse = transfers.find((transfer) => transfer.from === right && transfer.to === left)
  assert.ok(forward && reverse, `${label} should exist in both directions`)
  assert.equal(Number(forward.duration), expectedSeconds, `${label} forward transfer duration should match the audit`)
  assert.equal(Number(reverse.duration), expectedSeconds, `${label} reverse transfer duration should match the audit`)
  assert.equal(forward.durationUnit, 'seconds', `${label} should document seconds as its unit`)
}

// The source feed contains 4,151 untimed stops, all explicitly marked as
// non-boardable and non-alightable. A limited-stop Hibiya trip must connect
// Kasumigaseki directly to Ginza rather than exposing Hibiya as a usable stop.
const expressEdge = connections.find((connection) => connection.from === 'TM-307' && connection.to === 'TM-309' && connection.lineId === 'TM-3')
assert.ok(expressEdge?.services.some((service) => service.tripId === 'TM-30B1743T00' && service.departure === '17:02:00' && service.arrival === '17:06:00' && service.skippedStopCount === 1), 'limited-stop service must skip non-boardable/non-alightable Hibiya stop')
assert.ok(!connections.some((connection) => connection.from === 'TM-307' && connection.to === 'TM-308' && connection.lineId === 'TM-3' && connection.services.some((service) => service.tripId === 'TM-30B1743T00')), 'limited-stop trip must not offer alighting at Hibiya')
assert.ok(!connections.some((connection) => connection.from === 'TM-308' && connection.to === 'TM-309' && connection.lineId === 'TM-3' && connection.services.some((service) => service.tripId === 'TM-30B1743T00')), 'limited-stop trip must not offer boarding at Hibiya')
assert.ok(connections.every((connection) => connection.services.filter((service) => String(service.tripId).startsWith('TM-')).every((service) => service.pickupType !== '1' && service.dropOffType !== '1')), 'Metro ride edges must only allow boarding and alighting at permitted stops')
assert.ok(connections.every((connection) => connection.services.filter((service) => String(service.tripId).startsWith('TM-')).every((service) => Number.isFinite(Number(service.skippedStopCount)) && service.skippedStopCount >= 0)), 'Metro ride service segments must record skipped-stop counts')
assert.equal(audit.sourceCounts.metroUntimedServiceableStops, 0, 'untimed GTFS records must not be boardable/alightable')

const targetDate = { year: 2026, month: 10, day: 13 } // ordinary Tuesday, not a public-holiday exception
const holidayDate = { year: 2026, month: 10, day: 12 }
const weekendDate = { year: 2026, month: 10, day: 17 }
const afterMetroFeed = { year: 2027, month: 3, day: 13 }
const shibuyaGinza = stations.find((station) => station.stationCode === 'G01')
const shinjukuMarunouchi = stations.find((station) => station.stationCode === 'M08')
const shibuyaHanzomon = stations.find((station) => station.stationCode === 'Z01')
const asakusaToei = stations.find((station) => station.operator === 'toei' && station.name === '浅草')
const kuramaeAsakusa = stations.find((station) => station.operator === 'toei' && station.name === '蔵前' && station.lines.includes('1'))
const shinjukuToeiShinjuku = stations.find((station) => station.operator === 'toei' && station.name === '新宿' && station.lines.includes('3'))
assert.ok(shibuyaGinza && shinjukuMarunouchi && shibuyaHanzomon && asakusaToei && kuramaeAsakusa && shinjukuToeiShinjuku, 'regression test stations should exist')

// GTFS times at/after 24:00 belong to the previous service date when viewed
// just after midnight. Friday service at 24:02 must be usable at 00:02 Saturday.
const lateNightOrigin = stations.find((station) => station.id === 'TM-101')
const lateNightDestination = stations.find((station) => station.id === 'TM-102')
assert.ok(lateNightOrigin && lateNightDestination, 'late-night GTFS regression stations should exist')
const lateNightDepartureRoutes = calculateRoutes(lateNightOrigin.id, lateNightDestination.id, 0, weekendDate, 'departure', [])
assert.ok(lateNightDepartureRoutes.length > 0, 'previous service-day late-night trip should be available just after midnight')
assert.equal(lateNightDepartureRoutes[0].departureTime, '00:02', '24:02 GTFS departure should be displayed as 00:02 on the following calendar day')
assert.equal(lateNightDepartureRoutes[0].arrivalTime, '00:04', '24:04 GTFS arrival should be displayed as 00:04 on the following calendar day')
assert.ok(lateNightDepartureRoutes[0].segments.some((segment) => segment.serviceDateOffset === -1), 'late-night route must identify the previous service day')
const lateNightArrivalRoutes = calculateRoutes(lateNightOrigin.id, lateNightDestination.id, 5 * 60, weekendDate, 'arrival', [])
assert.ok(lateNightArrivalRoutes.length > 0, 'arrival search just after midnight should consider the previous service day')
assert.equal(lateNightArrivalRoutes[0].arrivalTime, '00:04', 'arrival-time search should select the late-night trip arriving by 00:05')
assert.ok(lateNightArrivalRoutes[0].segments.some((segment) => segment.serviceDateOffset === -1), 'arrival search must identify the previous service day')

// Arrival-mode search must also allow boarding before midnight on the previous
// calendar day when that trip arrives after midnight (23:58 -> 24:00 in GTFS).
const preMidnightOrigin = stations.find((station) => station.id === 'TM-102')
const postMidnightDestination = stations.find((station) => station.id === 'TM-103')
const crossMidnightArrivalRoutes = calculateRoutes(preMidnightOrigin.id, postMidnightDestination.id, 5 * 60, weekendDate, 'arrival', [])
assert.ok(crossMidnightArrivalRoutes.length > 0, 'arrival search should include a trip boarding before midnight on the previous calendar day')
assert.equal(crossMidnightArrivalRoutes[0].departureTime, '23:58', 'cross-midnight trip should preserve the actual previous-day departure clock time')
assert.equal(crossMidnightArrivalRoutes[0].arrivalTime, '00:00', 'cross-midnight trip should display the arrival clock time on the selected date')
assert.ok(crossMidnightArrivalRoutes[0].departureSeconds < 0, 'cross-midnight route departure should be represented on the previous calendar day')

const departureRoutes = calculateRoutes(shibuyaGinza.id, shinjukuMarunouchi.id, 8 * 3600, targetDate, 'departure', [])
assert.ok(departureRoutes.length > 0, 'Tokyo Metro cross-line departure route should be found')
assert.ok(departureRoutes.every((route) => route.duration >= 0 && route.transfers >= 0), 'departure routes should have non-negative duration/transfer counts')
assert.ok(departureRoutes.every((route) => route.lines.length > 0), 'departure routes should contain line metadata')
assert.equal(departureRoutes[0].fare.icFare, 178, 'Tokyo Metro fare must use the GTFS fare rule for Shibuya to Shinjuku')
assert.equal(departureRoutes[0].fare.paperFare, null, 'paper fare must remain unknown when the feed only provides IC fares')


// Endpoint IDs can be operator/line-specific representations of one physical
// station. Asakusa -> Ueno-hirokoji must start on the Ginza Line platform even
// if the selected Asakusa row is the Toei station node. At 01:11 the result
// should wait for the first available train, not report that wait as journey
// duration or produce transfer detours.
const asakusaMetro = stations.find((station) => station.stationCode === 'G19')
const uenoHirokoji = stations.find((station) => station.stationCode === 'G15')
assert.ok(asakusaMetro && uenoHirokoji, 'Asakusa and Ueno-hirokoji Ginza Line stations should exist')
const firstTrainRoutes = calculateRoutes(asakusaToei.id, uenoHirokoji.id, 1 * 3600 + 11 * 60, weekendDate, 'departure', [])
assert.equal(firstTrainRoutes.length, 1, 'Asakusa -> Ueno-hirokoji should return one genuine direct route')
assert.deepEqual(firstTrainRoutes[0].lines.map((line) => line.id), ['TM-1'], 'Asakusa -> Ueno-hirokoji should use the Ginza Line')
assert.equal(firstTrainRoutes[0].transfers, 0, 'Asakusa -> Ueno-hirokoji should be direct')
assert.ok(firstTrainRoutes[0].departureSeconds >= 1 * 3600 + 11 * 60, 'first train must not depart before the requested time')
assert.equal(firstTrainRoutes[0].departureTime, '05:01', 'the next available Ginza Line departure after 01:11 should be 05:01 for this date/feed')
assert.equal(firstTrainRoutes[0].arrivalTime, '05:08', 'the first-train route should arrive at Ueno-hirokoji at 05:08')
assert.equal(firstTrainRoutes[0].duration, 7, 'journey duration should be 7 minutes, excluding the wait before boarding')

assert.equal(calculateRoutes(asakusaMetro.id, uenoHirokoji.id, 1 * 3600 + 11 * 60, weekendDate, 'departure', [])[0].routeKey, firstTrainRoutes[0].routeKey, 'selecting the Metro or Toei Asakusa station row should resolve to the same route')
assert.ok(calculateRoutes(asakusaToei.id, uenoHirokoji.id, 8 * 3600, weekendDate, 'departure', []).length === 1, 'a daytime direct route should not be padded with transfer alternatives')
assert.ok(departureRoutes.every((route) => route.routeKey), 'every route alternative should have a stable route identity')
assert.equal(new Set(departureRoutes.map((route) => route.routeKey)).size, departureRoutes.length, 'route results must not repeat the same route identity')


const holidayRoutes = calculateRoutes(shibuyaGinza.id, shinjukuMarunouchi.id, 8 * 3600, holidayDate, 'departure', [])
const weekendRoutes = calculateRoutes(shibuyaGinza.id, shinjukuMarunouchi.id, 8 * 3600, weekendDate, 'departure', [])
assert.ok(holidayRoutes.length > 0, 'Tokyo Metro route should use holiday calendar exceptions')
assert.ok(weekendRoutes.length > 0, 'Tokyo Metro route should use weekend calendar service')
const tripById = new Map(trips.map((trip) => [trip.id, trip]))
const selectedMetroServiceIds = (routes) => routes.flatMap((route) => route.segments)
  .filter((segment) => String(segment.tripId || '').startsWith('TM-'))
  .map((segment) => tripById.get(segment.tripId)?.serviceId)
  .filter(Boolean)
assert.ok(selectedMetroServiceIds(holidayRoutes).every((serviceId) => serviceId === 'TM-1'), 'holiday routes should use the GTFS holiday/weekend Metro service')
assert.ok(selectedMetroServiceIds(weekendRoutes).every((serviceId) => serviceId === 'TM-1'), 'weekend routes should use the weekend Metro service')
assert.ok(selectedMetroServiceIds(departureRoutes).every((serviceId) => serviceId === 'TM-0'), 'ordinary weekday routes should use the weekday Metro service')
assert.deepEqual(calculateRoutes(shibuyaGinza.id, shinjukuMarunouchi.id, 8 * 3600, afterMetroFeed, 'departure', []), [], 'Metro routes must not be invented beyond the GTFS feed coverage')

const arrivalRoutes = calculateRoutes(shibuyaGinza.id, shinjukuMarunouchi.id, 9 * 3600, targetDate, 'arrival', [])
assert.ok(arrivalRoutes.length > 0, 'Tokyo Metro cross-line arrival route should be found')
for (let i = 1; i < arrivalRoutes.length; i += 1) {
  assert.ok(arrivalRoutes[i - 1].departureSeconds >= arrivalRoutes[i].departureSeconds, 'arrival-mode results should rank later feasible departures first')
}
assert.ok(arrivalRoutes.every((route) => route.arrivalSeconds <= 9 * 3600), 'arrival-mode routes must arrive by the requested time')

const crossOperatorRoutes = calculateRoutes(kuramaeAsakusa.id, shibuyaGinza.id, 8 * 3600, targetDate, 'departure', [])
assert.ok(crossOperatorRoutes.length > 0, 'Toei-to-Metro route should be found through explicit transfer data from Kuramae')
assert.ok(crossOperatorRoutes[0].transfers >= 1, 'Toei-to-Metro route should count at least one transfer')
assert.ok(crossOperatorRoutes[0].fare.icFare != null, 'mixed Metro/Toei route should calculate fare from each operator fare rule and apply the 70-yen discount')
assert.equal(crossOperatorRoutes[0].fareStatus, 'cross-operator-discount', 'mixed Metro/Toei routes should identify the applied 70-yen transfer discount')

const toeiViaKuramae = calculateRoutes(asakusaToei.id, shinjukuToeiShinjuku.id, 8 * 3600, targetDate, 'departure', [kuramaeAsakusa.id])
const asakusaShinjukuRoutes = calculateRoutes(asakusaToei.id, shinjukuToeiShinjuku.id, 8 * 3600, weekendDate, 'departure', [])
assert.ok(asakusaShinjukuRoutes.length >= 1, 'Asakusa → Shinjuku should return useful route alternatives')
assert.ok(asakusaShinjukuRoutes.length <= 3, 'the public route engine should return no more than three useful alternatives')
const tochomaeToei = stations.find((station) => station.operator === 'toei' && station.name === '都庁前' && station.lines.includes('4'))
const asakusaTochomaeRoutes = calculateRoutes(asakusaToei.id, tochomaeToei.id, 8 * 3600, targetDate, 'departure', [])
const sameToeiLineSequence = asakusaTochomaeRoutes.filter((route) => route.lines.map((line) => line.id).join('>') === '1>4')
assert.ok(sameToeiLineSequence.length > 0, 'Asakusa→Tochomae should offer a Toei Asakusa→Oedo path')
// Test the 14-minute Kuramae transfer using real ride/transfer edges and the
// actual timetable scheduler. Do not require it to appear in the capped public
// result list: candidate ranking can legitimately prefer other connections.
const rawKuramaePath = [
  ...findRidePathOnLine('118', '117', '1'),
  getTransferEdge('117', '412'),
  ...findRidePathOnLine('412', '428', '4'),
]
assert.ok(rawKuramaePath.length > 2 && rawKuramaePath.some((edge) => edge.transfer && edge.from === '117' && edge.to === '412'), 'real graph edges should compose the explicit Kuramae transfer path')
const scheduledKuramaePath = schedulePath(rawKuramaePath, 8 * 3600, targetDate)
assert.ok(scheduledKuramaePath, 'the Kuramae transfer path should have a feasible timetable')
const kuramaeDirectTransferRoute = makeRoute(rawKuramaePath, scheduledKuramaePath, 'kuramae-direct-transfer-test')
assert.equal(kuramaeDirectTransferRoute.transfers, 1, 'Asakusa Line → Oedo Line changing at Kuramae must count as exactly one transfer')
const scheduledKuramaeWalk = scheduledKuramaePath.segments.find((segment) => segment.transfer && segment.from === '117' && segment.to === '412')
assert.ok(scheduledKuramaeWalk, 'scheduled path should include the explicit Kuramae transfer segment')
assert.equal(scheduledKuramaeWalk.arrivalSeconds - scheduledKuramaeWalk.departureSeconds, 14 * 60, 'Kuramae transfer scheduling should enforce a 14-minute minimum')
const walkIndex = scheduledKuramaePath.segments.indexOf(scheduledKuramaeWalk)
const nextKuramaeRide = scheduledKuramaePath.segments.slice(walkIndex + 1).find((segment) => !segment.transfer)
assert.ok(nextKuramaeRide && nextKuramaeRide.selectedService, 'a real next train should be chosen after the transfer allowance')
assert.ok(nextKuramaeRide.departureSeconds >= scheduledKuramaeWalk.arrivalSeconds, 'the next train cannot leave before the transfer allowance has elapsed')
assert.equal(asakusaShinjukuRoutes[0].transfers, 1, 'Asakusa → Shinjuku should prefer a one-transfer route over dominated alternatives')
assert.equal(new Set(asakusaShinjukuRoutes.map((route) => route.routeKey)).size, asakusaShinjukuRoutes.length, 'Asakusa → Shinjuku should not return duplicate physical route identities')
assert.ok(asakusaShinjukuRoutes.every((route) => Number.isFinite(route.transferWalkSeconds) && route.transferWalkSeconds >= 0), 'every route should expose the calculated walking-transfer time')
assert.ok(toeiViaKuramae.length > 0, 'Asakusa → Kuramae → Shinjuku regression route should be found')
assert.ok(toeiViaKuramae.some((route) => route.fare.icFare === 272 && route.lines.every((line) => line.operator === 'toei')), 'a slower all-Toei route should not be discarded merely because a faster mixed-operator route has unknown fare')
assert.ok(toeiViaKuramae.some((route) => route.fare.icFare != null && route.fareStatus === 'cross-operator-discount' && route.lines.some((line) => line.operator === 'tokyometro')), 'mixed-operator alternative should show the calculated fare with the 70-yen discount when both operator fares are available')
const akihabaraHibiya = stations.find((station) => station.stationCode === 'H15')
assert.ok(akihabaraHibiya, 'Hibiya Line Akihabara station should exist')
const mixedOperatorSameEndpoints = calculateRoutes(asakusaToei.id, shinjukuToeiShinjuku.id, 8 * 3600, targetDate, 'departure', [akihabaraHibiya.id])
assert.ok(mixedOperatorSameEndpoints.length > 0, 'a route forced through a Tokyo Metro station should be found between Toei endpoint selections')
assert.ok(mixedOperatorSameEndpoints.every((route) => new Set(route.lines.map((line) => line.operator).filter(Boolean)).size <= 1 || route.fare.icFare == null || route.fareStatus === 'cross-operator-discount'), 'mixed-operator routes must either have a calculated discounted fare or explicitly remain unknown')

const sameComplexTransfer = calculateRoutes(shibuyaGinza.id, shinjukuMarunouchi.id, 8 * 3600, targetDate, 'departure', [])
const routeWithWalkTransfer = sameComplexTransfer.find((route) => route.segments.some((segment) => segment.transfer && segment.durationIsEstimate))
assert.ok(routeWithWalkTransfer, 'a cross-line route should retain an explicit walking-transfer segment')
assert.ok(routeWithWalkTransfer.transfers >= 1, 'walking transfer should count at least once')
assert.ok(routeWithWalkTransfer.segments.some((segment) => segment.transfer && segment.durationIsEstimate), 'walking transfer duration must be labelled as an estimate')

// Fare regression from Yahoo! route search: Asakusa → Ningyocho → Roppongi → Tochomae.
// The Metro Hibiya segment is ¥178 IC, not the stale/misassigned ¥209 GTFS fare rule.
const asakusaNingyochoFare = getFareBetweenStations('118', '114')
const ningyochoRoppongiFare = getFareBetweenStations('TM-314', 'TM-304')
const roppongiTochomaeFare = getFareBetweenStations('424', '429')
assert.equal(asakusaNingyochoFare.icFare, 178, 'Asakusa → Ningyocho Toei Asakusa Line IC fare should be ¥178')
assert.equal(ningyochoRoppongiFare.icFare, 178, 'Ningyocho ↔ Roppongi Tokyo Metro IC fare must be ¥178')
assert.equal(getFareBetweenStations('TM-304', 'TM-314').icFare, 178, 'Roppongi ↔ Ningyocho Tokyo Metro IC fare must be ¥178 in reverse')
assert.equal(roppongiTochomaeFare.icFare, 220, 'Roppongi → Tochomae Toei Oedo IC fare must be ¥220')
assert.equal(asakusaNingyochoFare.icFare + ningyochoRoppongiFare.icFare - 70 + roppongiTochomaeFare.icFare, 506, 'Asakusa → Ningyocho → Roppongi → Tochomae should total ¥506 IC with one ¥70 operator-transfer discount')

const fareRegressionPath = [
  { from: '118', to: '114', lineId: '1', transfer: false },
  { from: '114', to: 'TM-314', lineId: null, transfer: true, duration: 300 },
  { from: 'TM-314', to: 'TM-304', lineId: 'TM-3', transfer: false },
  { from: 'TM-304', to: '424', lineId: null, transfer: true, duration: 300 },
  { from: '424', to: '429', lineId: '4', transfer: false },
]
let fareClock = 8 * 3600
const fareRegressionSchedule = {
  segments: fareRegressionPath.map((edge, index) => {
    const duration = edge.transfer ? edge.duration : 60
    const segment = {
      ...edge,
      selectedService: edge.transfer ? null : { tripId: `FARE-REGRESSION-${index}`, tripShortName: null },
      departureSeconds: fareClock,
      arrivalSeconds: fareClock + duration,
      transfer: Boolean(edge.transfer),
    }
    fareClock += duration
    return segment
  }),
  departureSeconds: 8 * 3600,
  arrivalSeconds: fareClock,
  durationSeconds: fareClock - 8 * 3600,
}
const completeFareRegressionRoute = makeRoute(fareRegressionPath, fareRegressionSchedule, 'fare-regression-506')
assert.equal(completeFareRegressionRoute.fare.icFare, 506, 'makeRoute must return ¥506 for the complete Toei → Metro → Toei itinerary, not only match unit-fare arithmetic')
assert.equal(completeFareRegressionRoute.fareStatus, 'cross-operator-discount', 'the complete multi-operator route should identify its one applied transfer discount')
assert.equal(completeFareRegressionRoute.transfers, 2, 'the complete Asakusa → Ningyocho → Roppongi → Tochomae path should count both physical transfers')

// Validate the 506-yen route on actual graph topology, not just an artificial
// path fixture: Toei Asakusa Line -> Metro Hibiya Line -> Toei Oedo Line.
const actualFarePath = [
  ...findRidePathOnLine('118', '114', '1'),
  getTransferEdge('114', 'TM-314'),
  ...findRidePathOnLine('TM-314', 'TM-304', 'TM-3'),
  getTransferEdge('TM-304', '424'),
  ...findRidePathOnLine('424', '429', '4'),
]
assert.ok(actualFarePath.length > 4, 'the merged real graph should contain all three ride segments and both actual transfer edges')
// Keep fare validation independent of route-candidate caps and timetable
// selection: this schedule fixture uses the exact real ride/transfer graph
// edges but synthetic monotonically increasing times. Timetable feasibility
// is covered separately by the live-route regression cases below.
let actualFareClock = 8 * 3600
const actualFareSchedule = {
  segments: actualFarePath.map((edge, index) => {
    const duration = edge.transfer ? Number(edge.duration) : 60
    const segment = {
      ...edge,
      selectedService: edge.transfer ? null : { tripId: `ACTUAL-FARE-GRAPH-${index}`, tripShortName: null },
      departureSeconds: actualFareClock,
      arrivalSeconds: actualFareClock + duration,
      transfer: Boolean(edge.transfer),
    }
    actualFareClock += duration
    return segment
  }),
  departureSeconds: 8 * 3600,
  arrivalSeconds: actualFareClock,
  durationSeconds: actualFareClock - 8 * 3600,
}
const actualFullFareRoute = makeRoute(actualFarePath, actualFareSchedule, routePatternIdentity(actualFarePath))
assert.equal(actualFullFareRoute.fare.icFare, 506, 'the actual graph path Asakusa → Ningyocho → Roppongi → Tochomae must return ¥506 IC')
assert.equal(actualFullFareRoute.fareStatus, 'cross-operator-discount', 'the actual graph path should identify the Metro/Toei exception')
assert.equal(actualFullFareRoute.lines.map((line) => line.id).join('>'), '1>TM-3>4', 'the ¥506 regression must use Toei Asakusa → Metro Hibiya → Toei Oedo')

// One continuous itinerary receives the Metro↔Toei ¥70 discount once, even
// when the operator sequence alternates Toei → Metro → Toei → Metro.
// Transfer links in this fixture are intentionally synthetic; fare segments
// use real station pairs so the test isolates multi-alternation fare accounting.
const repeatedCrossingFarePath = [
  { from: '118', to: '114', lineId: '1', transfer: false },
  { from: '114', to: 'TM-314', lineId: null, transfer: true, duration: 300 },
  { from: 'TM-314', to: 'TM-304', lineId: 'TM-3', transfer: false },
  { from: 'TM-304', to: '424', lineId: null, transfer: true, duration: 300 },
  { from: '424', to: '429', lineId: '4', transfer: false },
  { from: '429', to: 'TM-314', lineId: null, transfer: true, duration: 300 },
  { from: 'TM-314', to: 'TM-304', lineId: 'TM-3', transfer: false },
]
let repeatedFareClock = 9 * 3600
const repeatedCrossingSchedule = {
  segments: repeatedCrossingFarePath.map((edge, index) => {
    const duration = edge.transfer ? Number(edge.duration) : 60
    const segment = {
      ...edge,
      selectedService: edge.transfer ? null : { tripId: `REPEATED-CROSSING-${index}`, tripShortName: null },
      departureSeconds: repeatedFareClock,
      arrivalSeconds: repeatedFareClock + duration,
      transfer: Boolean(edge.transfer),
    }
    repeatedFareClock += duration
    return segment
  }),
  departureSeconds: 9 * 3600,
  arrivalSeconds: repeatedFareClock,
  durationSeconds: repeatedFareClock - 9 * 3600,
}
const repeatedCrossingRoute = makeRoute(repeatedCrossingFarePath, repeatedCrossingSchedule, 'repeated-crossing-fare-policy')
assert.equal(repeatedCrossingRoute.fare.icFare, 684, 'Toei → Metro → Toei → Metro must sum ¥178 + ¥178 + ¥220 + ¥178 and subtract the ¥70 discount once (¥684), not three times')
assert.equal(repeatedCrossingRoute.fareStatus, 'cross-operator-discount', 'repeated Metro/Toei alternation must use the supported combined-fare status')
assert.equal(repeatedCrossingRoute.transfers, 3, 'the repeated-crossing fare fixture should contain three business/operator changes')

// A route that combines Toei/Metro with any third operator must not add those
// fares together or apply the Metro/Toei exception to the whole multi-operator trip.
const unsupportedMixedPath = [
  { from: '118', to: '114', lineId: '1', transfer: false },
  { from: '114', to: 'TM-314', lineId: null, transfer: true, duration: 300 },
  { from: 'TM-314', to: 'TM-304', lineId: 'TM-3', transfer: false },
  { from: 'TM-304', to: '424', lineId: null, transfer: true, duration: 300 },
  { from: '424', to: '429', lineId: '4', transfer: false },
  { from: '429', to: '101', lineId: 'TEST-JR', transfer: false },
]
let unsupportedClock = 8 * 3600
const unsupportedMixedSchedule = {
  segments: unsupportedMixedPath.map((edge, index) => {
    const duration = edge.transfer ? edge.duration : 60
    const segment = {
      ...edge,
      selectedService: edge.transfer ? null : { tripId: `UNSUPPORTED-MIXED-${index}`, tripShortName: null },
      departureSeconds: unsupportedClock,
      arrivalSeconds: unsupportedClock + duration,
      transfer: Boolean(edge.transfer),
    }
    unsupportedClock += duration
    return segment
  }),
  departureSeconds: 8 * 3600,
  arrivalSeconds: unsupportedClock,
  durationSeconds: unsupportedClock - 8 * 3600,
}
const unsupportedMixedRoute = makeRoute(unsupportedMixedPath, unsupportedMixedSchedule, 'unsupported-mixed-operator-test')
assert.equal(unsupportedMixedRoute.fare.icFare, null, 'a route containing a third operator must not sum Toei/Metro/third-party fares')
assert.equal(unsupportedMixedRoute.fare.paperFare, null, 'a route containing a third operator must leave paper fare unknown')
assert.equal(unsupportedMixedRoute.fareStatus, 'cross-operator-unsupported', 'a route with unsupported mixed operators should use the explicit unknown-fare status')

const unknownOperatorPath = [{ from: '118', to: '114', lineId: 'UNMAPPED-OPERATOR', transfer: false }]
const unknownOperatorSchedule = {
  segments: [{ ...unknownOperatorPath[0], selectedService: { tripId: 'UNKNOWN-OP' }, departureSeconds: 0, arrivalSeconds: 60, transfer: false }],
  departureSeconds: 0,
  arrivalSeconds: 60,
  durationSeconds: 60,
}
const unknownOperatorRoute = makeRoute(unknownOperatorPath, unknownOperatorSchedule, 'unknown-operator-fare')
assert.equal(unknownOperatorRoute.fare.icFare, null, 'an unmapped operator must not be presented as a ¥0 known fare')
assert.equal(unknownOperatorRoute.fare.paperFare, null, 'an unmapped operator must leave paper fare unknown too')

const implicitLineChangePath = [
  { from: '118', to: '117', lineId: '1', transfer: false },
  { from: '117', to: '116', lineId: '4', transfer: false },
]
const implicitLineChangeSchedule = {
  segments: [
    { ...implicitLineChangePath[0], selectedService: { tripId: 'IMPLICIT-A' }, departureSeconds: 0, arrivalSeconds: 60, transfer: false },
    { ...implicitLineChangePath[1], selectedService: { tripId: 'IMPLICIT-B' }, departureSeconds: 360, arrivalSeconds: 420, transfer: false },
  ],
  departureSeconds: 0,
  arrivalSeconds: 420,
  durationSeconds: 420,
}
const implicitLineChangeRoute = makeRoute(implicitLineChangePath, implicitLineChangeSchedule, 'implicit-line-change')
assert.equal(implicitLineChangeRoute.transferWalkSeconds, 300, 'implicit line changes must report the same 5-minute fallback allowance that is included in scheduled duration')

const toeiFare = calculateRoutes(asakusaToei.id, kuramaeAsakusa.id, 8 * 3600, targetDate, 'departure', [])
assert.ok(toeiFare.length > 0 && toeiFare[0].fare.icFare != null, 'same-operator Toei fare should resolve from fare zones')
const metroFare = calculateRoutes(shibuyaGinza.id, stations.find((station) => station.stationCode === 'G02').id, 8 * 3600, targetDate, 'departure', [])
assert.ok(metroFare.length > 0, 'same-line Metro route should be found')
assert.ok(metroFare.every((route) => route.transfers === 0), 'direct alternatives should not include unnecessary transfer detours')
assert.equal(new Set(metroFare.map((route) => route.lines.map((line) => line.id).join('>'))).size, metroFare.length, 'direct alternatives should have distinct line patterns')
assert.ok(metroFare.every((route) => route.fare.icFare === 178), 'same-operator Metro fares should resolve from GTFS fare zones')
const longMetroFare = calculateRoutes(shibuyaGinza.id, stations.find((station) => station.stationCode === 'G19').id, 8 * 3600, targetDate, 'departure', [])
assert.ok(longMetroFare.length > 0, 'longer same-line Metro route should be found')
assert.ok(longMetroFare.some((route) => route.transfers === 0 && route.fare.icFare === 252), 'longer Tokyo Metro trip should preserve its direct route with the matching GTFS IC fare band')

// Dominated routes must not be returned just to fill the result list.
const rankingFixtures = [
  { routeKey: 'A', duration: 34, transfers: 1, fare: { icFare: 272 }, arrivalSeconds: 8 * 3600 + 34 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'B', duration: 34, transfers: 2, fare: { icFare: 272 }, arrivalSeconds: 8 * 3600 + 34 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'C', duration: 34, transfers: 3, fare: { icFare: 272 }, arrivalSeconds: 8 * 3600 + 34 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'D', duration: 31, transfers: 2, fare: { icFare: 272 }, arrivalSeconds: 8 * 3600 + 31 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'E', duration: 35, transfers: 0, fare: { icFare: 252 }, arrivalSeconds: 8 * 3600 + 35 * 60, departureSeconds: 8 * 3600 },
]
const usefulFixtures = paretoRoutes(rankingFixtures)
assert.deepEqual(usefulFixtures.map((route) => route.routeKey).sort(), ['A', 'D', 'E'], 'strict Pareto filtering should remove dominated routes while preserving the fastest-versus-fewer-transfers trade-off')
assert.equal(sortRoutes(usefulFixtures, 'fastest')[0].routeKey, 'D', 'fastest tab must choose the lowest duration')
assert.equal(sortRoutes(usefulFixtures)[0].routeKey, 'D', 'fastest should be the default sort order')
assert.equal(sortRoutes(usefulFixtures, 'fewest-transfers')[0].routeKey, 'E', 'fewest-transfers tab must choose the zero-transfer route')
assert.equal(sortRoutes(usefulFixtures, 'cheapest')[0].routeKey, 'E', 'cheapest tab must choose the lowest known fare')
const knownVsUnknownFare = paretoRoutes([
  { routeKey: 'FAST_UNKNOWN', duration: 30, transfers: 1, fare: { icFare: null } },
  { routeKey: 'SLOW_KNOWN', duration: 32, transfers: 1, fare: { icFare: 272 } },
])
assert.deepEqual(knownVsUnknownFare.map((route) => route.routeKey).sort(), ['FAST_UNKNOWN', 'SLOW_KNOWN'], 'unknown fare must not dominate a route with a known fare')
assert.equal(sortRoutes(knownVsUnknownFare, 'cheapest')[0].routeKey, 'SLOW_KNOWN', 'cheapest tab should prefer a verifiable fare over an unknown one')
const marginalTimeSaving = paretoRoutes([
  { routeKey: 'THREE_TRANSFERS_40', duration: 40, transfers: 3, transferWalkSeconds: 0, fare: { icFare: 400 } },
  { routeKey: 'ONE_TRANSFER_42', duration: 42, transfers: 1, transferWalkSeconds: 0, fare: { icFare: 400 } },
])
assert.deepEqual(marginalTimeSaving.map((route) => route.routeKey).sort(), ['ONE_TRANSFER_42', 'THREE_TRANSFERS_40'], 'the shared candidate set must preserve the absolute fastest route even when a simpler alternative is only two minutes slower')
assert.equal(sortRoutes(marginalTimeSaving, 'fastest')[0].routeKey, 'THREE_TRANSFERS_40', 'fastest sorting must retain and rank the actual 40-minute route first')
assert.equal(sortRoutes(marginalTimeSaving, 'fewest-transfers')[0].routeKey, 'ONE_TRANSFER_42', 'fewest-transfers sorting can prefer the simpler 42-minute route without deleting the fastest alternative')
const walkingDominance = paretoRoutes([
  { routeKey: 'WALKING_TRANSFER', duration: 24, transfers: 1, transferWalkSeconds: 360, fare: { icFare: 178 } },
  { routeKey: 'SAME_STATION_TRANSFER', duration: 24, transfers: 1, transferWalkSeconds: 0, fare: { icFare: 178 } },
])
assert.deepEqual(walkingDominance.map((route) => route.routeKey), ['SAME_STATION_TRANSFER'], 'when time, transfer count, and fare are equal, a route with less walking should be preferred')
const sameLineNearDuplicates = paretoRoutes([
  { routeKey: 'TRANSFER_AT_NINGYOCHO', duration: 31, transfers: 1, transferWalkSeconds: 180, fare: { icFare: 328 }, lines: [{ id: 'TM-1' }, { id: 'TM-4' }] },
  { routeKey: 'TRANSFER_AT_ANOTHER_STATION', duration: 32, transfers: 1, transferWalkSeconds: 180, fare: { icFare: 328 }, lines: [{ id: 'TM-1' }, { id: 'TM-4' }] },
])
assert.deepEqual(sameLineNearDuplicates.map((route) => route.routeKey), ['TRANSFER_AT_NINGYOCHO'], 'same line sequence with identical fare, transfers, and walking should keep only the faster route when the difference is one minute')
const meaningfulSameLineAlternative = paretoRoutes([
  { routeKey: 'FAST_SAME_LINES', duration: 31, transfers: 1, transferWalkSeconds: 300, fare: { icFare: 328 }, lines: [{ id: 'TM-1' }, { id: 'TM-4' }] },
  { routeKey: 'LESS_WALK_SAME_LINES', duration: 32, transfers: 1, transferWalkSeconds: 0, fare: { icFare: 328 }, lines: [{ id: 'TM-1' }, { id: 'TM-4' }] },
])
assert.equal(meaningfulSameLineAlternative.length, 2, 'same line sequence with materially less walking remains a meaningful alternative')
const distinctSameLineBranches = paretoRoutes([
  { routeKey: 'BRANCH_ABC', duration: 30, transfers: 1, transferWalkSeconds: 180, fare: { icFare: 300 }, lines: [{ id: 'G' }, { id: 'H' }], segments: [
    { lineId: 'G', from: { id: 'A' }, to: { id: 'B' } },
    { lineId: 'G', from: { id: 'B' }, to: { id: 'C' } },
    { lineId: null, transfer: true, from: { id: 'C' }, to: { id: 'X' } },
    { lineId: 'H', from: { id: 'X' }, to: { id: 'D' } },
  ] },
  { routeKey: 'BRANCH_AXC', duration: 31, transfers: 1, transferWalkSeconds: 0, fare: { icFare: 300 }, lines: [{ id: 'G' }, { id: 'H' }], segments: [
    { lineId: 'G', from: { id: 'A' }, to: { id: 'X1' } },
    { lineId: 'G', from: { id: 'X1' }, to: { id: 'C' } },
    { lineId: null, transfer: true, from: { id: 'C' }, to: { id: 'Y' } },
    { lineId: 'H', from: { id: 'Y' }, to: { id: 'D' } },
  ] },
])
assert.equal(distinctSameLineBranches.length, 2, 'routes with genuinely different in-line station topology should not be near-deduplicated merely because line IDs match')
const arrivalModeSimilarRoutes = paretoRoutes([
  { routeKey: 'ARRIVE_EARLIER_DEPART', duration: 30, transfers: 1, transferWalkSeconds: 0, fare: { icFare: 272 }, departureSeconds: 8 * 3600, arrivalSeconds: 8 * 3600 + 30 * 60, lines: [{ id: 'A' }, { id: 'B' }] },
  { routeKey: 'ARRIVE_LATER_DEPART', duration: 31, transfers: 1, transferWalkSeconds: 0, fare: { icFare: 272 }, departureSeconds: 8 * 3600 + 10 * 60, arrivalSeconds: 8 * 3600 + 41 * 60, lines: [{ id: 'A' }, { id: 'B' }] },
], 'arrival')
assert.deepEqual(arrivalModeSimilarRoutes.map((route) => route.routeKey), ['ARRIVE_LATER_DEPART'], 'arrival-time search should prefer the latest departure among near-identical itineraries when all other useful metrics match')
const samePatternArrivalInstances = paretoRoutes([
  { routeKey: 'SAME_PATTERN', duration: 29, transfers: 1, transferWalkSeconds: 0, fare: { icFare: 272 }, departureSeconds: 8 * 3600, arrivalSeconds: 8 * 3600 + 29 * 60 },
  { routeKey: 'SAME_PATTERN', duration: 31, transfers: 1, transferWalkSeconds: 0, fare: { icFare: 272 }, departureSeconds: 8 * 3600 + 5 * 60, arrivalSeconds: 8 * 3600 + 36 * 60 },
], 'arrival')
assert.equal(samePatternArrivalInstances[0].departureSeconds, 8 * 3600 + 5 * 60, 'arrival-time search should keep the latest departure when duplicate route patterns have different schedules')
const samePhysicalPathDuplicates = paretoRoutes([
  { duration: 30, transfers: 1, fare: { icFare: 272 }, segments: [{ lineId: 'G', from: { id: 'A' }, to: { id: 'B' } }] },
  { duration: 30, transfers: 1, fare: { icFare: 272 }, segments: [{ lineId: 'G', from: { id: 'A' }, to: { id: 'B' } }] },
])
assert.equal(samePhysicalPathDuplicates.length, 1, 'identical physical paths should be deduplicated even without a precomputed routeKey')
const unknownFareTradeoff = paretoRoutes([
  { routeKey: 'UNKNOWN_FAST', duration: 30, transfers: 3, transferWalkSeconds: 0, fare: { icFare: null } },
  { routeKey: 'KNOWN_SIMPLE', duration: 32, transfers: 1, transferWalkSeconds: 0, fare: { icFare: 272 } },
])
assert.equal(unknownFareTradeoff.length, 2, 'unknown fares must not be treated as equal or more expensive when applying transfer-complexity pruning')
const knownFareClearlyBetterThanUnknown = paretoRoutes([
  { routeKey: 'KNOWN_FAST_SIMPLE', duration: 20, transfers: 0, transferWalkSeconds: 0, fare: { icFare: 200 } },
  { routeKey: 'UNKNOWN_SLOW_COMPLEX', duration: 21, transfers: 2, transferWalkSeconds: 0, fare: { icFare: null } },
])
assert.equal(knownFareClearlyBetterThanUnknown.length, 1, 'a known-fare route that is strictly faster, has fewer transfers, and no more walking may prune an unpriced detour')
assert.equal(selectUsefulRoutes([], 'departure', 0).length, 0, 'maxResults=0 must return no routes')
const tradeoffFixtures = [
  { routeKey: 'T1', duration: 20, transfers: 7, fare: { icFare: 280 }, arrivalSeconds: 8 * 3600 + 20 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'T2', duration: 21, transfers: 6, fare: { icFare: 260 }, arrivalSeconds: 8 * 3600 + 21 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'T3', duration: 22, transfers: 5, fare: { icFare: 240 }, arrivalSeconds: 8 * 3600 + 22 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'T4', duration: 23, transfers: 4, fare: { icFare: 220 }, arrivalSeconds: 8 * 3600 + 23 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'T5', duration: 24, transfers: 3, fare: { icFare: 230 }, arrivalSeconds: 8 * 3600 + 24 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'T6', duration: 25, transfers: 2, fare: { icFare: 250 }, arrivalSeconds: 8 * 3600 + 25 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'T7', duration: 26, transfers: 1, fare: { icFare: 270 }, arrivalSeconds: 8 * 3600 + 26 * 60, departureSeconds: 8 * 3600 },
  { routeKey: 'T8', duration: 27, transfers: 0, fare: { icFare: 290 }, arrivalSeconds: 8 * 3600 + 27 * 60, departureSeconds: 8 * 3600 },
]
const cappedTradeoffs = selectUsefulRoutes(tradeoffFixtures, 'departure', 4)
assert.ok(cappedTradeoffs.some((route) => route.routeKey === 'T1'), 'visible candidates should reserve the absolute fastest route even if it has more transfers')
assert.ok(cappedTradeoffs.some((route) => route.routeKey === 'T8'), 'visible candidates must retain the fewest-transfers winner')
assert.ok(cappedTradeoffs.some((route) => route.routeKey === 'T4'), 'visible candidates must retain the cheapest winner')
assert.ok(cappedTradeoffs.length <= 4, 'useful-route selection must never exceed maxResults')
assert.ok(selectUsefulRoutes(tradeoffFixtures, 'departure').length <= 3, 'default useful-route selection must cap displayed alternatives at three')
const arrivalCapFixtures = [
  { routeKey: 'EARLY', duration: 20, transfers: 0, fare: { icFare: 200 }, departureSeconds: 8 * 3600, arrivalSeconds: 8 * 3600 + 20 * 60 },
  { routeKey: 'LATE', duration: 21, transfers: 1, fare: { icFare: 220 }, departureSeconds: 8 * 3600 + 15 * 60, arrivalSeconds: 8 * 3600 + 36 * 60 },
  { routeKey: 'CHEAP', duration: 24, transfers: 2, fare: { icFare: 150 }, departureSeconds: 8 * 3600 + 5 * 60, arrivalSeconds: 8 * 3600 + 29 * 60 },
  { routeKey: 'FEWEST', duration: 23, transfers: 0, fare: { icFare: 250 }, departureSeconds: 8 * 3600 + 1 * 60, arrivalSeconds: 8 * 3600 + 24 * 60 },
]
const cappedArrival = selectUsefulRoutes(arrivalCapFixtures, 'arrival', 2)
assert.equal(cappedArrival.length, 2, 'arrival-mode selection must respect maxResults')
assert.ok(cappedArrival.some((route) => route.routeKey === 'EARLY'), 'arrival-mode selection should keep the fastest candidate')
assert.ok(cappedArrival.some((route) => route.routeKey === 'CHEAP'), 'arrival-mode selection should preserve the cheapest candidate when capacity allows')

for (const [label, routeList] of Object.entries({
  departureRoutes, firstTrainRoutes, holidayRoutes, weekendRoutes, arrivalRoutes,
  crossOperatorRoutes, toeiViaKuramae, asakusaShinjukuRoutes, asakusaTochomaeRoutes,
  lateNightDepartureRoutes, lateNightArrivalRoutes, crossMidnightArrivalRoutes,
})) {
  assert.ok(routeList.length <= 3, `${label} should contain at most three displayed route alternatives`)
}

const appSource = fs.readFileSync(path.join(rootPath, 'src/App.jsx'), 'utf8')
assert.ok(!appSource.includes('✨ 추천순'), 'the visible Recommended tab should be removed')
assert.ok(appSource.includes("useState('fastest')"), 'fastest should be the default UI sort mode')
assert.ok(appSource.includes('window.localStorage.setItem(') && appSource.includes('Searching still succeeds when browser storage is blocked or full.'), 'recent-search persistence failure must not interrupt a successful route search')
assert.ok(appSource.includes("setExpandedRoute(null)"), 'expanded route state should be reset when search/sort context changes')
assert.ok(appSource.includes("setTimeMode('arrival')") && appSource.includes('setSearched(false)'), 'changing departure/arrival mode should not leave stale routes displayed')
const routeInfoStart = appSource.indexOf('className="route-info"')
const durationLabelIndex = appSource.indexOf('소요시간', routeInfoStart)
const transferSummaryIndex = appSource.indexOf('환승 횟수 및 이동시간', routeInfoStart)
const fareLabelIndex = appSource.indexOf('운임', transferSummaryIndex)
assert.ok(transferSummaryIndex > durationLabelIndex && fareLabelIndex > transferSummaryIndex, 'route card metrics should appear in the order duration, transfer count plus transfer time, and fare')
assert.ok(appSource.includes('currentRoute.transferWalkSeconds > 0'), 'route cards should continue to expose transfer-connection time inside the combined transfer metric')
assert.ok(fs.readFileSync(path.join(rootPath, 'src/index.css'), 'utf8').includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), 'route summary should use three columns')
assert.ok(fs.readFileSync(path.join(rootPath, 'src/index.css'), 'utf8').includes('font-size: 11px;'), 'pass-through station names should use compact typography')
const routePathSource = fs.readFileSync(path.join(rootPath, 'src/RoutePath.jsx'), 'utf8')
assert.ok(routePathSource.includes('중간역 {foldGroupStartingHere.count}개 펼치기'), 'long same-line segments should expose a pass-through station expand control')
assert.ok(routePathSource.includes('중간역 접기'), 'expanded pass-through station groups should expose a collapse control')
assert.ok(routePathSource.includes('aria-expanded="false"') && routePathSource.includes('aria-expanded="true"'), 'pass-through station controls should expose their expanded state')
assert.ok(routePathSource.includes('intermediateCount < 2'), 'only groups with at least two hidden pass-through stations should be foldable')

console.log(JSON.stringify({
  status: 'PASS',
  data: {
    stations: stations.length,
    lines: lines.length,
    trips: trips.length,
    connections: connections.length,
    transfers: transfers.length,
    fareRules: fares.rules.length,
    metroUntimedPassThroughStops: audit.sourceCounts.metroUntimedPassThroughStops,
    metroUntimedServiceableStops: audit.sourceCounts.metroUntimedServiceableStops,
    toeiUntimedPassThroughStops: audit.sourceCounts.toeiUntimedPassThroughStops,
    toeiUntimedServiceableStops: audit.sourceCounts.toeiUntimedServiceableStops,
  },
  routes: {
    metroDeparture: departureRoutes.map((route) => ({ duration: route.duration, transfers: route.transfers, departureTime: route.departureTime, arrivalTime: route.arrivalTime })),
    asakusaToUenoHirokojiFirstTrain: firstTrainRoutes.map((route) => ({ duration: route.duration, transfers: route.transfers, departureTime: route.departureTime, arrivalTime: route.arrivalTime, lines: route.lines.map((line) => line.id) })),
    metroArrival: arrivalRoutes.map((route) => ({ duration: route.duration, transfers: route.transfers, departureTime: route.departureTime, arrivalTime: route.arrivalTime })),
    overnightDeparture: lateNightDepartureRoutes[0] && { departureTime: lateNightDepartureRoutes[0].departureTime, arrivalTime: lateNightDepartureRoutes[0].arrivalTime, serviceDateOffset: lateNightDepartureRoutes[0].segments.find((segment) => segment.tripId)?.serviceDateOffset },
    overnightArrival: lateNightArrivalRoutes[0] && { departureTime: lateNightArrivalRoutes[0].departureTime, arrivalTime: lateNightArrivalRoutes[0].arrivalTime, serviceDateOffset: lateNightArrivalRoutes[0].segments.find((segment) => segment.tripId)?.serviceDateOffset },
    crossMidnightArrival: crossMidnightArrivalRoutes[0] && { departureTime: crossMidnightArrivalRoutes[0].departureTime, arrivalTime: crossMidnightArrivalRoutes[0].arrivalTime, departureDayOffset: crossMidnightArrivalRoutes[0].segments.find((segment) => segment.tripId)?.departureDayOffset },
    metroGraphAudit: audit.metroGraphAudit,
    toeiToMetro: crossOperatorRoutes[0] && { duration: crossOperatorRoutes[0].duration, transfers: crossOperatorRoutes[0].transfers, departureTime: crossOperatorRoutes[0].departureTime, arrivalTime: crossOperatorRoutes[0].arrivalTime },
    toeiViaKuramae: toeiViaKuramae[0] && { duration: toeiViaKuramae[0].duration, transfers: toeiViaKuramae[0].transfers, departureTime: toeiViaKuramae[0].departureTime, arrivalTime: toeiViaKuramae[0].arrivalTime },
    kuramaeDirectTransfer: { duration: kuramaeDirectTransferRoute.duration, transfers: kuramaeDirectTransferRoute.transfers, lines: kuramaeDirectTransferRoute.lines.map((line) => line.id), transferDurationSeconds: scheduledKuramaeWalk.arrivalSeconds - scheduledKuramaeWalk.departureSeconds },
    sameComplexTransfer: sameComplexTransfer[0] && { duration: sameComplexTransfer[0].duration, transfers: sameComplexTransfer[0].transfers },
    metroFare: metroFare[0]?.fare,
    actualAsakusaNingyochoRoppongiTochomaeFare: { icFare: actualFullFareRoute.fare.icFare, fareStatus: actualFullFareRoute.fareStatus, lines: actualFullFareRoute.lines.map((line) => line.id), note: 'real graph edges with synthetic monotonic timestamps; fare accounting only' },
    unsupportedMixedOperatorFare: { fare: unsupportedMixedRoute.fare, fareStatus: unsupportedMixedRoute.fareStatus },
    longMetroFare: longMetroFare.map((route) => ({ lines: route.lines.map((line) => line.id), duration: route.duration, transfers: route.transfers, fare: route.fare })),
    asakusaShinjuku: asakusaShinjukuRoutes.map((route) => ({ duration: route.duration, transfers: route.transfers, fare: route.fare, lines: route.lines.map((line) => line.id) })),
    asakusaTochomae: asakusaTochomaeRoutes.map((route) => ({ duration: route.duration, transfers: route.transfers, fare: route.fare.icFare, transferWalkSeconds: route.transferWalkSeconds, lines: route.lines.map((line) => line.id) })),
    holidayRoutes: holidayRoutes.length,
    weekendRoutes: weekendRoutes.length,
    toeiFare: toeiFare[0]?.fare,
  },
}, null, 2))
} finally {
  fs.rmSync(tempEnginePath, { force: true })
}
