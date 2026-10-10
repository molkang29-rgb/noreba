import processedStations from '../data/processed/stations.json'
import processedConnections from '../data/processed/connections.json'
import processedLines from '../data/processed/lines.json'
import trainMeta from '../data/processed/trainMeta.json'
import processedServices from '../data/processed/services.json'
import processedFares from '../data/processed/fares.json'
import processedTransfers from '../data/processed/transfers.json'
import { selectUsefulRoutes } from './routeRanking.js'

/*
 * NOREBA route engine (rebuilt)
 *
 * Model:
 * 1. GTFS ride connections are directed, time-dependent edges.
 * 2. A station can have multiple GTFS nodes. Explicit transfer-connected
 *    nodes form a station complex; searches may start/end on any node in it.
 * 3. Path topology is searched independently of train instances. Timetable
 *    scheduling then chooses the next/previous feasible service for each path.
 * 4. A route card represents a unique ordered line pattern, transfer pattern,
 *    and ordered stop-to-stop ride sequence, never another departure of the same path.
 * 5. Journey duration starts at the first boarded train, so waiting for the
 *    first train is not incorrectly presented as travel time.
 */

const DAY = 86400
const DEFAULT_TRANSFER_SECONDS = 300
const MAX_TRANSFERS = 3
const MAX_PATH_SIGNATURES = 60
const MAX_EXPANDED_STATES = 80000
const MAX_RESULTS = 3
const MAX_ACTIVE_SERVICE_CACHE_ENTRIES = 20000

// User-observed Yahoo! IC-fare correction (2026-10-10). Keep the exception
// station-specific: zone IDs are data keys, not a safe proxy for station pairs.
const FARE_CORRECTIONS = new Map([
  ['tokyometro|TM-314|TM-304|ic', 178],
  ['tokyometro|TM-304|TM-314|ic', 178],
])

const stationMap = new Map(processedStations.map((station) => [String(station.id), station]))
const lineMap = new Map(processedLines.map((line) => [String(line.id), line]))
const calendarByServiceId = new Map(
  (processedServices.calendar || []).map((item) => [String(item.service_id), item]),
)
const calendarExceptionsByKey = new Map(
  (processedServices.calendarDates || []).map((item) => [
    `${item.service_id}|${item.date}`,
    item,
  ]),
)
const fareAttributeById = new Map(
  (processedFares.attributes || []).map((fare) => [String(fare.fare_id), fare]),
)
const activeServiceCache = new Map()
const serviceSecondsCache = new WeakMap()
const connectionDurationCache = new WeakMap()

const outgoingByStation = new Map()
const incomingByStation = new Map()
const transferNeighbors = new Map()

function append(map, key, value) {
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(value)
}

for (const edge of processedConnections) {
  const normalized = {
    ...edge,
    from: String(edge.from),
    to: String(edge.to),
    lineId: edge.lineId == null ? null : String(edge.lineId),
    transfer: false,
    services: Array.isArray(edge.services) ? edge.services : [],
  }
  append(outgoingByStation, normalized.from, normalized)
  append(incomingByStation, normalized.to, normalized)
}

for (const transfer of processedTransfers) {
  const normalized = {
    ...transfer,
    from: String(transfer.from),
    to: String(transfer.to),
    lineId: null,
    transfer: true,
    services: [],
    duration: Number.isFinite(Number(transfer.duration))
      ? Math.max(0, Number(transfer.duration))
      : DEFAULT_TRANSFER_SECONDS,
    durationIsEstimate: true,
  }
  append(outgoingByStation, normalized.from, normalized)
  append(incomingByStation, normalized.to, normalized)
  append(transferNeighbors, normalized.from, normalized.to)
}

function parseGtfsTime(value) {
  if (value == null || value === '') return null
  const parts = String(value).split(':').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null
  const [hours, minutes, seconds] = parts
  if (hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null
  return hours * 3600 + minutes * 60 + seconds
}

function formatGtfsTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--'
  const normalized = ((Math.trunc(seconds) % DAY) + DAY) % DAY
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function getTokyoDateTime() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date())
  const get = (type) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

function normalizeDate(date) {
  if (date && Number.isFinite(date.year) && Number.isFinite(date.month) && Number.isFinite(date.day)) {
    return { year: date.year, month: date.month, day: date.day }
  }
  const now = getTokyoDateTime()
  return { year: now.year, month: now.month, day: now.day }
}

function shiftDate(date, offset) {
  const normalized = normalizeDate(date)
  const value = new Date(Date.UTC(normalized.year, normalized.month - 1, normalized.day + offset))
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  }
}

function dateKey(date) {
  const value = normalizeDate(date)
  return `${value.year}${String(value.month).padStart(2, '0')}${String(value.day).padStart(2, '0')}`
}

function isServiceActive(serviceId, serviceDate) {
  if (!serviceId) return false
  const date = dateKey(serviceDate)
  const key = `${serviceId}|${date}`
  if (activeServiceCache.has(key)) return activeServiceCache.get(key)

  const base = calendarByServiceId.get(String(serviceId))
  const dateObj = new Date(Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
  ))
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dateObj.getUTCDay()]
  let active = Boolean(
    base && date >= String(base.start_date) && date <= String(base.end_date) && base[weekday] === '1',
  )
  const exception = calendarExceptionsByKey.get(`${serviceId}|${date}`)
  if (exception?.exception_type === '1') active = true
  if (exception?.exception_type === '2') active = false

  if (activeServiceCache.size >= MAX_ACTIVE_SERVICE_CACHE_ENTRIES) {
    const oldestKey = activeServiceCache.keys().next().value
    if (oldestKey !== undefined) activeServiceCache.delete(oldestKey)
  }
  activeServiceCache.set(key, active)
  return active
}

function serviceTimes(service) {
  if (serviceSecondsCache.has(service)) return serviceSecondsCache.get(service)
  let departure = parseGtfsTime(service.departure)
  let arrival = parseGtfsTime(service.arrival)
  if (departure == null || arrival == null) {
    const bad = null
    serviceSecondsCache.set(service, bad)
    return bad
  }
  if (arrival < departure) arrival += DAY
  const value = { departure, arrival }
  serviceSecondsCache.set(service, value)
  return value
}

/*
 * A GTFS service day may contain times beyond 24:00. For a search on calendar
 * day D, yesterday's 24:xx trip is today's 00:xx trip. Once a scheduled route
 * itself crosses midnight, service day D+1 must also be considered. We do not
 * let an early-morning query accidentally pick today's service at 24:xx as a
 * train that departs tomorrow.
 */
function serviceCandidatesForTime(service, targetDate, referenceSeconds, direction) {
  const times = serviceTimes(service)
  if (!times) return []

  const serviceOffsets = referenceSeconds < DAY ? [-1, 0] : [0, 1]
  const candidates = []

  for (const offset of serviceOffsets) {
    if (!isServiceActive(service.serviceId, shiftDate(targetDate, offset))) continue

    if (referenceSeconds < DAY && offset === 0 && times.departure >= DAY) continue
    if (referenceSeconds >= DAY && offset === 1 && times.departure >= DAY) continue

    const departureSeconds = times.departure + offset * DAY
    const arrivalSeconds = times.arrival + offset * DAY
    if (direction === 'forward' && departureSeconds < referenceSeconds) continue
    if (direction === 'backward' && arrivalSeconds > referenceSeconds) continue

    candidates.push({
      ...service,
      departureSecondsOverride: departureSeconds,
      arrivalSecondsOverride: arrivalSeconds,
      serviceDateOffset: offset,
    })
  }

  candidates.sort((a, b) => direction === 'backward'
    ? b.arrivalSecondsOverride - a.arrivalSecondsOverride
    : a.departureSecondsOverride - b.departureSecondsOverride)
  return candidates
}

function findNextService(edge, earliestDeparture, preferredTripId, targetDate) {
  if (!edge?.services?.length) return null
  let best = null
  let preferred = null

  for (const service of edge.services) {
    const candidates = serviceCandidatesForTime(service, targetDate, earliestDeparture, 'forward')
    for (const candidate of candidates) {
      if (!best || candidate.departureSecondsOverride < best.departureSecondsOverride) best = candidate
      if (
        preferredTripId && candidate.tripId === preferredTripId &&
        (!preferred || candidate.departureSecondsOverride < preferred.departureSecondsOverride)
      ) {
        preferred = candidate
      }
      // Each service contributes its earliest feasible instance for this edge.
      break
    }
  }
  return preferred || best
}

function findPreviousService(edge, latestArrival, preferredTripId, targetDate) {
  if (!edge?.services?.length) return null
  let best = null
  let preferred = null

  for (const service of edge.services) {
    const candidates = serviceCandidatesForTime(service, targetDate, latestArrival, 'backward')
    for (const candidate of candidates) {
      if (!best || candidate.arrivalSecondsOverride > best.arrivalSecondsOverride) best = candidate
      if (
        preferredTripId && candidate.tripId === preferredTripId &&
        (!preferred || candidate.arrivalSecondsOverride > preferred.arrivalSecondsOverride)
      ) {
        preferred = candidate
      }
      break
    }
  }
  return preferred || best
}

function getStation(id) {
  return stationMap.get(String(id))
}

function getLineInfo(lineId) {
  const line = lineMap.get(String(lineId))
  if (line) {
    return {
      id: String(line.id),
      name: line.name || line.longName || '철도 노선',
      japanese: line.longName || line.name || '',
      code: line.code || line.shortName || '●',
      color: line.color || '#666666',
      operator: line.operator || null,
    }
  }
  const fallback = {
    '1': { name: '도에이 아사쿠사선', japanese: '浅草線', code: 'A', color: '#EC6E65' },
    '2': { name: '도에이 미타선', japanese: '三田線', code: 'I', color: '#006CB6' },
    '3': { name: '도에이 신주쿠선', japanese: '新宿線', code: 'S', color: '#B0C124' },
    '4': { name: '도에이 오에도선', japanese: '大江戸線', code: 'E', color: '#CE045B' },
  }[String(lineId)]
  return { id: String(lineId), ...(fallback || { name: '철도 노선', japanese: '', code: '●', color: '#666666' }) }
}

function getTrainTypeName(trainType) {
  const names = {
    'odpt.TrainType:Toei.Local': '일반',
    'odpt.TrainType:Toei.Rapid': '쾌속',
    'odpt.TrainType:Toei.Express': '급행',
    'odpt.TrainType:Toei.LimitedExpress': '특급',
    'odpt.TrainType:Toei.RapidLimitedExpress': '쾌속특급',
    'odpt.TrainType:Toei.AirportRapidLimitedExpress': '공항쾌속특급',
    'odpt.TrainType:TokyoMetro.Local': '일반',
    'odpt.TrainType:TokyoMetro.Rapid': '쾌속',
    'odpt.TrainType:TokyoMetro.CommuterRapid': '통근쾌속',
    'odpt.TrainType:TokyoMetro.Express': '급행',
  }
  return names[trainType] || '열차'
}

function getFareBetweenStations(fromId, toId) {
  const from = getStation(fromId)
  const to = getStation(toId)
  const fromZone = from?.zoneId || String(fromId)
  const toZone = to?.zoneId || String(toId)

  // We only have fare-rule coverage for Tokyo Metro and Toei Subway.
  // Never default an unknown operator to Toei: that can create a plausible but
  // incorrect fare if another operator is added to the network in the future.
  const agencyId = from?.operator
  const supportedOperators = new Set(['tokyometro', 'toei'])
  if (
    !from?.operator || !to?.operator || from.operator !== to.operator ||
    !supportedOperators.has(agencyId)
  ) {
    return { icFare: null, paperFare: null }
  }

  const candidates = (processedFares.rules || []).filter((rule) => {
    if (String(rule.origin_id) !== String(fromZone) || String(rule.destination_id) !== String(toZone)) return false
    const fare = fareAttributeById.get(String(rule.fare_id))
    return !fare?.agency_id || fare.agency_id === agencyId
  })
  const usable = candidates.length ? candidates : (processedFares.rules || []).filter((rule) => {
    if (String(rule.origin_id) !== String(fromId) || String(rule.destination_id) !== String(toId)) return false
    const fare = fareAttributeById.get(String(rule.fare_id))
    return !fare?.agency_id || fare.agency_id === agencyId
  })

  let icFare = null
  // In GTFS/GTFS-JP, fare_attributes.payment_method is the *payment timing*
  // (0 = pay on board, 1 = pay before boarding), not IC-vs-paper fare medium.
  // These source feeds provide one price per fare rule, and the values match
  // the operators' published IC fare tables for the supported systems. Treat
  // that price as the route engine's IC fare regardless of payment_method.
  // Paper fares are not separately encoded in these fare tables, so never
  // infer a paper fare from payment_method=0.
  for (const rule of usable) {
    const fare = fareAttributeById.get(String(rule.fare_id))
    const price = Number(fare?.price)
    if (!fare || !Number.isFinite(price) || price <= 0) continue
    if (icFare == null || price < icFare) icFare = price
  }
  const paperFare = null

  // User-verified Yahoo! transit correction for this exact Metro station pair.
  // The payment_method field cannot be used to infer a paper fare.
  const correctionKey = `${agencyId}|${String(fromId)}|${String(toId)}|ic`
  if (FARE_CORRECTIONS.has(correctionKey)) icFare = FARE_CORRECTIONS.get(correctionKey)
  return { icFare, paperFare }
}

function edgeTravelSeconds(edge) {
  if (edge.transfer) return Math.max(0, Number(edge.duration) || DEFAULT_TRANSFER_SECONDS)
  if (connectionDurationCache.has(edge)) return connectionDurationCache.get(edge)
  let best = Infinity
  for (const service of edge.services || []) {
    const times = serviceTimes(service)
    if (!times) continue
    best = Math.min(best, times.arrival - times.departure)
  }
  if (!Number.isFinite(best)) {
    const configuredMinutes = Number(edge.duration)
    best = Number.isFinite(configuredMinutes) ? Math.max(0, configuredMinutes * 60) : Infinity
  }
  connectionDurationCache.set(edge, best)
  return best
}

class MinHeap {
  constructor() { this.items = [] }
  get size() { return this.items.length }
  push(value) {
    const a = this.items
    a.push(value)
    let i = a.length - 1
    while (i > 0) {
      const p = Math.floor((i - 1) / 2)
      if (a[p].priority <= value.priority) break
      a[i] = a[p]
      i = p
    }
    a[i] = value
  }
  pop() {
    const a = this.items
    if (!a.length) return null
    const root = a[0]
    const last = a.pop()
    if (a.length) {
      let i = 0
      while (true) {
        const left = i * 2 + 1
        const right = left + 1
        if (left >= a.length) break
        let child = right < a.length && a[right].priority < a[left].priority ? right : left
        if (a[child].priority >= last.priority) break
        a[i] = a[child]
        i = child
      }
      a[i] = last
    }
    return root
  }
}

function buildLowerBounds(targetIds) {
  const distance = new Map()
  const heap = new MinHeap()
  for (const id of targetIds) {
    distance.set(id, 0)
    heap.push({ stationId: id, cost: 0, priority: 0 })
  }
  while (heap.size) {
    const current = heap.pop()
    if (current.cost !== distance.get(current.stationId)) continue
    for (const edge of incomingByStation.get(current.stationId) || []) {
      const weight = edgeTravelSeconds(edge)
      if (!Number.isFinite(weight)) continue
      const next = current.cost + weight
      if (next >= (distance.get(edge.from) ?? Infinity)) continue
      distance.set(edge.from, next)
      heap.push({ stationId: edge.from, cost: next, priority: next })
    }
  }
  return distance
}

function stationJapaneseName(id) {
  const station = getStation(id)
  return String(station?.japanese || station?.name || id)
}

function stationKoreanName(id) {
  const station = getStation(id)
  return String(station?.korean || station?.name || id)
}

/*
 * Resolve station-platform aliases using only transfer-connected nodes with
 * the same Japanese station name. The raw graph also contains walking links
 * between separately named nearby stations; a free-form transitive component
 * incorrectly made stations such as Higashi-Shinjuku aliases of Shinjuku.
 */
const stationComplexCache = new Map()
function getStationComplexIds(stationId) {
  const id = String(stationId)
  if (stationComplexCache.has(id)) return stationComplexCache.get(id)
  const name = stationJapaneseName(id)
  const seen = new Set([id])
  const queue = [id]
  for (let i = 0; i < queue.length; i += 1) {
    for (const neighbor of transferNeighbors.get(queue[i]) || []) {
      if (seen.has(neighbor) || stationJapaneseName(neighbor) !== name) continue
      seen.add(neighbor)
      queue.push(neighbor)
    }
  }
  const result = [...seen]
  for (const member of result) stationComplexCache.set(member, result)
  return result
}

function stationComplexSet(stationId) {
  return new Set(getStationComplexIds(stationId))
}

function advanceViaIndex(stationId, index, viaSets) {
  let next = index
  while (next < viaSets.length && viaSets[next].has(stationId)) next += 1
  return next
}

function routePatternIdentity(path) {
  const lineRuns = []
  const transferPoints = []
  const ridePathSignature = []
  let lastLineId = null
  let pendingWalk = false
  let pendingWalkFrom = null
  let pendingWalkTo = null

  const flushWalk = () => {
    if (pendingWalkFrom == null || pendingWalkTo == null) return
    const fromName = stationJapaneseName(pendingWalkFrom)
    const toName = stationJapaneseName(pendingWalkTo)
    // If the transfer graph offers a redundant walk out of and back into the
    // same station (e.g. Akasaka-mitsuke -> Nagatacho -> Akasaka-mitsuke),
    // it is not a new route alternative. Identify a walk by its boarding and
    // alighting station complex, not every internal connector edge.
    const label = fromName === toName
      ? fromName
      : [fromName, toName].sort().join('↔')
    transferPoints.push(label)
    pendingWalk = false
    pendingWalkFrom = null
    pendingWalkTo = null
  }

  for (const edge of path) {
    if (edge.transfer) {
      if (!pendingWalk) {
        pendingWalk = true
        pendingWalkFrom = edge.from
      }
      pendingWalkTo = edge.to
      continue
    }

    const lineId = String(edge.lineId)
    ridePathSignature.push(`${lineId}:${stationJapaneseName(edge.from)}>${stationJapaneseName(edge.to)}`)
    if (lastLineId != null && lastLineId !== lineId) {
      if (pendingWalk) flushWalk()
      else transferPoints.push(`@${stationJapaneseName(edge.from)}`)
    } else if (pendingWalk) {
      flushWalk()
    }

    if (lineRuns[lineRuns.length - 1] !== lineId) lineRuns.push(lineId)
    lastLineId = lineId
  }
  if (pendingWalk) flushWalk()
  return `${lineRuns.join('>')}|${transferPoints.join('>')}|${ridePathSignature.join('>')}`
}

function enumeratePaths(fromId, toId, viaIds = [], maxTransfers = MAX_TRANSFERS) {
  if (!stationMap.has(String(fromId)) || !stationMap.has(String(toId))) return []

  const sourceIds = getStationComplexIds(fromId)
  const sourceSet = new Set(sourceIds)
  const destinationSet = stationComplexSet(toId)
  if (sourceIds.some((id) => destinationSet.has(id)) && !viaIds.length) return [[]]

  const viaSets = viaIds.map(stationComplexSet)
  const waypointSets = [...viaSets, destinationSet]
  const lowerBounds = waypointSets.map((set) => buildLowerBounds([...set]))
  const heap = new MinHeap()
  let sequence = 0

  for (const sourceId of sourceIds) {
    const viaIndex = advanceViaIndex(sourceId, 0, viaSets)
    const h = lowerBounds[viaIndex].get(sourceId) ?? Infinity
    if (!Number.isFinite(h)) continue
    heap.push({
      stationId: sourceId,
      path: [],
      visited: new Set(sourceIds),
      transfers: 0,
      cost: 0,
      lastRideLine: null,
      previousWasTransfer: false,
      viaIndex,
      priority: h,
      sequence: sequence++,
    })
  }

  const resultsByIdentity = new Map()
  let expanded = 0

  while (heap.size && expanded < MAX_EXPANDED_STATES && resultsByIdentity.size < MAX_PATH_SIGNATURES) {
    const current = heap.pop()
    const completedViaIndex = advanceViaIndex(current.stationId, current.viaIndex, viaSets)

    if (completedViaIndex === viaSets.length && destinationSet.has(current.stationId) && current.path.length > 0) {
      if (current.path[current.path.length - 1]?.transfer !== true) {
        const identity = routePatternIdentity(current.path)
        const existing = resultsByIdentity.get(identity)
        if (!existing || current.cost < existing.cost) {
          resultsByIdentity.set(identity, { path: current.path, cost: current.cost, identity })
        }
      }
      continue
    }

    expanded += 1
    for (const edge of outgoingByStation.get(current.stationId) || []) {
      if (current.visited.has(edge.to)) continue
      // Never model walking from the selected origin platform to another node
      // in the same station complex as part of the trip. Each platform node in
      // the complex is instead a valid zero-cost search origin.
      if (current.path.length === 0 && edge.transfer && sourceSet.has(edge.to)) continue

      let transferCount = current.transfers
      let lastRideLine = current.lastRideLine
      let previousWasTransfer = current.previousWasTransfer
      if (edge.transfer) {
        if (!current.previousWasTransfer) transferCount += 1
        previousWasTransfer = true
      } else {
        const edgeLineId = String(edge.lineId)
        if (lastRideLine != null && lastRideLine !== edgeLineId && !previousWasTransfer) transferCount += 1
        lastRideLine = edgeLineId
        previousWasTransfer = false
      }
      if (transferCount > maxTransfers) continue

      const edgeCost = edgeTravelSeconds(edge)
      if (!Number.isFinite(edgeCost)) continue
      const nextCost = current.cost + edgeCost
      const nextViaIndex = advanceViaIndex(edge.to, completedViaIndex, viaSets)
      const h = lowerBounds[nextViaIndex].get(edge.to) ?? Infinity
      if (!Number.isFinite(h)) continue

      const visited = new Set(current.visited)
      visited.add(edge.to)
      const path = [...current.path, edge]
      heap.push({
        stationId: edge.to,
        path,
        visited,
        transfers: transferCount,
        cost: nextCost,
        lastRideLine,
        previousWasTransfer,
        viaIndex: nextViaIndex,
        priority: nextCost + h,
        sequence: sequence++,
      })
    }
  }

  return [...resultsByIdentity.values()]
    .sort((a, b) => a.cost - b.cost)
    .map((item) => item.path)
}

function schedulePath(path, startSeconds, targetDate) {
  if (!Array.isArray(path) || path.length === 0) return null
  let currentTime = startSeconds
  let currentTripId = null
  const scheduled = []

  for (let i = 0; i < path.length; i += 1) {
    const edge = path[i]
    if (edge.transfer) {
      const duration = Number.isFinite(Number(edge.duration))
        ? Math.max(0, Number(edge.duration))
        : DEFAULT_TRANSFER_SECONDS
      scheduled.push({
        ...edge,
        selectedService: null,
        departureSeconds: currentTime,
        arrivalSeconds: currentTime + duration,
        transfer: true,
      })
      currentTime += duration
      currentTripId = null
      continue
    }

    const previous = path[i - 1]
    const isLineChangeWithoutWalk = Boolean(
      previous && !previous.transfer && previous.lineId != null &&
      edge.lineId != null && String(previous.lineId) !== String(edge.lineId),
    )
    const earliestDeparture = currentTime + (isLineChangeWithoutWalk ? DEFAULT_TRANSFER_SECONDS : 0)
    const service = findNextService(edge, earliestDeparture, currentTripId, targetDate)
    if (!service) return null

    const departure = service.departureSecondsOverride
    const arrival = service.arrivalSecondsOverride
    if (!Number.isFinite(departure) || !Number.isFinite(arrival) || arrival < departure) return null

    scheduled.push({
      ...edge,
      selectedService: service,
      departureSeconds: departure,
      arrivalSeconds: arrival,
      transfer: false,
    })
    currentTripId = service.tripId || null
    currentTime = arrival
  }

  const firstRide = scheduled.find((segment) => !segment.transfer && segment.selectedService)
  const lastRide = [...scheduled].reverse().find((segment) => !segment.transfer && segment.selectedService)
  if (!firstRide || !lastRide) return null

  // Only the time spent after boarding the first train is travel duration.
  // The wait from the user's requested departure time to this train is not.
  return {
    segments: scheduled,
    departureSeconds: firstRide.departureSeconds,
    arrivalSeconds: lastRide.arrivalSeconds,
    durationSeconds: Math.max(0, lastRide.arrivalSeconds - firstRide.departureSeconds),
  }
}

function schedulePathBackward(path, targetArrival, targetDate) {
  if (!Array.isArray(path) || path.length === 0) return null
  const scheduled = new Array(path.length)

  for (let i = path.length - 1; i >= 0; i -= 1) {
    const edge = path[i]
    const nextEdge = path[i + 1]
    const nextScheduled = scheduled[i + 1]

    if (edge.transfer) {
      const duration = Number.isFinite(Number(edge.duration))
        ? Math.max(0, Number(edge.duration))
        : DEFAULT_TRANSFER_SECONDS
      const arrival = nextScheduled ? nextScheduled.departureSeconds : targetArrival
      scheduled[i] = {
        ...edge,
        selectedService: null,
        departureSeconds: arrival - duration,
        arrivalSeconds: arrival,
        transfer: true,
      }
      continue
    }

    const nextIsExplicitTransfer = nextEdge?.transfer === true
    const lineChangeWithoutWalk = Boolean(
      nextEdge && !nextIsExplicitTransfer && nextEdge.lineId != null && edge.lineId != null &&
      String(nextEdge.lineId) !== String(edge.lineId),
    )
    const preferredTripId = nextScheduled && !nextScheduled.transfer
      ? nextScheduled.selectedService?.tripId || null
      : null

    let latestArrival = nextScheduled ? nextScheduled.departureSeconds : targetArrival
    if (lineChangeWithoutWalk) latestArrival -= DEFAULT_TRANSFER_SECONDS

    let service = preferredTripId
      ? findPreviousService(edge, latestArrival, preferredTripId, targetDate)
      : null
    if (!service) service = findPreviousService(edge, latestArrival, null, targetDate)
    if (!service) return null

    const departure = service.departureSecondsOverride
    const arrival = service.arrivalSecondsOverride
    if (!Number.isFinite(departure) || !Number.isFinite(arrival) || arrival < departure) return null
    scheduled[i] = {
      ...edge,
      selectedService: service,
      departureSeconds: departure,
      arrivalSeconds: arrival,
      transfer: false,
    }
  }

  const segments = scheduled.filter(Boolean)
  const firstRide = segments.find((segment) => !segment.transfer && segment.selectedService)
  const lastRide = [...segments].reverse().find((segment) => !segment.transfer && segment.selectedService)
  if (!firstRide || !lastRide || lastRide.arrivalSeconds > targetArrival) return null

  return {
    segments,
    departureSeconds: firstRide.departureSeconds,
    arrivalSeconds: lastRide.arrivalSeconds,
    durationSeconds: Math.max(0, lastRide.arrivalSeconds - firstRide.departureSeconds),
  }
}

function makeRoute(path, schedule, identity) {
  const firstRideEdge = path.find((edge) => !edge.transfer)
  const lastRideEdge = [...path].reverse().find((edge) => !edge.transfer)
  if (!firstRideEdge || !lastRideEdge || !schedule) return null

  const stationIds = [path[0].from, ...path.map((edge) => edge.to)]
  const routeStations = stationIds.map((id) => {
    const station = getStation(id)
    return {
      id,
      name: stationKoreanName(id),
      japanese: stationJapaneseName(id),
      romanized: station?.romanized || '',
    }
  })

  const lineIds = []
  for (const edge of path) {
    if (edge.transfer || edge.lineId == null) continue
    const id = String(edge.lineId)
    if (lineIds[lineIds.length - 1] !== id) lineIds.push(id)
  }
  const lines = lineIds.map(getLineInfo)
  const rideSegments = schedule.segments.filter((segment) => !segment.transfer && segment.selectedService)
  let transfers = 0
  let lastRide = null
  let walkPending = false
  for (const segment of schedule.segments) {
    if (segment.transfer && segment.lineId == null) {
      if (!walkPending) transfers += 1
      walkPending = true
      continue
    }
    if (segment.transfer || !segment.selectedService) continue
    if (lastRide && String(lastRide.lineId) !== String(segment.lineId) && !walkPending) {
      const sameTrip = Boolean(
        lastRide.selectedService?.tripId &&
        lastRide.selectedService.tripId === segment.selectedService?.tripId,
      )
      if (!sameTrip) transfers += 1
    }
    lastRide = segment
    walkPending = false
  }

  const segments = schedule.segments.map((segment, index) => {
    const fromStation = getStation(segment.from)
    const toStation = getStation(segment.to)
    const service = segment.selectedService
    const trainNumber = service?.tripShortName || null
    const trainType = trainNumber ? trainMeta[trainNumber]?.trainType : null
    const line = segment.lineId == null ? null : getLineInfo(segment.lineId)
    const durationSeconds = segment.arrivalSeconds - segment.departureSeconds
    return {
      from: {
        id: segment.from,
        name: fromStation?.korean || fromStation?.name || segment.from,
        japanese: fromStation?.japanese || fromStation?.name || '',
      },
      to: {
        id: segment.to,
        name: toStation?.korean || toStation?.name || segment.to,
        japanese: toStation?.japanese || toStation?.name || '',
      },
      lineId: segment.lineId,
      line,
      duration: Math.max(1, Math.round(durationSeconds / 60)),
      departureTime: formatGtfsTime(segment.departureSeconds),
      arrivalTime: formatGtfsTime(segment.arrivalSeconds),
      departureDayOffset: Math.floor(segment.departureSeconds / DAY),
      arrivalDayOffset: Math.floor(segment.arrivalSeconds / DAY),
      destination: service?.headsign || null,
      tripId: service?.tripId || null,
      serviceDateOffset: service?.serviceDateOffset ?? 0,
      trainNumber,
      directionId: service?.directionId || null,
      serviceType: segment.transfer ? null : getTrainTypeName(trainType),
      transfer: Boolean(segment.transfer),
      durationIsEstimate: Boolean(segment.transfer),
      stopIndex: index,
    }
  })

  const firstService = rideSegments[0]?.selectedService || null
  let transferWalkSeconds = 0
  let previousRideForWalk = null
  let hasExplicitTransferSinceRide = false
  for (const segment of schedule.segments) {
    if (segment.transfer && segment.lineId == null) {
      transferWalkSeconds += Math.max(0, Number(segment.arrivalSeconds) - Number(segment.departureSeconds))
      hasExplicitTransferSinceRide = true
      continue
    }
    if (segment.transfer || !segment.selectedService) continue
    if (previousRideForWalk && !hasExplicitTransferSinceRide &&
      String(previousRideForWalk.lineId) !== String(segment.lineId)) {
      transferWalkSeconds += DEFAULT_TRANSFER_SECONDS
    }
    previousRideForWalk = segment
    hasExplicitTransferSinceRide = false
  }
  const transferSegment = schedule.segments.find((segment) => segment.transfer && segment.lineId == null)
  let transferStation = null
  if (transferSegment) {
    transferStation = {
      id: transferSegment.from,
      name: stationKoreanName(transferSegment.from),
      japanese: stationJapaneseName(transferSegment.from),
    }
  } else if (transfers > 0) {
    for (let i = 1; i < rideSegments.length; i += 1) {
      if (String(rideSegments[i - 1].lineId) === String(rideSegments[i].lineId)) continue
      const stationId = rideSegments[i].from
      transferStation = {
        id: stationId,
        name: stationKoreanName(stationId),
        japanese: stationJapaneseName(stationId),
      }
      break
    }
  }

  // Fare-combination policy:
  // - Toei-only and Tokyo-Metro-only journeys use that operator's own fare rules.
  // - Tokyo Metro + Toei is the one supported cross-operator exception: sum the
  //   continuous operator legs and apply the adult 70-yen discount once per entire
  //   itinerary, even when the route alternates between these two operators again.
  // - Any journey involving another operator (or an unmapped line) is NOT added
  //   together. Leave the combined fare unknown until a supported official fare
  //   model exists for that operator/connection.
  const operatorLegs = []
  let currentLeg = null
  let hasUnmappedRideOperator = false
  for (const edge of path) {
    if (edge.transfer || edge.lineId == null) continue
    const operator = lineMap.get(String(edge.lineId))?.operator
    if (!operator) {
      hasUnmappedRideOperator = true
      currentLeg = null
      continue
    }
    if (!currentLeg || currentLeg.operator !== operator) {
      currentLeg = { operator, from: edge.from, to: edge.to }
      operatorLegs.push(currentLeg)
    } else {
      currentLeg.to = edge.to
    }
  }

  const rideOperators = new Set(operatorLegs.map((leg) => leg.operator))
  const supportedOperators = new Set(['tokyometro', 'toei'])
  const hasMetroToeiTransfer = rideOperators.has('tokyometro') && rideOperators.has('toei')
  const hasUnsupportedOperator = hasUnmappedRideOperator ||
    [...rideOperators].some((operator) => !supportedOperators.has(operator))
  const isSupportedFareCombination = !hasUnsupportedOperator &&
    (rideOperators.size <= 1 || (rideOperators.size === 2 && hasMetroToeiTransfer))

  let routeFare = { icFare: null, paperFare: null }
  if (isSupportedFareCombination && operatorLegs.length > 0) {
    routeFare = { icFare: 0, paperFare: 0 }
    for (const leg of operatorLegs) {
      const legFare = getFareBetweenStations(leg.from, leg.to)
      if (legFare.icFare == null || legFare.icFare <= 0) routeFare.icFare = null
      else if (routeFare.icFare != null) routeFare.icFare += legFare.icFare
      if (legFare.paperFare == null || legFare.paperFare <= 0) routeFare.paperFare = null
      else if (routeFare.paperFare != null) routeFare.paperFare += legFare.paperFare
    }

    if (hasMetroToeiTransfer) {
      if (routeFare.icFare != null) routeFare.icFare = Math.max(0, routeFare.icFare - 70)
      if (routeFare.paperFare != null) routeFare.paperFare = Math.max(0, routeFare.paperFare - 70)
    }
  }

  const hasMultipleOperators = rideOperators.size > 1 || hasUnmappedRideOperator
  const fareStatus = routeFare.icFare != null || routeFare.paperFare != null
    ? hasMetroToeiTransfer ? 'cross-operator-discount' : 'known'
    : hasMultipleOperators ? 'cross-operator-unsupported' : 'unavailable'

  return {
    type: transfers === 0 ? 'direct' : 'transfer',
    stations: routeStations,
    segments,
    lines,
    transfers,
    transferWalkSeconds,
    duration: Math.max(1, Math.round(schedule.durationSeconds / 60)),
    fare: routeFare,
    fareStatus,
    departureTime: formatGtfsTime(schedule.departureSeconds),
    arrivalTime: formatGtfsTime(schedule.arrivalSeconds),
    destination: firstService?.headsign || null,
    transferStation,
    departureSeconds: schedule.departureSeconds,
    arrivalSeconds: schedule.arrivalSeconds,
    routeKey: identity,
  }
}

function sameStationRoute(stationId) {
  const station = getStation(stationId)
  return [{
    type: 'same-station',
    stations: station ? [{ id: station.id, name: station.korean || station.name, japanese: station.japanese || station.name }] : [],
    segments: [],
    lines: [],
    transfers: 0,
    duration: 0,
    fare: { icFare: 0, paperFare: 0 },
    departureTime: '--:--',
    arrivalTime: '--:--',
    departureSeconds: null,
    arrivalSeconds: null,
    routeKey: 'same-station',
  }]
}

export function calculateRoutes(
  fromId,
  toId,
  startSeconds = null,
  targetDate = null,
  timeMode = 'departure',
  viaStationIds = [],
) {
  if (!fromId || !toId || !stationMap.has(String(fromId)) || !stationMap.has(String(toId))) return []

  const fromComplex = new Set(getStationComplexIds(fromId))
  const toComplex = new Set(getStationComplexIds(toId))
  const sameComplex = [...fromComplex].some((id) => toComplex.has(id))
  if (sameComplex && (!viaStationIds || viaStationIds.length === 0)) return sameStationRoute(fromId)

  const viaIds = (viaStationIds || []).map(String).filter((id) => stationMap.has(id))
  const searchDate = normalizeDate(targetDate)
  const nowSeconds = Number.isFinite(startSeconds)
    ? startSeconds
    : (() => { const now = getTokyoDateTime(); return now.hour * 3600 + now.minute * 60 + now.second })()
  const paths = enumeratePaths(String(fromId), String(toId), viaIds, MAX_TRANSFERS)
  const candidateRoutes = []
  const seenRouteKeys = new Set()

  for (const path of paths) {
    if (!path.length || path[0].transfer || path[path.length - 1].transfer) continue
    const identity = routePatternIdentity(path)
    if (seenRouteKeys.has(identity)) continue
    seenRouteKeys.add(identity)

    const schedule = timeMode === 'arrival'
      ? schedulePathBackward(path, nowSeconds, searchDate)
      : schedulePath(path, nowSeconds, searchDate)
    if (!schedule) continue
    const route = makeRoute(path, schedule, identity)
    if (route) candidateRoutes.push(route)
  }

  if (!candidateRoutes.length) return []

  // Filter routes that are strictly worse in every comparable user-facing
  // metric before applying the display cap. This prevents a 34-minute,
  // 3-transfer route with the same fare from appearing beside a 34-minute,
  // 1-transfer route. Do not prefer every direct route unconditionally: a
  // materially faster transfer route can remain a useful trade-off.
  return selectUsefulRoutes(candidateRoutes, timeMode, MAX_RESULTS)
}

export function findPathsPublic(fromId, toId, maxTransfers = 2) {
  return enumeratePaths(String(fromId), String(toId), [], maxTransfers)
}

export default {
  calculateRoutes,
  findPaths: findPathsPublic,
}
