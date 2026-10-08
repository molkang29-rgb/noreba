import processedStations from '../data/processed/stations.json'
import processedConnections from '../data/processed/connections.json'
import processedLines from '../data/processed/lines.json'
import trainMeta from '../data/processed/trainMeta.json'
import processedServices from '../data/processed/services.json'
import processedFares from '../data/processed/fares.json'
import lines from './lines'
/*
 * ==============================
 * 기본 데이터
 * ==============================
 */

const stationMap = new Map(
  processedStations.map((station) => [
    station.id,
    station,
  ])
)

const lineMap = new Map(
  processedLines.map((line) => [
    line.id,
    line,
  ])
)


const connectionsByStation = new Map()

for (const connection of processedConnections) {
  if (!connectionsByStation.has(connection.from)) {
    connectionsByStation.set(
      connection.from,
      []
    )
  }

  connectionsByStation
    .get(connection.from)
    .push(connection)
}

/*
 * ==============================
 * 시간 처리
 * ==============================
 *
 * GTFS에서는
 *
 * 23:50:00
 * 24:07:00
 * 25:12:00
 *
 * 같은 시간이 가능하다.
 *
 * 따라서 단순 Date가 아니라
 * "서비스 시작 시각으로부터 몇 초인가"
 * 로 처리한다.
 */

function parseGtfsTime(value) {
  if (!value) {
    return null
  }

  const parts = String(value)
    .split(':')
    .map(Number)

  if (parts.length !== 3) {
    return null
  }

  const [
    hours,
    minutes,
    seconds,
  ] = parts

  return (
    hours * 3600 +
    minutes * 60 +
    seconds
  )
}

function formatGtfsTime(seconds) {
  if (
    seconds == null ||
    !Number.isFinite(seconds)
  ) {
    return '--:--'
  }

  /*
   * 24시간 이후는 화면에서는
   * 다음날 시각으로 표시한다.
   */

  const normalized =
    ((seconds % 86400) + 86400) %
    86400

  const hours = Math.floor(
    normalized / 3600
  )

  const minutes = Math.floor(
    (normalized % 3600) / 60
  )

  return `${String(hours).padStart(
    2,
    '0'
  )}:${String(minutes).padStart(
    2,
    '0'
  )}`
}

/*
 * ==============================
 * 현재 도쿄 시간
 * ==============================
 */

function getTokyoNow() {
  const parts = new Intl.DateTimeFormat(
    'en-US',
    {
      timeZone: 'Asia/Tokyo',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }
  ).formatToParts(new Date())

  const get = (type) =>
    Number(
      parts.find(
        (part) =>
          part.type === type
      )?.value
    )

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

  return (
    now.hour * 3600 +
    now.minute * 60 +
    now.second
  )
}
function isServiceActiveToday(serviceId) {
  if (!serviceId) {
    return false
  }

  const now = getTokyoNow()

  const dateString =
    `${now.year}${String(now.month).padStart(2, '0')}${String(now.day).padStart(2, '0')}`

  const date = new Date(
    `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}T00:00:00+09:00`
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

  const weekday =
    weekdayNames[date.getDay()]

  const calendar =
    processedServices.calendar || []

  const calendarDates =
    processedServices.calendarDates || []

  const baseService =
    calendar.find(
      (item) =>
        item.service_id === serviceId
    )

  let active = false

  if (baseService) {
    const withinDateRange =
      dateString >=
        baseService.start_date &&
      dateString <=
        baseService.end_date

    active =
      withinDateRange &&
      baseService[weekday] === '1'
  }

  const exception =
    calendarDates.find(
      (item) =>
        item.service_id === serviceId &&
        item.date === dateString
    )

  if (exception) {
    if (
      exception.exception_type === '1'
    ) {
      active = true
    }

    if (
      exception.exception_type === '2'
    ) {
      active = false
    }
  }

  return active
}


/*
 * ==============================
 * 역 / 노선 정보
 * ==============================
 */

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

  const customLine =
    toiLineInfo[String(lineId)]

  if (customLine) {
    return {
      id: lineId,
      name: customLine.name,
      japanese: customLine.japanese,
      code: customLine.code,
      color: customLine.color,
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

/*
 * ==============================
 * 열차 종류
 * ==============================
 *
 * ODPT의 TrainTimetable에서
 * 가져온 열차 종류를
 * NOREBA 화면용 한국어로 변환한다.
 */

function getTrainTypeName(trainType) {
  const typeMap = {
    'odpt.TrainType:Toei.Local': '일반',
    'odpt.TrainType:Toei.Rapid': '쾌속',
    'odpt.TrainType:Toei.Express': '급행',
    'odpt.TrainType:Toei.LimitedExpress': '특급',
    'odpt.TrainType:Toei.RapidLimitedExpress': '쾌속특급',
    'odpt.TrainType:Toei.AirportRapidLimitedExpress': '공항쾌속특급',
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

  const fareMap =
    new Map(
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

    if (!fare) {
      continue
    }

    const price =
      Number(fare.price)

    if (!Number.isFinite(price)) {
      continue
    }

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
/*
 * ==============================
 * 다음 운행편 찾기
 * ==============================
 *
 * 같은 구간에 여러 열차가 있다.
 *
 * 현재 시각보다 같거나 늦은
 * 가장 빠른 출발편을 찾는다.
 */

function findNextService(
  connection,
  earliestDeparture,
  preferredTripId = null
) {
  if (
    !connection.services ||
    connection.services.length === 0
  ) {
    return null
  }

  /*
   * 같은 열차를 계속 탈 수 있다면
   * 그것을 최우선으로 한다.
   */

const services =
  connection.services
    .filter((service) => {
      if (
        !isServiceActiveToday(
          service.serviceId
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
        departure >=
          earliestDeparture
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

/*
 * ==============================
 * 정적 경로 찾기
 * ==============================
 *
 * 최대 2회 환승까지.
 *
 * 여기서는 "어떤 역들을 거칠 것인가"만 찾고,
 * 실제 열차 시간은 아래 schedulePath()에서
 * 계산한다.
 */

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

      const isTransfer =
        previous &&
        previous.lineId !==
          connection.lineId

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

/*
 * ==============================
 * 실제 시간표를 경로에 적용
 * ==============================
 */

function schedulePath(
  path,
  startSeconds
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

    /*
     * 환승이면 최소 3분을 확보한다.
     *
     * 추후 transfers.txt / pathways.txt를
     * 연결하면서 실제 환승시간으로 교체한다.
     */

    const previous =
      path[index - 1]

    const isTransfer =
      previous &&
      previous.lineId !==
        connection.lineId

    const earliestDeparture =
      currentTime +
      (isTransfer ? 180 : 0)

    const service =
      findNextService(
        connection,
        earliestDeparture,
        currentTripId
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

    /*
     * 같은 열차를 계속 탄 경우:
     *
     * 현재 tripId 유지
     *
     * 다른 열차로 갈아탄 경우:
     * 새 tripId
     */

    currentTripId =
      service.tripId || null

    currentTime = arrival

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

  /*
   * 실제 여행시간
   *
   * 첫 열차 출발 →
   * 최종 도착
   *
   * 출발 전 대기시간은 제외한다.
   */

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

/*
 * ==============================
 * RoutePath / App용 결과 생성
 * ==============================
 */

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

  let transfers = 0

  for (
    let i = 1;
    i < path.length;
    i += 1
  ) {
    if (
      path[i].lineId !==
      path[i - 1].lineId
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

        /*
         * GTFS의 trip_short_name
         * = 실제 열차번호
         */

        const trainNumber =
          service?.tripShortName ||
          null

        /*
         * 열차번호로 ODPT TrainTimetable의
         * 실제 열차종류를 찾는다.
         */

        const trainType =
          trainNumber
            ? trainMeta[
                trainNumber
              ]?.trainType
            : null
            

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

          line:
            getLineInfo(
              segment.lineId
            ),

          duration:
            Math.max(
              1,
              Math.round(
                (
                  segment.arrivalSeconds -
                  segment.departureSeconds
                ) / 60
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
            getTrainTypeName(
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
    schedule.segments[0]
      .selectedService

  const lastSegment =
    schedule.segments[
      schedule.segments.length - 1
    ]

  /*
   * 화면 표시용 최종 소요시간
   */

  const duration = Math.max(
    1,
    Math.round(
      schedule.durationSeconds /
        60
    )
  )

  /*
   * 환승역
   */

  let transferStation = null

  if (transfers > 0) {
    for (
      let i = 1;
      i < path.length;
      i += 1
    ) {
      if (
        path[i].lineId !==
        path[i - 1].lineId
      ) {
        const station =
          getStation(
            path[i].from
          )

        transferStation = {
          id: path[i].from,

          name:
            station?.korean ||
            station?.name ||
            path[i].from,

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

    fare: getFareBetweenStations(
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

    /*
     * 빠른순 정렬에서 사용한다.
     * "현재 시각 → 최종 도착" 기준.
     */

    arrivalSeconds:
      schedule.arrivalSeconds,
  }
}

/*
 * ==============================
 * 중복 경로 제거
 * ==============================
 */

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

/*
 * ==============================
 * 메인
 * ==============================
 */

export function calculateRoutes(
  fromId,
  toId
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

  /*
   * 현재 도쿄 시각
   */

  const nowSeconds =
    getCurrentTokyoSeconds()

  /*
   * 먼저 역 연결 경로를 찾는다.
   */

  const paths =
    findPaths(
      fromId,
      toId,
      2
    )

  /*
   * 각각의 경로에 실제 시간표를 적용한다.
   */

  const routes = []

  for (const path of paths) {
    const schedule =
      schedulePath(
        path,
        nowSeconds
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

  /*
   * 실제 도착시간 기준으로
   * 가장 빨리 도착하는 경로가 우선.
   */

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