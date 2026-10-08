import processedStations from '../data/processed/stations.json'
import processedConnections from '../data/processed/connections.json'
import processedLines from '../data/processed/lines.json'
import trainMeta from '../data/processed/trainMeta.json'
import processedServices from '../data/processed/services.json'
import processedFares from '../data/processed/fares.json'
import processedTransfers from '../data/processed/transfers.json'

const stationMap = new Map(processedStations.map((station) => [station.id, station]))
const lineMap = new Map(processedLines.map((line) => [line.id, line]))
const connectionsByStation = new Map()

for (const connection of processedConnections) {
  if (!connectionsByStation.has(connection.from)) connectionsByStation.set(connection.from, [])
  connectionsByStation.get(connection.from).push(connection)
}

for (const transfer of processedTransfers) {
  if (!connectionsByStation.has(transfer.from)) connectionsByStation.set(transfer.from, [])
  connectionsByStation.get(transfer.from).push({
    from: transfer.from,
    to: transfer.to,
    lineId: null,
    duration: transfer.duration,
    transfer: true,
    services: [],
  })
}

function parseGtfsTime(value) {
  if (!value) return null
  const parts = String(value).split(':').map(Number)
  if (parts.length !== 3) return null
  const [hours, minutes, seconds] = parts
  return hours * 3600 + minutes * 60 + seconds
}

function formatGtfsTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--'
  const normalized = ((seconds % 86400) + 86400) % 86400
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function getTokyoNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour12: false,
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

function getCurrentTokyoSeconds() {
  const now = getTokyoNow()
  return now.hour * 3600 + now.minute * 60 + now.second
}

function isServiceActiveToday(serviceId, targetDate = null) {
  if (!serviceId) return false

  const now = getTokyoNow()
  const year = targetDate?.year ?? now.year
  const month = targetDate?.month ?? now.month
  const day = targetDate?.day ?? now.day

  const dateString = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`

  const date = new Date(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+09:00`
  )

  const weekdayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]

  const weekday = weekdayNames[date.getDay()]
  const calendar = processedServices.calendar || []
  const calendarDates = processedServices.calendarDates || []

  const baseService = calendar.find(
    (item) => item.service_id === serviceId
  )

  let active = false

  if (baseService) {
    const withinDateRange =
      dateString >= baseService.start_date &&
      dateString <= baseService.end_date

    active =
      withinDateRange &&
      baseService[weekday] === '1'
  }

  const exception = calendarDates.find(
    (item) =>
      item.service_id === serviceId &&
      item.date === dateString
  )

  if (exception?.exception_type === '1') {
    active = true
  }

  if (exception?.exception_type === '2') {
    active = false
  }

  return active
}

function getStation(stationId) {
  return stationMap.get(stationId)
}

function getLineInfo(lineId) {
  const line = lineMap.get(lineId)

  const toiLineInfo = {
    '1': {
      name: '도에이 아사쿠사선',
      japanese: '都営浅草線',
      code: 'A',
      color: '#EC6E65',
    },
    '2': {
      name: '도에이 미타선',
      japanese: '都営三田線',
      code: 'I',
      color: '#006CB6',
    },
    '3': {
      name: '도에이 신주쿠선',
      japanese: '都営新宿線',
      code: 'S',
      color: '#B0C124',
    },
    '4': {
      name: '도에이 오에도선',
      japanese: '都営大江戸線',
      code: 'E',
      color: '#CE045B',
    },
  }

  const customLine = toiLineInfo[String(lineId)]

  if (customLine) {
    return {
      id: lineId,
      ...customLine,
    }
  }

  if (!line) {
    return {
      id: lineId,
      name: '철도 노선',
      japanese: '',
      code: '●',
      color: '#666666',
    }
  }

  return {
    id: line.id,
    name:
      line.longName ||
      line.name ||
      '철도 노선',
    japanese:
      line.longName ||
      line.name ||
      '',
    code:
      line.shortName ||
      '●',
    color:
      line.color ||
      '#666666',
  }
}

function getTrainTypeName(trainType) {
  const typeMap = {
    'odpt.TrainType:Toei.Local': '일반',
    'odpt.TrainType:Toei.Rapid': '쾌속',
    'odpt.TrainType:Toei.Express': '급행',
    'odpt.TrainType:Toei.LimitedExpress': '특급',
    'odpt.TrainType:Toei.RapidLimitedExpress': '쾌속특급',
    'odpt.TrainType:Toei.AirportRapidLimitedExpress':
      '공항쾌속특급',
  }

  return typeMap[trainType] || '열차'
}

function getFareBetweenStations(
  fromStationId,
  toStationId
) {
  const attributes =
    processedFares.attributes || []

  const rules =
    processedFares.rules || []

  const fareMap = new Map(
    attributes.map((fare) => [
      fare.fare_id,
      fare,
    ])
  )

  const matchingRules =
    rules.filter(
      (rule) =>
        rule.origin_id === fromStationId &&
        rule.destination_id === toStationId
    )

  let icFare = null
  let paperFare = null

  for (const rule of matchingRules) {
    const fare =
      fareMap.get(rule.fare_id)

    if (!fare) continue

    const price =
      Number(fare.price)

    if (!Number.isFinite(price)) continue

    if (fare.payment_method === '1') {
      icFare = price
    }

    if (fare.payment_method === '0') {
      paperFare = price
    }
  }

  return {
    icFare,
    paperFare,
  }
}

function findNextService(
  connection,
  earliestDeparture,
  preferredTripId = null,
  targetDate = null
) {
  if (
    !connection.services ||
    connection.services.length === 0
  ) {
    return null
  }

  const services =
    connection.services
      .filter((service) => {
        if (
          !isServiceActiveToday(
            service.serviceId,
            targetDate
          )
        ) {
          return false
        }

        const departure =
          parseGtfsTime(
            service.departure
          )

        const arrival =
          parseGtfsTime(
            service.arrival
          )

        return (
          departure != null &&
          arrival != null &&
          departure >= earliestDeparture
        )
      })
      .sort(
        (a, b) =>
          parseGtfsTime(a.departure) -
          parseGtfsTime(b.departure)
      )

  if (services.length === 0) {
    return null
  }

  if (preferredTripId) {
    const sameTrip =
      services.find(
        (service) =>
          service.tripId ===
          preferredTripId
      )

    if (sameTrip) {
      return sameTrip
    }
  }

  return services[0]
}

function findPreviousService(
  connection,
  latestArrival,
  preferredTripId = null,
  targetDate = null
) {
  if (
    !connection?.services ||
    connection.services.length === 0
  ) {
    return null
  }

  const candidates =
    connection.services
      .filter((service) => {
        if (
          !isServiceActiveToday(
            service.serviceId,
            targetDate
          )
        ) {
          return false
        }

        const arrival =
          parseGtfsTime(
            service.arrival
          )

        return (
          arrival != null &&
          arrival <= latestArrival
        )
      })
      .sort(
        (a, b) =>
          parseGtfsTime(b.arrival) -
          parseGtfsTime(a.arrival)
      )

  if (preferredTripId) {
    const sameTrip =
      candidates.find(
        (service) =>
          service.tripId ===
          preferredTripId
      )

    if (sameTrip) {
      return sameTrip
    }
  }

  return candidates[0] || null
}

function findPaths(
  fromId,
  toId,
  maxTransfers = 2
) {
  const results = []

  const queue = [
    {
      stationId: fromId,
      path: [],
      visited: new Set([fromId]),
      transfers: 0,
    },
  ]

  while (queue.length > 0) {
    const current =
      queue.shift()

    if (
      current.stationId ===
      toId
    ) {
      results.push(
        current.path
      )

      if (results.length >= 30) {
        break
      }

      continue
    }

    const connections =
      connectionsByStation.get(
        current.stationId
      ) || []

    for (const connection of connections) {
      const nextStation =
        connection.to

      if (
        current.visited.has(
          nextStation
        )
      ) {
        continue
      }

      const previous =
        current.path[
          current.path.length - 1
        ]

      const isTransferConnection =
        connection.transfer === true

      const isLineTransfer =
        previous &&
        previous.transfer !== true &&
        connection.lineId !== null &&
        previous.lineId !== null &&
        previous.lineId !==
          connection.lineId

      const isTransfer =
        isTransferConnection ||
        isLineTransfer

      const transfers =
        current.transfers +
        (isTransfer ? 1 : 0)

      if (
        transfers >
        maxTransfers
      ) {
        continue
      }

      const visited =
        new Set(
          current.visited
        )

      visited.add(
        nextStation
      )

      queue.push({
        stationId:
          nextStation,
        path: [
          ...current.path,
          connection,
        ],
        visited,
        transfers,
      })
    }
  }

  return results
}

function schedulePath(
  path,
  startSeconds,
  targetDate = null
) {
  if (
    !path ||
    path.length === 0
  ) {
    return null
  }

  let currentTime =
    startSeconds

  let currentTripId = null

  const scheduledSegments = []

  for (
    let index = 0;
    index < path.length;
    index += 1
  ) {
    const connection =
      path[index]

    if (
      connection.transfer === true
    ) {
      const duration =
        Math.max(
          300,
          Number(
            connection.duration
          ) || 0
        )

      const departure =
        currentTime

      const arrival =
        currentTime +
        duration

      scheduledSegments.push({
        ...connection,
        selectedService: null,
        departureSeconds:
          departure,
        arrivalSeconds:
          arrival,
        transfer: true,
      })

      currentTime =
        arrival

      currentTripId = null

      continue
    }

    const previous =
      path[index - 1]

    const isTransfer =
      previous &&
      previous.transfer !== true &&
      connection.lineId !== null &&
      previous.lineId !== null &&
      previous.lineId !==
        connection.lineId

    const earliestDeparture =
      currentTime +
      (isTransfer ? 300 : 0)

    const service =
      findNextService(
        connection,
        earliestDeparture,
        currentTripId,
        targetDate
      )

    if (!service) {
      return null
    }

    const departure =
      parseGtfsTime(
        service.departure
      )

    const arrival =
      parseGtfsTime(
        service.arrival
      )

    if (
      departure == null ||
      arrival == null
    ) {
      return null
    }

    currentTripId =
      service.tripId || null

    currentTime =
      arrival

    scheduledSegments.push({
      ...connection,
      selectedService:
        service,
      departureSeconds:
        departure,
      arrivalSeconds:
        arrival,
      transfer:
        Boolean(isTransfer),
    })
  }

  if (
    scheduledSegments.length === 0
  ) {
    return null
  }

  const first =
    scheduledSegments[0]

  const last =
    scheduledSegments[
      scheduledSegments.length - 1
    ]

  const durationSeconds =
    last.arrivalSeconds -
    first.departureSeconds

  return {
    segments:
      scheduledSegments,

    departureSeconds:
      first.departureSeconds,

    arrivalSeconds:
      last.arrivalSeconds,

    durationSeconds:
      Math.max(
        0,
        durationSeconds
      ),
  }
}

function schedulePathBackward(
  path,
  targetArrival,
  targetDate = null
) {
  if (!Array.isArray(path) || path.length === 0) {
    return null
  }

  // 역방향 계산 결과를 원래 경로 순서대로 저장한다.
  // tripId가 없거나 구간별로 달라져도 모든 역 사이에
  // 환승 5분을 반복해서 빼지 않도록 연결 유형으로 판단한다.
  const scheduled = new Array(path.length)

  for (let i = path.length - 1; i >= 0; i -= 1) {
    const connection = path[i]
    const nextConnection = path[i + 1]
    const nextScheduled = scheduled[i + 1]

    if (connection.transfer === true) {
      // 명시적인 도보 환승 구간 자체에만 환승 시간을 적용한다.
      const duration = Math.max(
        300,
        Number(connection.duration) || 0
      )

      const arrival = nextScheduled
        ? nextScheduled.departureSeconds
        : targetArrival

      const departure = arrival - duration

      scheduled[i] = {
        ...connection,
        selectedService: null,
        departureSeconds: departure,
        arrivalSeconds: arrival,
        transfer: true,
      }

      continue
    }

    // 이 열차 구간이 도착해야 하는 가장 늦은 시각.
    let latestArrival = nextScheduled
      ? nextScheduled.departureSeconds
      : targetArrival

    const nextIsExplicitTransfer =
      nextConnection?.transfer === true

    const isDirectLineChange =
      Boolean(
        nextConnection &&
        !nextIsExplicitTransfer &&
        nextConnection.lineId != null &&
        connection.lineId != null &&
        nextConnection.lineId !== connection.lineId
      )

    // 같은 열차(tripId)가 이어지는지 먼저 확인한다.
    // 같은 노선의 매 역마다 환승 시간을 빼지 않는다.
    const preferredTripId =
      nextScheduled &&
      nextScheduled.transfer !== true
        ? nextScheduled.selectedService?.tripId || null
        : null

    let service = null

    if (preferredTripId) {
      service = findPreviousService(
        connection,
        latestArrival,
        preferredTripId,
        targetDate
      )
    }

    if (!service) {
      const allowedArrival =
        isDirectLineChange
          ? latestArrival - 300
          : latestArrival

      service = findPreviousService(
        connection,
        allowedArrival,
        null,
        targetDate
      )
    }

    if (!service) {
      return null
    }

    const departure = parseGtfsTime(service.departure)
    const arrival = parseGtfsTime(service.arrival)

    if (departure == null || arrival == null) {
      return null
    }

    const currentTripId = service.tripId || null
    const nextTripId =
      nextScheduled && nextScheduled.transfer !== true
        ? nextScheduled.selectedService?.tripId || null
        : null

    const isSameTrip =
      Boolean(
        currentTripId &&
        nextTripId &&
        currentTripId === nextTripId
      )

    scheduled[i] = {
      ...connection,
      selectedService: service,
      departureSeconds: departure,
      arrivalSeconds: arrival,
      // 같은 직결 열차는 환승으로 표시하지 않는다.
      transfer: Boolean(isDirectLineChange && !isSameTrip),
    }
  }

  const scheduledSegments = scheduled.filter(Boolean)

  if (scheduledSegments.length === 0) {
    return null
  }

  const first = scheduledSegments[0]
  const last = scheduledSegments[scheduledSegments.length - 1]

  return {
    segments: scheduledSegments,
    departureSeconds: first.departureSeconds,
    arrivalSeconds: last.arrivalSeconds,
    durationSeconds: Math.max(
      0,
      last.arrivalSeconds - first.departureSeconds
    ),
  }
}

function makeRoute(
  path,
  schedule
) {
  if (
    !path ||
    !schedule
  ) {
    return null
  }

  const routeStations = [
    path[0].from,
    ...path.map(
      (edge) => edge.to
    ),
  ].map((stationId) => {
    const station =
      getStation(stationId)

    return {
      id: stationId,

      name:
        station?.korean ||
        station?.name ||
        stationId,

      japanese:
        station?.japanese ||
        station?.name ||
        '',

      romanized:
        station?.romanized ||
        '',
    }
  })

  const lineIds = []

  for (const edge of path) {
    if (
      edge.lineId == null
    ) {
      continue
    }

    if (
      !lineIds.includes(
        edge.lineId
      )
    ) {
      lineIds.push(
        edge.lineId
      )
    }
  }

  const routeLines =
    lineIds.map(
      getLineInfo
    )

  const rideSegments =
    schedule.segments.filter(
      (segment) =>
        segment.lineId != null &&
        segment.selectedService
    )

  // 명시적인 도보 환승 edge를 먼저 센다.
  // 그 사이의 노선 변경은 같은 환승을 중복 집계하지 않는다.
  let transfers =
    schedule.segments.filter(
      (segment) =>
        segment.transfer === true &&
        segment.lineId == null
    ).length

  // tripId 차이만으로는 환승을 세지 않는다.
  // 서로 다른 노선으로 바뀌고 같은 직결 열차가 아닌 경우에만 계산한다.
  for (
    let i = 1;
    i < rideSegments.length;
    i += 1
  ) {
    const previous = rideSegments[i - 1]
    const current = rideSegments[i]

    const previousTripId =
      previous.selectedService?.tripId || null
    const currentTripId =
      current.selectedService?.tripId || null
    const sameTrip =
      Boolean(
        previousTripId &&
        currentTripId &&
        previousTripId === currentTripId
      )

    const previousIndex =
      schedule.segments.indexOf(previous)
    const currentIndex =
      schedule.segments.indexOf(current)
    const hasExplicitTransfer =
      previousIndex >= 0 &&
      currentIndex > previousIndex &&
      schedule.segments
        .slice(previousIndex + 1, currentIndex)
        .some(
          (segment) =>
            segment.transfer === true &&
            segment.lineId == null
        )

    if (
      previous.lineId != null &&
      current.lineId != null &&
      previous.lineId !== current.lineId &&
      !sameTrip &&
      !hasExplicitTransfer
    ) {
      transfers += 1
    }
  }

  const segments =
    schedule.segments.map(
      (segment, index) => {
        const fromStation =
          getStation(
            segment.from
          )

        const toStation =
          getStation(
            segment.to
          )

        const service =
          segment.selectedService

        const trainNumber =
          service?.tripShortName ||
          null

        const trainType =
          trainNumber
            ? trainMeta[
                trainNumber
              ]?.trainType
            : null

        const line =
          segment.lineId == null
            ? null
            : getLineInfo(
                segment.lineId
              )

        const durationSeconds =
          segment.arrivalSeconds -
          segment.departureSeconds

        return {
          from: {
            id: segment.from,

            name:
              fromStation?.korean ||
              fromStation?.name ||
              segment.from,

            japanese:
              fromStation?.japanese ||
              fromStation?.name ||
              '',
          },

          to: {
            id: segment.to,

            name:
              toStation?.korean ||
              toStation?.name ||
              segment.to,

            japanese:
              toStation?.japanese ||
              toStation?.name ||
              '',
          },

          lineId:
            segment.lineId,

          line,

          duration:
            Math.max(
              1,
              Math.round(
                durationSeconds / 60
              )
            ),

          departureTime:
            formatGtfsTime(
              segment.departureSeconds
            ),

          arrivalTime:
            formatGtfsTime(
              segment.arrivalSeconds
            ),

          destination:
            service?.headsign ||
            null,

          tripId:
            service?.tripId ||
            null,

          trainNumber,

          directionId:
            service?.directionId ||
            null,

          serviceType:
            segment.transfer
              ? null
              : getTrainTypeName(
                  trainType
                ),

          transfer:
            Boolean(
              segment.transfer
            ),

          stopIndex:
            index,
        }
      }
    )

  const firstService =
    schedule.segments.find(
      (segment) =>
        segment.transfer !== true &&
        segment.selectedService
    )?.selectedService ||
    null

  const duration =
    Math.max(
      1,
      Math.round(
        schedule.durationSeconds /
          60
      )
    )

  let transferStation = null

  const transferSegment =
    schedule.segments.find(
      (segment) =>
        segment.transfer === true &&
        segment.lineId == null
    )

  if (transferSegment) {
    const station =
      getStation(
        transferSegment.from
      )

    transferStation = {
      id:
        transferSegment.from,

      name:
        station?.korean ||
        station?.name ||
        transferSegment.from,

      japanese:
        station?.japanese ||
        station?.name ||
        '',
    }
  } else if (
    transfers > 0
  ) {
    for (
      let i = 1;
      i < rideSegments.length;
      i += 1
    ) {
      const previous = rideSegments[i - 1]
      const current = rideSegments[i]

      const previousTripId =
        previous.selectedService?.tripId || null
      const currentTripId =
        current.selectedService?.tripId || null
      const sameTrip =
        Boolean(
          previousTripId &&
          currentTripId &&
          previousTripId === currentTripId
        )

      if (
        previous.lineId != null &&
        current.lineId != null &&
        previous.lineId !== current.lineId &&
        !sameTrip
      ) {
        const station = getStation(current.from)

        transferStation = {
          id: current.from,
          name:
            station?.korean ||
            station?.name ||
            current.from,
          japanese:
            station?.japanese ||
            station?.name ||
            '',
        }

        break
      }
    }
  }

  return {
    type:
      transfers === 0
        ? 'direct'
        : 'transfer',

    stations:
      routeStations,

    segments,

    lines:
      routeLines,

    transfers,

    duration,

    fare:
      getFareBetweenStations(
        path[0].from,
        path[path.length - 1].to
      ),

    departureTime:
      formatGtfsTime(
        schedule.departureSeconds
      ),

    arrivalTime:
      formatGtfsTime(
        schedule.arrivalSeconds
      ),

    destination:
      firstService?.headsign ||
      null,

    transferStation,

    arrivalSeconds:
      schedule.arrivalSeconds,
  }
}

function removeDuplicateRoutes(
  routes
) {
  const seen = new Set()

  return routes.filter(
    (route) => {
      const key =
        route.segments
          .map(
            (segment) =>
              `${segment.from.id}>${segment.to.id}:${segment.lineId}:${segment.tripId || ''}`
          )
          .join('|')

      if (
        seen.has(key)
      ) {
        return false
      }

      seen.add(key)
      return true
    }
  )
}

export function calculateRoutes(
  fromId,
  toId,
  startSeconds = null,
  targetDate = null,
  timeMode = 'departure',
  viaStationIds = []
) {
  if (
    !fromId ||
    !toId
  ) {
    return []
  }

  if (
    fromId === toId
  ) {
    return [
      {
        type: 'same-station',
        stations: [],
        segments: [],
        lines: [],
        transfers: 0,
        duration: 0,
        fare: 0,
      },
    ]
  }

  function getStationIdsBySameName(
    stationId
  ) {
    const station =
      processedStations.find(
        (item) =>
          item.id === stationId
      )

    if (!station) {
      return [stationId]
    }

    const ids =
      processedStations
        .filter(
          (item) =>
            item.name ===
            station.name
        )
        .map(
          (item) => item.id
        )

    return ids.length > 0
      ? ids
      : [stationId]
  }

  const stationGroups = [
    getStationIdsBySameName(
      fromId
    ),

    ...viaStationIds
      .filter(Boolean)
      .map(
        (stationId) =>
          getStationIdsBySameName(
            stationId
          )
      ),

    getStationIdsBySameName(
      toId
    ),
  ]

  const nowSeconds =
    startSeconds ??
    getCurrentTokyoSeconds()

  let combinedPaths = []

  for (
    const startStationId of
      stationGroups[0]
  ) {
    combinedPaths.push({
      path: [],
      lastStationId:
        startStationId,
    })
  }

  for (
    let groupIndex = 1;
    groupIndex <
      stationGroups.length;
    groupIndex += 1
  ) {
    const nextGroup =
      stationGroups[
        groupIndex
      ]

    const nextCombinedPaths = []

    for (
      const existing of
        combinedPaths
    ) {
      for (
        const nextStationId of
          nextGroup
      ) {
        const segmentPaths =
          findPaths(
            existing.lastStationId,
            nextStationId,
            2
          )

        if (
          !segmentPaths ||
          segmentPaths.length === 0
        ) {
          continue
        }

        for (
          const segmentPath of
            segmentPaths
        ) {
          if (
            existing.path.length >
              0 &&
            segmentPath.length >
              0
          ) {
            const previousEdge =
              existing.path[
                existing.path.length - 1
              ]

            const nextEdge =
              segmentPath[0]

            if (
              previousEdge.to !==
              nextEdge.from
            ) {
              continue
            }
          }

          nextCombinedPaths.push({
            path: [
              ...existing.path,
              ...segmentPath,
            ],

            lastStationId:
              nextStationId,
          })
        }
      }
    }

    combinedPaths =
      nextCombinedPaths.slice(
        0,
        50
      )

    if (
      combinedPaths.length === 0
    ) {
      return []
    }
  }

  const routes = []

  for (
    const item of
      combinedPaths
  ) {
    const path =
      item.path

    if (
      !path ||
      path.length === 0
    ) {
      continue
    }

    const schedule =
      timeMode === 'arrival'
        ? schedulePathBackward(
            path,
            nowSeconds,
            targetDate
          )
        : schedulePath(
            path,
            nowSeconds,
            targetDate
          )

    if (!schedule) {
      continue
    }

    const route =
      makeRoute(
        path,
        schedule
      )

    if (route) {
      routes.push(route)
    }
  }

  return removeDuplicateRoutes(
    routes
  )
    .sort(
      (a, b) =>
        a.arrivalSeconds -
          b.arrivalSeconds ||
        a.transfers -
          b.transfers
    )
    .slice(0, 5)
}

export function findPathsPublic(
  fromId,
  toId
) {
  return findPaths(
    fromId,
    toId
  )
}

export default {
  calculateRoutes,

  findPaths:
    findPathsPublic,
}