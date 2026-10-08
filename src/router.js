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
 * 기존의 가짜 network.js는 사용하지 않는다.
 */
export function findRoutes(
  from,
  to
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

  return calculateRoutes(
    fromStation.id,
    toStation.id
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

  if (mode === 'fewest-transfers') {
    return sorted.sort(
      (a, b) =>
        (a.transfers || 0) -
          (b.transfers || 0) ||
        (a.duration || 0) -
          (b.duration || 0)
    )
  }

  if (mode === 'cheapest') {
    /*
     * 아직 실제 운임 계산을 붙이지 않았기 때문에
     * 운임이 없는 경로는 뒤로 보낸다.
     */
    return sorted.sort(
      (a, b) => {
        const fareA =
          a.fare == null
            ? Infinity
            : a.fare

        const fareB =
          b.fare == null
            ? Infinity
            : b.fare

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