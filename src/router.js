import stations from './stations'
import { calculateRoutes } from './routeEngine'

/*
 * 검색어 정리
 *
 * 예:
 * "西馬込駅" → "西馬込"
 * "西馬込"   → "西馬込"
 */
function normalizeQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/駅$/, '')
    .replace(/역$/, '')
    .replace(/\s+/g, '')
}

/*
 * 역 검색
 *
 * 일본어 / 한국어 / 로마자 검색 지원
 */
export function searchStations(query) {
  const value =
    String(query || '')
      .trim()
      .toLowerCase()

  if (!value) {
    return []
  }

  return stations
    .filter((station) => {
      const korean =
        String(station.korean || '')
          .toLowerCase()

      const japanese =
        String(station.japanese || station.name || '')
          .toLowerCase()

      const romanized =
        String(station.romanized || '')
          .toLowerCase()

      const name =
        String(station.name || '')
          .toLowerCase()

      return (
        korean.includes(value) ||
        japanese.includes(value) ||
        romanized.includes(value) ||
        name.includes(value)
      )
    })
    .slice(0, 8)
}

/*
 * 역 찾기
 *
 * 입력값이
 * - 역 ID
 * - 한국어 이름
 * - 일본어 이름
 * - 로마자
 * 중 무엇이든 처리한다.
 */
export function findStation(value) {
  if (!value) {
    return null
  }

  const normalized =
    normalizeQuery(value)

  /*
   * 1. ID 정확히 일치
   */
  const byId = stations.find(
    (station) =>
      String(station.id) ===
      String(value)
  )

  if (byId) {
    return byId
  }

  /*
   * 2. 이름 정확히 일치
   */
  const exact = stations.find(
    (station) => {
      const values = [
        station.name,
        station.japanese,
        station.romanized,
        station.korean,
      ]

      return values.some(
        (item) =>
          normalizeQuery(item) ===
          normalized
      )
    }
  )

  if (exact) {
    return exact
  }

  /*
   * 3. 부분 일치
   */
  const partial = stations.find(
    (station) => {
      const values = [
        station.name,
        station.japanese,
        station.romanized,
        station.korean,
      ]

      return values.some((item) =>
        normalizeQuery(item).includes(
          normalized
        )
      )
    }
  )

  return partial || null
}

/*
 * 실제 GTFS 경로 검색
 *
 * 경유지가 있는 경우에도
 * 구간별로 따로 계산하지 않는다.
 *
 * 예:
 *
 * 아사쿠사
 *   ↓
 * 쿠라마에
 *   ↓
 * 신주쿠
 *
 * 전체 경로를 routeEngine에 한 번에 넘긴다.
 *
 * 이렇게 해야 routeEngine이
 * 전체 승차 경로를 기준으로
 * 운임을 계산할 수 있다.
 */
export function findRoutes(
  from,
  to,
  startSeconds = null,
  targetDate = null,
  timeMode = 'departure',
  viaNames = []
) {
  const fromStation =
    findStation(from)

  const toStation =
    findStation(to)

  if (
    !fromStation ||
    !toStation
  ) {
    return []
  }

  /*
   * 경유지 이름 → 역 ID
   *
   * 빈 값이나 찾지 못한 역은 제외한다.
   */
  const viaStations =
    viaNames
      .map((name) => findStation(name))
      .filter(Boolean)

  /*
   * 경유지가 없으면 일반 검색.
   *
   * 경유지가 있으면 routeEngine에
   * 전체 경유지 배열을 전달한다.
   *
   * 중요:
   * 여기서 각 구간을 따로 calculateRoutes()
   * 하지 않는다.
   */
  return calculateRoutes(
    fromStation.id,
    toStation.id,
    startSeconds,
    targetDate,
    timeMode,
    viaStations.map(
      (station) => station.id
    )
  )
}

/*
 * 경로 정렬
 */
export function sortRoutes(
  routes,
  mode = 'fastest'
) {
  if (!Array.isArray(routes)) {
    return []
  }

  const sorted = [
    ...routes,
  ]

  /*
   * 환승 적은 순
   */
  if (mode === 'fewest-transfers') {
    return sorted.sort(
      (a, b) =>
        (a.transfers || 0) -
          (b.transfers || 0) ||
        (a.duration || 0) -
          (b.duration || 0)
    )
  }

  /*
   * 가장 저렴한 순
   *
   * 현재 fare 구조:
   *
   * {
   *   icFare: 272,
   *   paperFare: 280
   * }
   */
  if (mode === 'cheapest') {
    return sorted.sort(
      (a, b) => {
        const fareA =
          a.fare?.icFare == null
            ? Infinity
            : a.fare.icFare

        const fareB =
          b.fare?.icFare == null
            ? Infinity
            : b.fare.icFare

        return (
          fareA - fareB ||
          (a.duration || 0) -
            (b.duration || 0)
        )
      }
    )
  }

  /*
   * 기본: 빠른순
   */
  return sorted.sort(
    (a, b) =>
      (a.duration || 0) -
        (b.duration || 0) ||
      (a.transfers || 0) -
        (b.transfers || 0)
  )
}

export default {
  searchStations,
  findStation,
  findRoutes,
  sortRoutes,
}