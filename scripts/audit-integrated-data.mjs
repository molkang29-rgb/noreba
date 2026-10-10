import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const processedDir = path.join(root, 'data/processed')
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(processedDir, name), 'utf8'))
const stations = readJson('stations.json')
const lines = readJson('lines.json')
const trips = readJson('trips.json')
const connections = readJson('connections.json')
const transfers = readJson('transfers.json')
const fares = readJson('fares.json')
const services = readJson('services.json')
const meta = readJson('meta.json')
const audit = readJson('metro-integration-audit.json')

const lineById = new Map(lines.map((item) => [String(item.id), item]))
const tripById = new Map(trips.map((item) => [String(item.id), item]))
const fareById = new Map(fares.attributes.map((item) => [String(item.fare_id), item]))
const stationIds = new Set(stations.map((item) => String(item.id)))
const lineIds = new Set(lines.map((item) => String(item.id)))
const tripIds = new Set(trips.map((item) => String(item.id)))
const fareZoneIds = new Set(stations.flatMap((item) => [String(item.id), ...(item.zoneId == null ? [] : [String(item.zoneId)])]))

function countBy(items, getKey) {
  const result = {}
  for (const item of items) {
    const key = String(getKey(item) ?? 'unknown')
    result[key] = (result[key] || 0) + 1
  }
  return result
}
function reachability(startId, adjacency) {
  const seen = new Set([String(startId)])
  const queue = [String(startId)]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of adjacency.get(queue[cursor]) || []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

// Referential integrity of the merged graph.
assert.equal(stationIds.size, stations.length, 'station IDs must be unique')
assert.equal(lineIds.size, lines.length, 'line IDs must be unique')
assert.equal(tripIds.size, trips.length, 'trip IDs must be unique')
assert.equal(fareById.size, fares.attributes.length, 'fare attribute IDs must be unique')
assert.ok(stations.every((station) => Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lon))), 'all stations must have coordinates')
assert.ok(stations.every((station) => String(station.korean || '').trim().length > 0), 'every integrated station must have a Korean display name')
assert.equal(audit.stationLocalizationAudit?.totalStations, stations.length, 'station localization audit must match the integrated station count')
assert.deepEqual(audit.stationLocalizationAudit?.stationsMissingKorean, [], 'the generated integration audit must report no stations missing Korean labels')
assert.ok(stations.every((station) => (station.lines || []).every((lineId) => lineIds.has(String(lineId)))), 'every station line reference must exist')
assert.ok(lines.every((line) => stations.some((station) => (station.lines || []).map(String).includes(String(line.id)))), 'every line must have at least one station')
assert.ok(trips.every((trip) => lineIds.has(String(trip.routeId))), 'every trip route must exist')
assert.ok(trips.every((trip) => (trip.stops || []).length > 0 && trip.stops.every((stop) => stationIds.has(String(stop.stopId)))), 'trip stops must reference known stations')
const calendarIds = new Set((services.calendar || []).map((row) => String(row.service_id)))
const calendarExceptionIds = new Set((services.calendarDates || []).map((row) => String(row.service_id)))
assert.ok(trips.every((trip) => calendarIds.has(String(trip.serviceId)) || calendarExceptionIds.has(String(trip.serviceId))), 'every trip service must have a calendar or exception')

let blankRideServiceTimes = 0
let danglingRideTripRefs = 0
let mismatchedRideTripRefs = 0
let passThroughServiceSegments = 0
const rideConnectionsByOperator = { tokyometro: 0, toei: 0, unknown: 0 }
const rideServicesByOperator = { tokyometro: 0, toei: 0, unknown: 0 }
const passThroughConnectionsByOperator = { tokyometro: 0, toei: 0, unknown: 0 }
for (const connection of connections) {
  assert.ok(stationIds.has(String(connection.from)) && stationIds.has(String(connection.to)), `connection endpoint missing: ${connection.id}`)
  const line = lineById.get(String(connection.lineId))
  assert.ok(line, `connection line missing: ${connection.lineId}`)
  const operator = ['tokyometro', 'toei'].includes(line.operator) ? line.operator : 'unknown'
  rideConnectionsByOperator[operator] += 1
  let hasPassThrough = false
  for (const service of connection.services || []) {
    rideServicesByOperator[operator] += 1
    if (!service.departure || !service.arrival) blankRideServiceTimes += 1
    if (Number(service.skippedStopCount) > 0) {
      passThroughServiceSegments += 1
      hasPassThrough = true
    }
    const trip = tripById.get(String(service.tripId))
    if (!trip) danglingRideTripRefs += 1
    else if (String(trip.routeId) !== String(connection.lineId) || String(trip.serviceId) !== String(service.serviceId)) mismatchedRideTripRefs += 1
  }
  if (hasPassThrough) passThroughConnectionsByOperator[operator] += 1
}
assert.equal(blankRideServiceTimes, 0, 'ride-service entries may not have blank arrival/departure times')
assert.equal(danglingRideTripRefs, 0, 'ride-service entries must reference existing trips')
assert.equal(mismatchedRideTripRefs, 0, 'ride-service trip route/service must match its connection')

let invalidTransferEndpoints = 0
let missingReverseTransfers = 0
let reverseDurationMismatches = 0
for (const transfer of transfers) {
  if (!stationIds.has(String(transfer.from)) || !stationIds.has(String(transfer.to))) invalidTransferEndpoints += 1
  assert.ok(Number.isFinite(Number(transfer.duration)) && Number(transfer.duration) >= 0, 'transfer duration must be non-negative')
  const reverse = transfers.find((item) => String(item.from) === String(transfer.to) && String(item.to) === String(transfer.from))
  if (!reverse) missingReverseTransfers += 1
  else if (Number(reverse.duration) !== Number(transfer.duration)) reverseDurationMismatches += 1
}
assert.equal(invalidTransferEndpoints, 0, 'transfer endpoints must exist')
assert.equal(missingReverseTransfers, 0, 'transfers must have reverse edges')
assert.equal(reverseDurationMismatches, 0, 'both directions of each transfer should use the same duration')

assert.ok(fares.rules.every((rule) => fareById.has(String(rule.fare_id))), 'every fare rule must refer to a fare attribute')
const rulesWithUnknownZones = fares.rules.filter((rule) => !fareZoneIds.has(String(rule.origin_id)) || !fareZoneIds.has(String(rule.destination_id)))
assert.equal(rulesWithUnknownZones.length, 0, 'fare rule origin/destination zone IDs must map to station IDs or station fare zones')

// Independently verify Tokyo Metro station reachability in the *current* graph,
// instead of trusting only the saved integration-audit document.
const metroStationIds = stations.filter((station) => station.operator === 'tokyometro').map((station) => String(station.id))
const metroSet = new Set(metroStationIds)
const metroOut = new Map(metroStationIds.map((id) => [id, []]))
const metroIn = new Map(metroStationIds.map((id) => [id, []]))
for (const connection of connections) {
  if (lineById.get(String(connection.lineId))?.operator !== 'tokyometro') continue
  if (metroSet.has(String(connection.from)) && metroSet.has(String(connection.to))) {
    metroOut.get(String(connection.from)).push(String(connection.to))
    metroIn.get(String(connection.to)).push(String(connection.from))
  }
}
for (const transfer of transfers) {
  if (metroSet.has(String(transfer.from)) && metroSet.has(String(transfer.to))) {
    metroOut.get(String(transfer.from)).push(String(transfer.to))
    metroIn.get(String(transfer.to)).push(String(transfer.from))
  }
}
const metroRoot = metroStationIds[0]
const metroReachable = reachability(metroRoot, metroOut)
const metroCanReachRoot = reachability(metroRoot, metroIn)
assert.equal(metroReachable.size, metroStationIds.length, 'all Metro stations must be reachable from the Metro graph root')
assert.equal(metroCanReachRoot.size, metroStationIds.length, 'all Metro stations must be able to reach the Metro graph root')

// Current feed-count metadata is used as a snapshot contract; a source update
// should intentionally update the audit and this report rather than silently drift.
assert.equal(audit.sourceCounts.metroGtfsStations, 185)
assert.equal(audit.sourceCounts.metroGtfsRoutes, 9)
assert.equal(audit.sourceCounts.metroGtfsTrips, 9706)
assert.equal(audit.sourceCounts.metroUntimedPassThroughStops, 4151)
assert.equal(audit.sourceCounts.metroUntimedServiceableStops, 0)
assert.equal(audit.sourceCounts.toeiGtfsStations, 149)
assert.equal(audit.sourceCounts.toeiGtfsRoutes, 6)
assert.equal(audit.sourceCounts.toeiGtfsTrips, 5600)
assert.equal(audit.sourceCounts.toeiUntimedPassThroughStops, 540)
assert.equal(audit.sourceCounts.toeiUntimedServiceableStops, 0)
assert.equal(audit.outputCounts.stations, stations.length)
assert.equal(audit.outputCounts.lines, lines.length)
assert.equal(audit.outputCounts.trips, trips.length)
assert.equal(audit.outputCounts.connections, connections.length)
assert.equal(audit.outputCounts.transfers, transfers.length)
assert.equal(audit.outputCounts.fareRules, fares.rules.length)
assert.equal(audit.transferAudit.unresolvedTransferRefs.length, 0)
assert.deepEqual([...audit.farePolicy.supportedCrossOperatorCombination].sort(), ['tokyometro', 'toei'].sort(), 'only Metro↔Toei should be an eligible cross-operator fare combination')
assert.equal(audit.farePolicy.metroToeiAdultTransferDiscountYen, 70, 'the Metro↔Toei fare policy should apply the adult ¥70 discount')
assert.ok(String(audit.farePolicy.farePriceInterpretation).includes('payment timing'), 'audit metadata must document GTFS payment_method semantics')
assert.ok(String(audit.farePolicy.otherCrossOperatorFares).includes('not combined'), 'other cross-operator fare totals must remain unknown')

const counts = {
  stations: stations.length,
  stationsByOperator: countBy(stations, (station) => station.operator),
  stationsMissingKoreanByOperator: countBy(stations.filter((station) => !station.korean), (station) => station.operator),
  stationsMissingRomanizedByOperator: countBy(stations.filter((station) => !station.romanized), (station) => station.operator),
  lines: lines.length,
  linesByOperator: countBy(lines, (line) => line.operator),
  trips: trips.length,
  connections: connections.length,
  rideConnectionsByOperator,
  rideServicesByOperator,
  passThroughConnectionsByOperator,
  passThroughServiceSegments,
  blankRideServiceTimes,
  danglingRideTripRefs,
  mismatchedRideTripRefs,
  transfers: transfers.length,
  invalidTransferEndpoints,
  missingReverseTransfers,
  reverseDurationMismatches,
  transferDurationBasis: countBy(transfers, (transfer) => transfer.durationBasis || 'unlabelled'),
  fareAttributes: fares.attributes.length,
  fareRules: fares.rules.length,
  unknownFareZones: rulesWithUnknownZones.length,
  metroReachability: { stations: metroStationIds.length, reachableFromRoot: metroReachable.size, canReachRoot: metroCanReachRoot.size },
  knownLimitations: {
    externalConnectionsNotIntegrated: audit.transferAudit.externalConnectionsNotIntegratedCount,
    transferFallbackSeconds: meta.sources?.odpt?.transferDurationFallbackSeconds ?? null,
    metroFeed: audit.metroFeed,
    toeiFeed: meta.feedInfo?.[0] ? { version: meta.feedInfo[0].feed_version, start: meta.feedInfo[0].feed_start_date, end: meta.feedInfo[0].feed_end_date } : null,
  },
}

console.log(JSON.stringify({ status: 'PASS', checkSuites: ['ID uniqueness', 'station/line/trip references', 'timed ride services', 'transfer reversibility', 'fare zone references', 'Metro graph reachability', 'source metadata consistency'], counts }, null, 2))
